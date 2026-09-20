// Host-half smoke test for dsh-workspace-lock (plain Node, no DSH).
// Imports lib/index.js with a mock cordis ctx + mock webServer, then drives
// the four /api/workspace-locks/* routes: registration, same-origin fence, body
// validation, salted-hash persistence, wrong-password 403, remove.
// Storage goes to a temp dir via DSH_WORKSPACE_LOCK_PATH (never the real ~/.dsh).
// Usage: node smoke_host.mjs
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'workspace-lock-smoke-'))
process.env.DSH_WORKSPACE_LOCK_PATH = join(dir, 'workspace-locks.json')

const { apply, name } = await import('../dsh-workspace-lock/lib/index.js')

let failures = 0
const check = (label, cond, detail) => {
  if (cond) {
    console.log('OK', label)
  } else {
    failures += 1
    console.error('FAIL', label, detail === undefined ? '' : '— ' + detail)
  }
}

// ---- mock cordis ctx -------------------------------------------------------

const routes = []
const webServer = {
  register(route) {
    routes.push(route)
    return () => {}
  },
}
const ctx = {
  logger: { info: () => {} },
  webServer,
  // Dynamic inject, like the real cordis context: invokes the callback once
  // the named services are ready. Smoke has a webServer but no settings
  // service (admin-password path degrades gracefully).
  inject(deps, cb) {
    if (deps.includes('webServer')) return cb({ webServer })
    if (deps.includes('settings')) return cb({})
    return undefined
  },
}

check('export name', name === 'dsh-workspace-lock', name)

apply(ctx)
check('7 routes registered', routes.length === 7, 'got ' + routes.length)
const byPath = Object.fromEntries(routes.map((r) => [r.path, r]))
for (const p of ['/api/workspace-locks/list', '/api/workspace-locks/set', '/api/workspace-locks/unlock', '/api/workspace-locks/remove', '/api/workspace-locks/unlock-all', '/api/workspace-locks/admin-set', '/api/workspace-locks/admin-clear']) {
  check('route ' + p, byPath[p] !== undefined && byPath[p].kind === 'exact')
}

// ---- request mocks ---------------------------------------------------------

const mkRes = () => ({ code: 0, headers: null, body: null, writeHead(c, h) { this.code = c; this.headers = h }, end(b) { this.body = b } })

// Handlers are async (POST bodies are read from the stream) — always await.
const call = async (routePath, req) => {
  const res = mkRes()
  await byPath[routePath].handler(req, res)
  return res
}

const getReq = (headers) => ({ method: 'GET', headers: headers ?? { 'sec-fetch-site': 'same-origin' } })
const postReq = (body, headers) => ({
  method: 'POST',
  headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...(headers ?? {}) },
  on(ev, cb) {
    if (ev === 'data') cb(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
    if (ev === 'end') cb()
  },
})

const parse = (res) => JSON.parse(res.body)

// ---- drive the routes ------------------------------------------------------

// list: file absent -> empty
let res = await call('/api/workspace-locks/list', getReq())
check('list empty', res.code === 200 && parse(res).ok === true && Object.keys(parse(res).locks).length === 0, res.body)

// same-origin fence: cross-site rejected, bare request admitted (embedded Chromium)
res = await call('/api/workspace-locks/list', getReq({ 'sec-fetch-site': 'cross-site' }))
check('cross-site rejected', res.code === 403, res.body)
res = await call('/api/workspace-locks/list', { method: 'GET', headers: {} })
check('bare request admitted', res.code === 200, res.body)

// POST discipline
res = await call('/api/workspace-locks/set', { method: 'GET', headers: { 'sec-fetch-site': 'same-origin' } })
check('set rejects GET', res.code === 405, res.body)
res = await call('/api/workspace-locks/set', postReq('{"workspaceId":"ws1","password":"pw1"}', { 'content-type': 'text/plain' }))
check('set rejects non-json', res.code === 415, res.body)
res = await call('/api/workspace-locks/set', postReq('{not json'))
check('set rejects bad json', res.code === 400, res.body)
res = await call('/api/workspace-locks/set', postReq({ workspaceId: '', password: 'pw1' }))
check('set rejects empty id', res.code === 400, res.body)

