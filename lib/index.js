/**
 * dsh-workspace-lock host half: per-workspace password locks + an admin master
 * password for the web GUI.
 *
 * Five same-origin routes under /api/workspace-locks/* persist locks (salted
 * SHA-256) in <home>/.dsh/workspace-locks.json — inside the dsh-data volume,
 * so the file rides volume backups. Storage format:
 *   { version: 1, locks: { <workspaceId>: { s, h, t } }, admin?: { s, h, t } }
 * The admin entry is the master password (v0.3.0): it verifies for ANY
 * workspace's unlock/remove, and /unlock-all flips every lock to page-
 * unlocked in one step. The `locks` shape is identical to the 2026-09-16
 * dsh-better-workspace lock variant, so pre-existing files keep working.
 *
 * Admin password lifecycle (v0.3.0): it lives ONLY as a salted hash in the
 * storage file. The Settings → Plugins → 工作区锁 tab (the client half
 * registers into the `settings.plugins.tab` slot — dsh 0.1.7 removed
 * `settings.register` and the settingsScope card seat, so the tab is
 * feature-owned) feeds it through our own /api/workspace-locks/admin-*
 * routes: no plaintext ever rests on the server. Typing a new value re-sets
 * the password; there is no read back by design.
 *
 * UI-level feature: the client half hides locked workspaces' sessions and
 * shows a lock screen; this host half never gates the core session/file APIs
 * (documented cosmetic-lock semantics). DSH_WORKSPACE_LOCK_PATH overrides the
 * storage path (smoke-test hook only).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-workspace-lock'
// NOTE: no static `inject` export on purpose. A static inject list makes
// cordis hand apply() a FILTERED context exposing only the listed services;
// the dynamic ctx.inject(['settings'], ...) below would then wait forever
// (settings is not in the filter) and the Settings card never appears.
// dsh-better-workspace's host half uses exactly this dynamic-only pattern.

const LOCKS_PATH = process.env.DSH_WORKSPACE_LOCK_PATH || join(homedir(), '.dsh', 'workspace-locks.json')
const BODY_LIMIT = 8192
// Cheap brute-force resistance for a cosmetic lock: stall wrong-password
// answers so online guessing cannot exceed ~1.25 attempts/second/observer.
const WRONG_PASSWORD_DELAY_MS = 800

function readDoc() {
  try {
    if (!existsSync(LOCKS_PATH)) return { locks: {}, admin: null }
    const parsed = JSON.parse(readFileSync(LOCKS_PATH, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { locks: {}, admin: null }
    let locks = {}
    if (parsed.locks !== null && typeof parsed.locks === 'object' && !Array.isArray(parsed.locks)) locks = parsed.locks
    let admin = null
    const a = parsed.admin
    if (a !== null && typeof a === 'object' && typeof a.s === 'string' && typeof a.h === 'string') {
      admin = { s: a.s, h: a.h, t: typeof a.t === 'string' ? a.t : '' }
    }
    return { locks, admin }
  } catch {
    return { locks: {}, admin: null }
  }
}

function writeDoc(doc) {
  const tmp = `${LOCKS_PATH}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ version: 1, locks: doc.locks, admin: doc.admin }, null, 2))
  renameSync(tmp, LOCKS_PATH)
}

function hashPassword(salt, password) {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

/** Length-safe constant-time compare of two hex digests. */
function hashesMatch(a, b) {
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  if (bufA.length !== bufB.length || bufA.length === 0) return false
  return timingSafeEqual(bufA, bufB)
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Same-origin fence. Browser GETs carry no Origin header and this embedded
 * Chromium sends no Sec-Fetch-Site either, so a bare request (neither header)
 * is admitted: cross-site browser requests DO carry Sec-Fetch-Site: cross-site
 * (rejected) or an Origin to compare (hostname-only, because the reverse
 * proxy strips the port from Host). POSTs from browsers always carry Origin.
 */
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site']
  if (site === 'same-origin') return true
  if (site === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return site === undefined
  const host = req.headers.host
  if (typeof origin !== 'string' || origin === '' || typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).hostname === new URL(`http://${host}`).hostname
  } catch {
    return false
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function readJsonBody(req) {
  const raw = await readBody(req)
  return JSON.parse(raw)
}

/** Validate and normalize an incoming {workspaceId, password} pair; undefined when malformed. */
function parseCredentials(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim().slice(0, 128) : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (workspaceId === '' || password.length < 1 || password.length > 256) return undefined
  return { workspaceId, password }
}

function parsePassword(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < 1 || password.length > 256) return undefined
  return { password }
}

/**
 * Verify a password against the workspace entry, falling back to the admin
 * entry. Returns 'workspace', 'admin', or null (mismatch).
 */
function verifyPassword(locks, admin, workspaceId, password) {
  const entry = locks[workspaceId]
  if (entry !== null && typeof entry === 'object' && typeof entry.s === 'string' && typeof entry.h === 'string') {
    if (hashesMatch(hashPassword(entry.s, password), entry.h)) return 'workspace'
  }
  if (admin !== null && typeof admin.h === 'string') {
    if (hashesMatch(hashPassword(admin.s, password), admin.h)) return 'admin'
  }
  return null
}

export function apply(ctx) {
  const log = ctx && ctx.logger && typeof ctx.logger.info === 'function'
    ? (msg) => ctx.logger.info(msg)
    : (msg) => console.log(msg)
  log('[dsh-workspace-lock] host half loaded; lock UI runs in the browser (client half)')
  if (!ctx || typeof ctx.inject !== 'function') return

  ctx.inject(['webServer'], (wctx) => {
    const webServer = wctx && wctx.webServer
    if (!webServer || typeof webServer.register !== 'function') {
      log('[dsh-workspace-lock] webServer unavailable; workspace locks disabled')
      return undefined
    }
    const guard = (req, res) => {
      if (sameOrigin(req)) return true
      json(res, 403, { ok: false, error: 'forbidden' })
      return false
    }
    const requirePost = (req, res) => {
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'method-not-allowed' })
        return false
      }
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        json(res, 415, { ok: false, error: 'json-required' })
        return false
      }
      return true
    }
    const routes = [
      {
        kind: 'exact',
        path: '/api/workspace-locks/list',
        handler: (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
          if (!guard(req, res)) return
          const doc = readDoc()
          json(res, 200, { ok: true, locks: doc.locks, admin: doc.admin !== null })
        },
      },
      {
        kind: 'exact',
        path: '/api/workspace-locks/set',
        handler: async (req, res) => {
          try {
            if (!requirePost(req, res) || !guard(req, res)) return
            const creds = parseCredentials(await readJsonBody(req))
            if (creds === undefined) return json(res, 400, { ok: false, error: 'invalid-request' })
            const doc = readDoc()
            const salt = randomBytes(16).toString('hex')
            doc.locks[creds.workspaceId] = { s: salt, h: hashPassword(salt, creds.password), t: new Date().toISOString() }
            writeDoc(doc)
            json(res, 200, { ok: true })
          } catch (error) {
            json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      },
      {
        kind: 'exact',
        path: '/api/workspace-locks/unlock',
        handler: async (req, res) => {
          try {
            if (!requirePost(req, res) || !guard(req, res)) return
            const creds = parseCredentials(await readJsonBody(req))
            if (creds === undefined) return json(res, 400, { ok: false, error: 'invalid-request' })
            const doc = readDoc()
            const entry = doc.locks[creds.workspaceId]
            if (entry === null || typeof entry !== 'object' || typeof entry.s !== 'string' || typeof entry.h !== 'string') {
              return json(res, 404, { ok: false, error: 'no-lock' })
            }
            const matched = verifyPassword(doc.locks, doc.admin, creds.workspaceId, creds.password)
            if (matched === null) {
              await sleep(WRONG_PASSWORD_DELAY_MS)
              return json(res, 403, { ok: false, error: 'wrong-password' })
            }
            json(res, 200, { ok: true, master: matched === 'admin' })
          } catch (error) {
            json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      },
      {
        kind: 'exact',
        path: '/api/workspace-locks/remove',
        handler: async (req, res) => {
          try {
            if (!requirePost(req, res) || !guard(req, res)) return
            const creds = parseCredentials(await readJsonBody(req))
            if (creds === undefined) return json(res, 400, { ok: false, error: 'invalid-request' })
            const doc = readDoc()
            const entry = doc.locks[creds.workspaceId]
            if (entry === null || typeof entry !== 'object' || typeof entry.s !== 'string' || typeof entry.h !== 'string') {
              return json(res, 404, { ok: false, error: 'no-lock' })
            }
            const matched = verifyPassword(doc.locks, doc.admin, creds.workspaceId, creds.password)
            if (matched === null) {
              await sleep(WRONG_PASSWORD_DELAY_MS)
              return json(res, 403, { ok: false, error: 'wrong-password' })
            }
            delete doc.locks[creds.workspaceId]
            writeDoc(doc)
            json(res, 200, { ok: true })
          } catch (error) {
            json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      },
      {
        kind: 'exact',
        path: '/api/workspace-locks/unlock-all',
        handler: async (req, res) => {
          try {
            if (!requirePost(req, res) || !guard(req, res)) return
            const creds = parsePassword(await readJsonBody(req))
            if (creds === undefined) return json(res, 400, { ok: false, error: 'invalid-request' })
            const doc = readDoc()
            if (doc.admin === null) return json(res, 404, { ok: false, error: 'no-admin' })
            if (!hashesMatch(hashPassword(doc.admin.s, creds.password), doc.admin.h)) {
              await sleep(WRONG_PASSWORD_DELAY_MS)
              return json(res, 403, { ok: false, error: 'wrong-password' })
            }
            json(res, 200, { ok: true, master: true })
          } catch (error) {
            json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      },
      {
        kind: 'exact',
        path: '/api/workspace-locks/admin-set',
        handler: async (req, res) => {
          try {
            if (!requirePost(req, res) || !guard(req, res)) return
            const body = await readJsonBody(req)
            const creds = parsePassword(body)
            if (creds === undefined) return json(res, 400, { ok: false, error: 'invalid-request' })
            const doc = readDoc()
            // Re-setting (or clearing) an existing admin password requires the
            // current one — otherwise anyone on the network could mint
            // themselves a master key. A FIRST set is open, same trust level
            // as setting any workspace lock.
            if (doc.admin !== null && typeof body.current !== 'string') {
              return json(res, 400, { ok: false, error: 'current-required' })
            }
            if (doc.admin !== null) {
              if (!hashesMatch(hashPassword(doc.admin.s, body.current), doc.admin.h)) {
                await sleep(WRONG_PASSWORD_DELAY_MS)
                return json(res, 403, { ok: false, error: 'wrong-password' })
              }
            }
            const salt = randomBytes(16).toString('hex')
            doc.admin = { s: salt, h: hashPassword(salt, creds.password), t: new Date().toISOString() }
            writeDoc(doc)
            log('[dsh-workspace-lock] admin password updated')
            json(res, 200, { ok: true })
          } catch (error) {
            json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      },
      {
        kind: 'exact',
        path: '/api/workspace-locks/admin-clear',
        handler: async (req, res) => {
          try {
            if (!requirePost(req, res) || !guard(req, res)) return
            const body = await readJsonBody(req).catch(() => ({}))
            const doc = readDoc()
            if (doc.admin === null) return json(res, 200, { ok: true })
            const current = typeof body.current === 'string' ? body.current : ''
            if (current === '' || !hashesMatch(hashPassword(doc.admin.s, current), doc.admin.h)) {
              await sleep(WRONG_PASSWORD_DELAY_MS)
              return json(res, 403, { ok: false, error: 'wrong-password' })
            }
            doc.admin = null
            writeDoc(doc)
            log('[dsh-workspace-lock] admin password cleared')
            json(res, 200, { ok: true })
          } catch (error) {
            json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      },
    ]
    const disposers = []
    for (const route of routes) disposers.push(webServer.register(route))
    log('[dsh-workspace-lock] workspace lock routes registered (/api/workspace-locks/*)')
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // Server already tearing down.
        }
      }
    }
  })
}