// set + persistence + hash shape
res = await call('/api/workspace-locks/set', postReq({ workspaceId: 'ws1', password: 'pw1' }))
check('set ok', res.code === 200 && parse(res).ok === true, res.body)
const stored = JSON.parse(readFileSync(process.env.DSH_WORKSPACE_LOCK_PATH, 'utf8'))
check('file format', stored.version === 1 && typeof stored.locks.ws1 === 'object', res.body)
const entry = stored.locks.ws1
check('hash matches sha256(salt:pw)', entry.h === createHash('sha256').update(`${entry.s}:pw1`).digest('hex'))
check('timestamp present', typeof entry.t === 'string' && entry.t.length > 0)

// unlock: wrong then right
res = await call('/api/workspace-locks/unlock', postReq({ workspaceId: 'ws1', password: 'WRONG' }))
check('unlock wrong password', res.code === 403 && parse(res).error === 'wrong-password', res.body)
res = await call('/api/workspace-locks/unlock', postReq({ workspaceId: 'ws1', password: 'pw1' }))
check('unlock correct', res.code === 200 && parse(res).ok === true, res.body)
res = await call('/api/workspace-locks/unlock', postReq({ workspaceId: 'ws-nope', password: 'pw1' }))
check('unlock unknown workspace', res.code === 404 && parse(res).error === 'no-lock', res.body)

// remove: wrong then right, then empty again
res = await call('/api/workspace-locks/remove', postReq({ workspaceId: 'ws1', password: 'WRONG' }))
check('remove wrong password', res.code === 403, res.body)
res = await call('/api/workspace-locks/remove', postReq({ workspaceId: 'ws1', password: 'pw1' }))
check('remove correct', res.code === 200, res.body)
res = await call('/api/workspace-locks/list', getReq())
check('list empty after remove', Object.keys(parse(res).locks).length === 0, res.body)
check('list: no admin yet', parse(res).admin === false, res.body)

// ---- admin master password (v0.3.0) ----------------------------------------
// The admin hash normally arrives via the settings scope; craft the storage
// file directly to verify the route behavior.
const asalt = 'cdef1122'
const adminDoc = {
  version: 1,
  locks: { ws2: { s: 'aabb', h: createHash('sha256').update(`aabb:pw2`).digest('hex'), t: 'x' } },
  admin: { s: asalt, h: createHash('sha256').update(`${asalt}:master1`).digest('hex'), t: 'x' },
}
writeFileSync(process.env.DSH_WORKSPACE_LOCK_PATH, JSON.stringify(adminDoc, null, 2))

res = await call('/api/workspace-locks/list', getReq())
check('list: admin flag set', res.code === 200 && parse(res).admin === true, res.body)

res = await call('/api/workspace-locks/unlock', postReq({ workspaceId: 'ws2', password: 'pw2' }))
check('unlock with workspace pw', res.code === 200 && parse(res).master === false, res.body)
res = await call('/api/workspace-locks/unlock', postReq({ workspaceId: 'ws2', password: 'master1' }))
check('unlock with admin pw (master)', res.code === 200 && parse(res).master === true, res.body)

res = await call('/api/workspace-locks/unlock-all', postReq({ password: 'master1' }))
check('unlock-all with admin pw', res.code === 200 && parse(res).master === true, res.body)
res = await call('/api/workspace-locks/unlock-all', postReq({ password: 'pw2' }))
check('unlock-all rejects workspace pw', res.code === 403, res.body)

res = await call('/api/workspace-locks/remove', postReq({ workspaceId: 'ws2', password: 'master1' }))
check('remove with admin pw', res.code === 200, res.body)
res = await call('/api/workspace-locks/unlock', postReq({ workspaceId: 'ws2', password: 'pw2' }))
check('unlock after admin-remove: no-lock 404', res.code === 404, res.body)

// admin cleared again -> unlock-all must answer no-admin
delete adminDoc.admin
adminDoc.locks = {}
writeFileSync(process.env.DSH_WORKSPACE_LOCK_PATH, JSON.stringify(adminDoc, null, 2))
res = await call('/api/workspace-locks/unlock-all', postReq({ password: 'master1' }))
check('unlock-all without admin: 404 no-admin', res.code === 404 && parse(res).error === 'no-admin', res.body)

rmSync(dir, { recursive: true, force: true })
if (failures > 0) {
  console.error(`smoke_host: ${failures} FAILURE(S)`)
  process.exit(1)
}
console.log('smoke_host: ALL PASS')
