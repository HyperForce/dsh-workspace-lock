/**
 * dsh-workspace-lock browser half (v0.2.0, context-menu interaction). Hand-written
 * loader module (no build step): the same `window.__ModuleLoader__.load({id,
 * factory})` shape the core bundler emits for plugins, with only
 * shell-guaranteed requires (react / react-dom/client — nothing from the
 * frozen 9-module table beyond the two every core build guarantees).
 *
 * Interaction (v0.2.0 — replaced the v0.1.0 manager panel, see
 * workspace-lock-plugin/archive/): right-click a workspace row in the sidebar →
 * 加锁 / 解锁 / 移除锁 items injected into dsh-better-workspace's own context
 * menu (.bw-ctx-menu); if that menu does not appear (stock sidebar dialect or
 * future UI changes), a minimal standalone menu opens at the cursor instead.
 * Password input uses a body-level modal; no other UI is added.
 *
 * Lock semantics (unchanged from v0.1.0, verified 2026-09-17): a locked
 * workspace's session rows hide in the sidebar (best-effort DOM decoration)
 * and, while it is the active workspace, the center column is taken over by
 * a lock screen until the password is entered. Unlock is page-scoped: a
 * browser refresh locks again. This is cosmetic by design — it does not
 * gate the underlying APIs. Hiding is driven by "effective locks = server
 * locks − in-page unlocked".
 *
 * UI surfaces follow the pattern proven by dsh-ws-groups: a center-column
 * takeover (`<html data-workspace-lock-active>` + `visibility:hidden` on siblings so
 * the shell stays mounted underneath). Everything schedules with
 * setTimeout(0) — requestAnimationFrame never fires in this embedded
 * renderer even though document.visibilityState reports visible.
 *
 * State discipline: the store only holds action-driven data (locks,
 * unlocked set, dialog, busy/error). Everything derived from host services
 * is recomputed in the coalesced tick and handed straight to the renderers
 * — the tick must never store.set, or the store-subscription → tick cycle
 * would spin at frame rate. Failure policy: mounting problems are logged,
 * never thrown — an external plugin must not take the GUI down.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-lock',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const react = require('react')
    const { createRoot } = require('react-dom/client')
    // Children are passed varargs-style (createElement signature), NOT as
    // jsx-runtime props.children — do not swap this for react/jsx-runtime.
    const h = react.createElement

    const LIST_API = '/api/workspace-locks/list'
    const VIEW_ATTR = 'data-workspace-lock-view'
    const COL_ATTR = 'data-workspace-lock-col'
    const ACTIVE_ATTR = 'data-workspace-lock-active'
    const COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
    const PROJECT_ROW_SELECTOR = '[class*="projectRow"]'
    const SESSION_ROW_SELECTOR = '[class*="sessionRow"]'
    const SEARCH_ROW_SELECTOR = '[class*="searchResultRow"]'
    // bw's context menu (0.11.x used .bw-ctx-* classes; 0.14.0 portals a
    // div[role="menu"] straight to body with _itemWrap_/_item_ children).
    // Detection is therefore role-based, and injection CLONES a native item
    // so the row inherits the current build's styling.
    const CTX_ITEM_ATTR = 'data-workspace-lock-ctx'
    const findHostMenu = () => {
      const menus = document.querySelectorAll('[role="menu"]')
      return menus.length ? menus[menus.length - 1] : null
    }
    const BADGE_CLASS = 'workspace-lock-badge'
    const HIDDEN_FLAG = 'data-workspace-lock-hidden'
    const CURRENT_SESSION_KEY = 'dsh.sessions.current'

    // ---------------------------------------------------------------- texts

    const TEXT = {
      zh: {
        'set': '加锁',
        'unlock': '解锁',
        'remove': '移除锁',
        'lockTitle': '此工作区已加锁',
        'lockHint': '输入密码以查看该工作区的会话。',
        'adminHint': '输入该工作区密码，或输入管理员密码一次性解锁所有工作区。',
        'lockSubHint': '点击侧栏其他会话可离开此页面；刷新浏览器后重新上锁。本锁只作用于界面显示。',
        'dlg.set.title': '设置工作区密码',
        'dlg.unlock.title': '解锁工作区',
        'dlg.remove.title': '移除工作区锁',
        'dlg.set.hint': '锁定后该工作区的会话在本界面隐藏，刷新页面后重新上锁。',
        'dlg.unlock.hint': '输入密码以展开该工作区的会话。',
        'dlg.remove.hint': '输入密码移除锁；移除后所有人可见。',
        'dlg.pw': '密码',
        'dlg.pw2': '再次输入密码',
        'dlg.busy': '处理中…',
        'dlg.mismatch': '两次输入不一致',
        'dlg.wrong': '密码错误',
        'cancel': '取消',
        'card.title': '工作区锁',
        'card.desc': '管理员密码可一次性解锁所有工作区，也可代替任意工作区密码进行解锁或移除锁。仅以加盐哈希形式保存在服务器。',
        'card.current': '当前管理员密码',
        'card.new': '新管理员密码',
        'card.save': '保存新密码',
        'card.clear': '清除管理员密码',
        'card.set': '管理员密码：已设置',
        'card.unset': '管理员密码：未设置',
        'card.saved': '管理员密码已更新',
        'card.cleared': '管理员密码已清除',
        'card.currentRequired': '请输入当前管理员密码',
        'card.busy': '处理中…',
      },
      en: {
        'set': 'Lock',
        'unlock': 'Unlock',
        'remove': 'Remove lock',
        'lockTitle': 'This workspace is locked',
        'lockHint': 'Enter the password to view its sessions.',
        'adminHint': 'Enter the workspace password, or the admin password to unlock every workspace at once.',
        'lockSubHint': 'Click another session in the sidebar to leave; a page refresh locks again. This lock is UI-level only.',
        'dlg.set.title': 'Set workspace password',
        'dlg.unlock.title': 'Unlock workspace',
        'dlg.remove.title': 'Remove workspace lock',
        'dlg.set.hint': 'Sessions of this workspace hide in the UI until unlocked; a page refresh locks again.',
        'dlg.unlock.hint': 'Enter the password to reveal the sessions of this workspace.',
        'dlg.remove.hint': 'Enter the password to remove the lock; the workspace becomes visible to everyone.',
        'dlg.pw': 'Password',
        'dlg.pw2': 'Repeat password',
        'dlg.busy': 'Working…',
        'dlg.mismatch': 'Passwords do not match',
        'dlg.wrong': 'Wrong password',
        'cancel': 'Cancel',
        'card.title': 'Workspace locks',
        'card.desc': 'The admin password unlocks every workspace at once and can replace any workspace password for unlock/remove. It is stored server-side as a salted hash only.',
        'card.current': 'Current admin password',
        'card.new': 'New admin password',
        'card.save': 'Save new password',
        'card.clear': 'Remove admin password',
        'card.set': 'Admin password: configured',
        'card.unset': 'Admin password: not configured',
        'card.saved': 'Admin password updated',
        'card.cleared': 'Admin password removed',
        'card.currentRequired': 'Enter the current admin password',
        'card.busy': 'Working…',
      },
    }
    const ZH = String((typeof navigator !== 'undefined' && navigator.language) || 'en').toLowerCase().startsWith('zh')
    const T = (k) => (TEXT[ZH ? 'zh' : 'en'][k] ?? k)

    /**
     * Padlock icons in the official Outline16 style (16×16, stroke-based,
     * currentColor — matches IconEditOutline16/IconTrashOutline16 weight).
     * The primitives package has NO lock glyph (all 77 exports checked).
     * Factory-level scope: used by the sidebar badge decorator, the lock
     * screen, the fallback menu AND the context-menu injection.
     */
    const LOCK_CLOSED_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2.7" y="6.5" width="10.6" height="7.6" rx="1.4" stroke="currentColor" stroke-width="1.2"/><path d="M5.2 6.4V4.7a2.8 2.8 0 0 1 5.6 0V6.4" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="10" r="1" fill="currentColor"/><path d="M8 11v1.4" stroke="currentColor" stroke-width="1.2"/></svg>'
    const LOCK_OPEN_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2.7" y="6.5" width="10.6" height="7.6" rx="1.4" stroke="currentColor" stroke-width="1.2"/><path d="M5.2 6.4V4.7a2.8 2.8 0 0 1 5.6 0v1.1" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="10" r="1" fill="currentColor"/><path d="M8 11v1.4" stroke="currentColor" stroke-width="1.2"/></svg>'

    // ---------------------------------------------------------------- styles

    // Theme tokens follow the SYSTEM (same signal the DSH app itself uses):
    // light values by default, dark values under prefers-color-scheme: dark.
    // Vars are declared on the three overlay roots; everything inside
    // (cards, inputs, buttons) inherits them. color-scheme is set alongside
    // so native controls (password inputs, scrollbars) render correctly.
    const CSS = `
      :where(.workspace-lock-adminCard,.workspace-lock-adopted),[data-workspace-lock-view],.workspace-lock-modalBack,.workspace-lock-menuBack{
        --workspace-lock-bg:#f6f7f9;--workspace-lock-card:#ffffff;--workspace-lock-card-border:#e3e6ea;
        --workspace-lock-text:#1f2328;--workspace-lock-muted:#7a828c;--workspace-lock-faint:#9aa2ab;
        --workspace-lock-input-bg:#ffffff;--workspace-lock-input-border:#d4d9df;
        --workspace-lock-btn-bg:#ffffff;--workspace-lock-btn-border:rgba(28,60,110,.25);--workspace-lock-btn-hover:rgba(28,60,110,.06);
        --workspace-lock-danger:#b3261e;--workspace-lock-danger-border:rgba(180,40,40,.4);
        --workspace-lock-backdrop:rgba(15,20,30,.4);--workspace-lock-shadow:0 8px 30px rgba(20,30,50,.08);
        color-scheme:light;
      }
      @media (prefers-color-scheme: dark){
        :where(.workspace-lock-adminCard,.workspace-lock-adopted),[data-workspace-lock-view],.workspace-lock-modalBack,.workspace-lock-menuBack{
          --workspace-lock-bg:#191c21;--workspace-lock-card:#22262d;--workspace-lock-card-border:#343a44;
          --workspace-lock-text:#e6e8eb;--workspace-lock-muted:#9aa2ab;--workspace-lock-faint:#7a828c;
          --workspace-lock-input-bg:#1a1d22;--workspace-lock-input-border:#3c424c;
          --workspace-lock-btn-bg:#22262d;--workspace-lock-btn-border:#3c424c;--workspace-lock-btn-hover:rgba(255,255,255,.07);
          --workspace-lock-danger:#f28b82;--workspace-lock-danger-border:rgba(242,139,130,.45);
          --workspace-lock-backdrop:rgba(0,0,0,.55);--workspace-lock-shadow:0 8px 30px rgba(0,0,0,.5);
          color-scheme:dark;
        }
        /* the card renders INSIDE the host settings dialog — dark values
           mirror the host PluginCard (bg rgb(53,54,56), border white/.2);
           the actual override lives at the END of this stylesheet so it wins
           the cascade over the base (light) card rule below */
      }
      html[data-workspace-lock-active] [data-workspace-lock-col] > *:not([data-workspace-lock-view]){visibility:hidden}
      [data-workspace-lock-view]{position:absolute;inset:0;z-index:40;overflow:auto;background:var(--workspace-lock-bg);color:var(--workspace-lock-text);
        font:14px/1.5 -apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
      .workspace-lock-lockWrap{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px}
      .workspace-lock-lockCard{background:var(--workspace-lock-card);border:1px solid var(--workspace-lock-card-border);border-radius:14px;
        box-shadow:var(--workspace-lock-shadow);padding:34px 36px;width:360px;max-width:92vw;text-align:center}
      .workspace-lock-lockIcon{opacity:.92}
      .workspace-lock-lockIcon svg{width:46px;height:46px;display:block;margin:0 auto}
      .workspace-lock-lockTitle{font-size:16px;font-weight:600;margin:12px 0 0}
      .workspace-lock-lockName{font-size:15px;font-weight:600;margin:6px 0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .workspace-lock-lockHint{color:var(--workspace-lock-muted);font-size:13px;margin:0 0 16px}
      .workspace-lock-lockSub{color:var(--workspace-lock-faint);font-size:11.5px;margin:14px 0 0}
      .workspace-lock-input{width:100%;box-sizing:border-box;border:1px solid var(--workspace-lock-input-border);border-radius:8px;padding:8px 10px;
        font:inherit;font-size:13.5px;background:var(--workspace-lock-input-bg);color:var(--workspace-lock-text)}
      .workspace-lock-input:focus{outline:2px solid rgba(36,86,196,.35);border-color:#2456c4}
      .workspace-lock-btn{border:1px solid var(--workspace-lock-btn-border);background:var(--workspace-lock-btn-bg);color:var(--workspace-lock-text);border-radius:8px;
        padding:4px 10px;font:inherit;font-size:13px;cursor:pointer}
      .workspace-lock-btn:hover{background:var(--workspace-lock-btn-hover)}
      .workspace-lock-btnPrimary{background:#2456c4;border-color:#2456c4;color:#fff}
      .workspace-lock-btnPrimary:hover{background:#1c46a4}
      .workspace-lock-btnDanger{background:var(--workspace-lock-btn-bg);border-color:var(--workspace-lock-danger-border);color:var(--workspace-lock-danger)}
      .workspace-lock-btnDanger:hover{background:var(--workspace-lock-btn-hover)}
      .workspace-lock-modalBack{position:fixed;inset:0;background:var(--workspace-lock-backdrop);display:flex;align-items:center;
        justify-content:center;z-index:1000}
      .workspace-lock-modal{background:var(--workspace-lock-card);border-radius:12px;box-shadow:var(--workspace-lock-shadow);
        padding:18px 20px;width:340px;max-width:92vw;color:var(--workspace-lock-text);
        font:14px/1.5 -apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
      .workspace-lock-modalTitle{font-size:15px;font-weight:600;margin:0 0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .workspace-lock-field{margin:10px 0 0}
      .workspace-lock-modalHint{color:var(--workspace-lock-muted);font-size:12.5px;margin:10px 0 0}
      .workspace-lock-modalErr{color:var(--workspace-lock-danger);font-size:12.5px;margin:10px 0 0}
      .workspace-lock-modalActions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
      .${BADGE_CLASS}{display:inline-flex;align-items:center;margin-left:6px;opacity:.8}
      .${BADGE_CLASS} svg{width:12px;height:12px;display:block}
      .workspace-lock-menuBack{position:fixed;inset:0;z-index:900}
      .workspace-lock-menu{position:absolute;background:var(--workspace-lock-card);border:1px solid var(--workspace-lock-card-border);border-radius:10px;
        box-shadow:var(--workspace-lock-shadow);padding:4px;min-width:150px;
        font:13px/1.4 -apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--workspace-lock-text)}
      .workspace-lock-menuItem{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:transparent;
        color:inherit;border-radius:7px;padding:7px 10px;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
      .workspace-lock-menuItem:hover{background:var(--workspace-lock-btn-hover)}
      .workspace-lock-menuIcon{display:inline-flex;flex:none}
      .workspace-lock-menuIcon svg{width:14px;height:14px;display:block}
      .workspace-lock-menuDanger{color:var(--workspace-lock-danger)}
      /* Card chrome mirrors the host PluginCard one-for-one (values probed
         from the live settings tab 2026-09-18: card bg rgb(53,54,56), border
         1px rgba(255,255,255,.2), radius 16px; header padding 14px 16px,
         radius 12px, font 14px). Official contract: the plugin OWNS its card
         chrome (2026-08-12-plugin-owned-settings-surface) — importing the
         host's PluginCard is forbidden by the bundle-purity gate. */
      /* Settings-card chrome, two modes:
         - fallback (.workspace-lock-adminCard alone): our own tokens below;
         - adopted (+ .workspace-lock-adopted, host PluginCard classes from a sibling
           card): the HOST classes win the cascade because our <style> is
           inserted as the FIRST child of <head>; :where() keeps our var
           declarations at zero specificity so they never fight the host. */
      .workspace-lock-adminCard{color:inherit;
        font:13.5px/1.5 -apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;max-width:640px}
      .workspace-lock-adminCard:not(.workspace-lock-adopted){margin-top:14px;padding:14px 18px;background:var(--workspace-lock-card);
        border:1px solid var(--workspace-lock-card-border);border-radius:12px}
      .workspace-lock-adminHead{display:flex;align-items:center;gap:12px;width:100%;border:0;background:transparent;
        color:inherit;cursor:pointer;padding:14px 16px;border-radius:12px;font:inherit;font-size:14px;text-align:left}
      .workspace-lock-adminHeadMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
      .workspace-lock-adminTitle{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .workspace-lock-adminStatus{color:var(--workspace-lock-muted);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .workspace-lock-adminChevron{flex:none;color:var(--workspace-lock-muted);font-size:14px;line-height:1;display:inline-flex;transition:transform .15s}
      .workspace-lock-adminHead[aria-expanded="true"] .workspace-lock-adminChevron{transform:rotate(90deg)}
      .workspace-lock-adminBody{padding:2px 16px 14px}
      .workspace-lock-adminDesc{color:var(--workspace-lock-muted);font-size:12.5px;margin:0 0 10px}
      .workspace-lock-adminField{display:flex;gap:8px;align-items:center;margin:8px 0}
      .workspace-lock-adminFieldLabel{flex:none;width:120px;color:var(--workspace-lock-muted);font-size:12.5px}
      .workspace-lock-adminActions{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
      .workspace-lock-adminMsg{font-size:12.5px;margin:8px 0 0}
      .workspace-lock-adminErr{color:var(--workspace-lock-danger)}
      .workspace-lock-adopted .workspace-lock-adminBody{padding:2px 16px 14px}
      .workspace-lock-adopted .workspace-lock-input{background:transparent;border-color:rgba(127,127,127,.45);color:inherit}
      .workspace-lock-adopted .workspace-lock-btn{background:transparent;border-color:rgba(127,127,127,.45);color:inherit}
      .workspace-lock-adopted .workspace-lock-btnPrimary{background:#2456c4;border-color:#2456c4;color:#fff}
      .workspace-lock-adopted .workspace-lock-btnDanger{color:var(--workspace-lock-danger);border-color:var(--workspace-lock-danger-border)}
    `

    function ensureStyles() {
      if (document.getElementById('workspace-lock-style') !== null) return
      const style = document.createElement('style')
      style.id = 'workspace-lock-style'
      style.textContent = CSS
      // FIRST child of <head>: host stylesheets come after ours, so when the
      // settings card adopts host class names the host's own rules win the
      // cascade and the card looks exactly native.
      const first = document.head.firstChild
      if (first) document.head.insertBefore(style, first)
      else document.head.appendChild(style)
    }

    // ----------------------------------------------------------------- store

    function createStore() {
      const listeners = new Set()
      // Action-driven state ONLY (see the module docblock): derived values
      // (view/active workspace/roster) never live here.
      // locks: null until first fetch, then { wsId: {s,h,t} } (server truth).
      // unlocked: wsIds unlocked in THIS page (a refresh locks again).
      let state = {
        locks: null,
        admin: false,
        unlocked: new Set(),
        dialog: null,
        dialogError: '',
        lockError: '',
        busy: false,
      }
      const emit = () => {
        for (const listener of listeners) {
          try { listener() } catch { /* listener bugs must not break the rest */ }
        }
      }
      return {
        get: () => state,
        set(patch) { state = { ...state, ...patch }; emit() },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      }
    }

    // ------------------------------------------------------------ host reads

    function rosterItems(workspaces) {
      try {
        const snap = workspaces.list.getSnapshot()
        return Array.isArray(snap?.items) ? snap.items : []
      } catch {
        return []
      }
    }

    function currentSessionId(sessions) {
      // Primary: the sessions service snapshot. Fallback: the persisted
      // localStorage copy the stock client keeps — note it persists
      // {"sessionId":"..."}, an object, not a bare string.
      try {
        const snap = sessions?.list.getSnapshot()
        if (snap && snap.current !== undefined && snap.current !== null) return snap.current
      } catch { /* fall through */ }
      try {
        const raw = window.localStorage.getItem(CURRENT_SESSION_KEY)
        if (raw === null) return undefined
        try {
          const parsed = JSON.parse(raw)
          if (typeof parsed === 'string') return parsed
          if (parsed !== null && typeof parsed === 'object' && typeof parsed.sessionId === 'string') {
            return parsed.sessionId
          }
          return undefined
        } catch {
          return raw
        }
      } catch {
        return undefined
      }
    }

    function deriveActive(workspaces, sessions) {
      const sid = currentSessionId(sessions)
      if (sid === undefined || sid === '') return undefined
      for (const item of rosterItems(workspaces)) {
        if (item === null || typeof item !== 'object') continue
        const ids = item.sessionIds
        if (Array.isArray(ids) && ids.includes(sid)) {
          return typeof item.workspaceId === 'string' ? item.workspaceId : undefined
        }
      }
      return undefined
    }

    function workspaceMeta(item) {
      const id = typeof item.workspaceId === 'string' ? item.workspaceId : ''
      if (id === '') return null
      const title = typeof item.title === 'string' ? item.title : ''
      const path = typeof item.path === 'string' ? item.path : ''
      return { id, title, path }
    }

    /** Titles of sessions that belong to locked workspaces (for search-row hiding). */
    function collectLockedSessionTitles(workspaces, sessions, locks) {
      const titles = new Set()
      if (locks === null || sessions === null) return titles
      const byId = (() => {
        try {
          const snap = sessions.list.getSnapshot()
          return snap && typeof snap.byId === 'object' && snap.byId !== null ? snap.byId : {}
        } catch {
          return {}
        }
      })()
      for (const item of rosterItems(workspaces)) {
        if (item === null || typeof item !== 'object') continue
        const wsId = item.workspaceId
        if (typeof wsId !== 'string' || !Object.prototype.hasOwnProperty.call(locks, wsId)) continue
        const ids = Array.isArray(item.sessionIds) ? item.sessionIds : []
        for (const id of ids) {
          const entry = byId[id]
          if (entry && typeof entry === 'object' && typeof entry.title === 'string' && entry.title !== '') {
            titles.add(entry.title)
          }
        }
      }
      return titles
    }

    // ------------------------------------------------------------ server API

    async function fetchLocks() {
      const response = await fetch(LIST_API, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      return {
        locks: body && body.locks && typeof body.locks === 'object' && !Array.isArray(body.locks) ? body.locks : {},
        admin: body !== null && typeof body === 'object' && body.admin === true,
      }
    }

    async function postLock(endpoint, body) {
      const response = await fetch('/api/workspace-locks/' + endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      let data = {}
      try { data = await response.json() } catch { /* non-json error body */ }
      if (!response.ok || data.ok !== true) {
        const error = new Error(data.error || `HTTP ${response.status}`)
        error.code = data.error
        throw error
      }
      return data
    }

    // ------------------------------------------------------ center takeover

    function createTakeover(options) {
      let container
      let root
      let savedPosition = ''
      let active = false

      const column = () => document.querySelector(COLUMN_SELECTOR)

      const teardown = () => {
        if (container !== undefined) {
          try { root?.unmount() } catch { /* already gone */ }
          root = undefined
          container.remove()
          container = undefined
          const host = column()
          if (host != null) {
            host.removeAttribute(COL_ATTR)
            host.style.position = savedPosition
            savedPosition = ''
          }
        }
        document.documentElement.removeAttribute(ACTIVE_ATTR)
      }

      const ensure = () => {
        if (!active) {
          teardown()
          return
        }
        if (container !== undefined && !container.isConnected) {
          // The shell replaced the frame; drop the stale tree and remount.
          try { root?.unmount() } catch { /* already gone */ }
          root = undefined
          container.remove()
          container = undefined
        }
        if (container === undefined) {
          const host = column()
          if (host == null) return
          host.setAttribute(COL_ATTR, '')
          savedPosition = host.style.position
          if (savedPosition === '' || savedPosition === 'static') host.style.position = 'relative'
          container = document.createElement('div')
          container.setAttribute(VIEW_ATTR, '')
          container.dataset.dshPlugin = 'workspace-lock'
          container.dataset.dshPart = 'center-panel'
          host.appendChild(container)
        }
        if (root === undefined) {
          root = createRoot(container)
        }
        options.render(root)
      }

      const setActive = (value) => {
        if (active !== value) {
          active = value
          if (active) document.documentElement.setAttribute(ACTIVE_ATTR, '')
          else document.documentElement.removeAttribute(ACTIVE_ATTR)
        }
        ensure()
      }

      // Watch for frame replacement while active (the shell re-renders);
      // ensure() is a near-no-op while healthy.
      let scheduled = false
      const scheduledEnsure = () => {
        scheduled = false
        try { ensure() } catch (error) { console.error('[workspace-lock] takeover ensure failed:', error) }
      }
      const scheduleEnsure = () => {
        if (scheduled) return
        scheduled = true
        setTimeout(scheduledEnsure, 0)
      }
      const bodyObserver = new MutationObserver(scheduleEnsure)
      bodyObserver.observe(document.body, { childList: true, subtree: true })

      return {
        setActive,
        dispose: () => {
          bodyObserver.disconnect()
          teardown()
        },
      }
    }

    // --------------------------------------------------- sidebar decoration

    /**
     * Best-effort hiding of a locked workspace's sessions in the sidebar.
     * Two DOM dialects, probed 2026-09-17:
     *  - dsh-better-workspace tree (the one actually rendered): rows are
     *    .bw-row in document order; a WORKSPACE row carries .bw-row-count or
     *    .bw-row-actions, session rows only .bw-row-label/.bw-row-time. A
     *    sequential scan scopes sessions under their preceding workspace row.
     *  - stock sidebar: projectRow/sessionRow class fragments (kept as
     *    fallback; the served rc.2 frontend itself contains neither string).
     * Workspace rows are matched by display name: leaf of the title, leaf of
     * the path, and the full title. Every element hidden is tagged
     * (HIDDEN_FLAG) so a later pass can restore it when the lock is gone —
     * React does not know about our inline styles and would never reset them.
     */
    function decorateSidebar(workspaces, sessions, locks, lockedSessionTitles) {
      const lockedNames = new Map() // candidate display name -> workspaceId
      if (locks !== null) {
        for (const item of rosterItems(workspaces)) {
          const meta = item && typeof item === 'object' ? workspaceMeta(item) : null
          if (meta === null || !Object.prototype.hasOwnProperty.call(locks, meta.id)) continue
          const titleLeaf = meta.title !== '' ? meta.title.split('/').pop() : ''
          const pathLeaf = meta.path !== '' ? meta.path.split('/').pop() : ''
          for (const candidate of [titleLeaf, pathLeaf, meta.title]) {
            if (typeof candidate === 'string' && candidate !== '') lockedNames.set(candidate, meta.id)
          }
        }
      }

      const hiddenNow = new Set()
      const hide = (el) => {
        if (!el.hasAttribute(HIDDEN_FLAG)) {
          el.setAttribute(HIDDEN_FLAG, '1')
          el.style.display = 'none'
        }
        hiddenNow.add(el)
      }
      const ensureBadge = (row) => {
        if (row.querySelector(':scope > .' + BADGE_CLASS) !== null) return
        const badge = document.createElement('span')
        badge.className = BADGE_CLASS
        badge.setAttribute('aria-hidden', 'true')
        badge.innerHTML = LOCK_CLOSED_SVG
        row.appendChild(badge)
      }
      const removeBadge = (row) => {
        const badge = row.querySelector(':scope > .' + BADGE_CLASS)
        if (badge !== null) badge.remove()
      }

      const bwRows = document.querySelectorAll('.bw-row')
      if (bwRows.length > 0) {
        let inLockedScope = false
        for (const row of bwRows) {
          try {
            const isWorkspaceRow = row.querySelector('.bw-row-count') !== null || row.querySelector('.bw-row-actions') !== null
            const labelEl = row.querySelector('.bw-row-label')
            const label = (labelEl !== null ? labelEl.textContent : row.textContent).replace(/🔒/g, '').trim()
            if (isWorkspaceRow) {
              inLockedScope = lockedNames.has(label)
              if (inLockedScope) ensureBadge(row)
              else removeBadge(row)
            } else if (inLockedScope) {
              hide(row)
            }
          } catch (error) {
            console.error('[workspace-lock] decorate bw row failed:', error)
          }
        }
      } else {
        // Stock dialect: workspace rows by class fragment, sessions hidden
        // within the nearest per-workspace container, or among the following
        // siblings up to the next workspace row.
        const sidebar = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
        if (sidebar !== null && lockedNames.size > 0) {
          for (const row of sidebar.querySelectorAll(PROJECT_ROW_SELECTOR)) {
            try {
              const name = (row.textContent || '').replace(/🔒/g, '').trim()
              if (!lockedNames.has(name)) {
                removeBadge(row)
                continue
              }
              ensureBadge(row)
              let scope = null
              let ancestor = row.parentElement
              for (let depth = 0; ancestor !== null && depth < 5; depth += 1) {
                if (ancestor.querySelector(SESSION_ROW_SELECTOR) !== null) {
                  scope = ancestor
                  break
                }
                ancestor = ancestor.parentElement
              }
              if (scope !== null) {
                for (const sessionRow of scope.querySelectorAll(SESSION_ROW_SELECTOR)) hide(sessionRow)
              } else {
                let sibling = row.nextElementSibling
                while (sibling !== null && !sibling.matches(PROJECT_ROW_SELECTOR)) {
                  if (sibling.matches(SESSION_ROW_SELECTOR)) hide(sibling)
                  sibling = sibling.nextElementSibling
                }
              }
            } catch (error) {
              console.error('[workspace-lock] decorate row failed:', error)
            }
          }
        }
      }

      // Search rows: hide entries whose text matches a locked session title.
      if (lockedSessionTitles.size > 0) {
        for (const row of document.querySelectorAll(SEARCH_ROW_SELECTOR)) {
          try {
            const name = (row.textContent || '').trim()
            if (!lockedSessionTitles.has(name)) continue
            hide(row)
          } catch { /* single row failure must not stop the pass */ }
        }
      }

      // Restore anything we hid that is no longer locked (unlock/remove, or
      // a mis-attributed row). React never resets our inline styles itself.
      for (const el of document.querySelectorAll('[' + HIDDEN_FLAG + ']')) {
        if (hiddenNow.has(el)) continue
        el.removeAttribute(HIDDEN_FLAG)
        el.style.removeProperty('display')
      }
    }

    // ---------------------------------------------------------- React parts

    function PasswordDialog(props) {
      const { mode, name, admin, busy, error, onConfirm, onClose } = props
      const [pw, setPw] = react.useState('')
      const [pw2, setPw2] = react.useState('')
      const mismatch = mode === 'set' && pw.length > 0 && pw2.length > 0 && pw !== pw2
      const canSubmit = mode === 'set' ? (pw.length > 0 && pw === pw2) : pw.length > 0
      const commit = () => { if (canSubmit && !busy && !mismatch) onConfirm(pw) }
      const title = mode === 'set' ? T('dlg.set.title') : mode === 'unlock' ? T('dlg.unlock.title') : T('dlg.remove.title')
      const hint = mode === 'set'
        ? T('dlg.set.hint')
        : mode === 'unlock'
          ? (admin ? T('adminHint') : T('dlg.unlock.hint'))
          : T('dlg.remove.hint')
      const confirmLabel = mode === 'set' ? T('set') : mode === 'unlock' ? T('unlock') : T('remove')
      return h('div', {
        className: 'workspace-lock-modalBack',
        onMouseDown: (event) => { if (event.target === event.currentTarget && !busy) onClose() },
      },
        h('div', { className: 'workspace-lock-modal', role: 'dialog', 'aria-modal': 'true' },
          h('p', { className: 'workspace-lock-modalTitle' }, title + ' · ' + name),
          h('div', { className: 'workspace-lock-field' },
            h('input', {
              type: 'password', autoFocus: true, className: 'workspace-lock-input', value: pw,
              placeholder: T('dlg.pw'), disabled: busy,
              onChange: (e) => setPw(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') commit() },
            }),
            mode === 'set' ? h('input', {
              type: 'password', className: 'workspace-lock-input', value: pw2,
              placeholder: T('dlg.pw2'), disabled: busy, style: { marginTop: 8 },
              onChange: (e) => setPw2(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') commit() },
            }) : null,
          ),
          h('p', { className: 'workspace-lock-modalHint' }, hint),
          mismatch ? h('p', { className: 'workspace-lock-modalErr' }, T('dlg.mismatch')) : null,
          error ? h('p', { className: 'workspace-lock-modalErr' }, error) : null,
          h('div', { className: 'workspace-lock-modalActions' },
            h('button', { type: 'button', className: 'workspace-lock-btn', onClick: onClose, disabled: busy }, T('cancel')),
            h('button', {
              type: 'button', className: 'workspace-lock-btn ' + (mode === 'remove' ? 'workspace-lock-btnDanger' : 'workspace-lock-btnPrimary'),
              onClick: commit, disabled: !canSubmit || busy || mismatch,
            }, busy ? T('dlg.busy') : confirmLabel),
          ),
        ),
      )
    }

    function LockScreen(props) {
      const { name, admin, busy, error, onSubmit } = props
      const [pw, setPw] = react.useState('')
      const commit = () => { if (pw.length > 0 && !busy) onSubmit(pw) }
      return h('div', { className: 'workspace-lock-lockWrap' },
        h('div', { className: 'workspace-lock-lockCard' },
          h('div', { className: 'workspace-lock-lockIcon', dangerouslySetInnerHTML: { __html: LOCK_CLOSED_SVG } }),
          h('p', { className: 'workspace-lock-lockTitle' }, T('lockTitle')),
          h('p', { className: 'workspace-lock-lockName' }, name),
          h('p', { className: 'workspace-lock-lockHint' }, admin ? T('adminHint') : T('lockHint')),
          h('input', {
            type: 'password', autoFocus: true, className: 'workspace-lock-input', value: pw,
            placeholder: T('dlg.pw'), disabled: busy,
            onChange: (e) => setPw(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') commit() },
          }),
          busy ? h('p', { className: 'workspace-lock-modalHint' }, T('dlg.busy')) : null,
          error ? h('p', { className: 'workspace-lock-modalErr' }, error) : null,
          h('button', {
            type: 'button', className: 'workspace-lock-btn workspace-lock-btnPrimary',
            style: { marginTop: 14, width: '100%', padding: '8px 10px' },
            onClick: commit, disabled: pw.length === 0 || busy,
          }, busy ? T('dlg.busy') : T('unlock')),
          h('p', { className: 'workspace-lock-lockSub' }, T('lockSubHint')),
        ),
      )
    }

    // --------------------------------------------------------- context menu

    /**
     * Resolve the workspace row under a contextmenu target. Only WORKSPACE
     * rows qualify (bw dialect: .bw-row carrying .bw-row-count or
     * .bw-row-actions; stock dialect: projectRow). The workspace is matched
     * by display name (leaf of title / leaf of path / full title) — the same
     * key the sidebar decorator uses.
     */
    function resolveWorkspaceHit(target, locks, workspaces) {
      if (locks === null) return null
      if (target === null || typeof target.closest !== 'function') return null
      const row = target.closest('.bw-row, ' + PROJECT_ROW_SELECTOR)
      if (row === null) return null
      const isBwRow = row.classList.contains('bw-row')
      if (isBwRow) {
        const isWorkspaceRow = row.querySelector('.bw-row-count') !== null || row.querySelector('.bw-row-actions') !== null
        if (!isWorkspaceRow) return null
      }
      const labelEl = row.querySelector('.bw-row-label')
      const name = ((labelEl !== null ? labelEl.textContent : row.textContent) || '').replace(/🔒/g, '').trim()
      if (name === '') return null
      for (const item of rosterItems(workspaces)) {
        const meta = item && typeof item === 'object' ? workspaceMeta(item) : null
        if (meta === null) continue
        const titleLeaf = meta.title !== '' ? meta.title.split('/').pop() : ''
        const pathLeaf = meta.path !== '' ? meta.path.split('/').pop() : ''
        if (name === meta.title || (titleLeaf !== '' && name === titleLeaf) || (pathLeaf !== '' && name === pathLeaf)) {
          return { meta, name: meta.title !== '' ? meta.title : meta.id }
        }
      }
      return null
    }

    /**
     * The plugin's card on the Settings → Plugins (插件配置) tab, registered
     * into the `settings.plugin.item` slot keyed by our namespace (the tab
     * pairs served namespaces with these cards). Own chrome per the slot
     * contract. Edits the ADMIN password through our own /api/workspace-locks/admin-*
     * routes — first-time set is open; re-set/clear requires the current
     * admin password.
     */
    function AdminCard(props) {
      const { admin, onSave, onClear } = props
      const rootRef = react.useRef(null)
      const chevRef = react.useRef(null)
      const [chrome, setChrome] = react.useState(null)
      const [open, setOpen] = react.useState(false)
      // Adopt the host PluginCard chrome: the tab renders other cards next to
      // ours — read a sibling card's wrapper/header/title/desc classes and
      // its chevron markup, then reuse them verbatim. The host wins the
      // cascade (our <style> is head-first), so the card looks native and
      // follows the host theme; with no sibling card we keep our own look.
      react.useEffect(() => {
        let tries = 0
        const adopt = () => {
          try {
            const root = rootRef.current
            const wrap = root && root.parentElement
            const list = wrap && wrap.parentElement
            if (!wrap || !list) return false
            // Find the NEAREST sibling card wrapper (host cards surround us
            // in the same list); ours is skipped via containment.
            const kids = [...list.children]
            const myIndex = kids.indexOf(wrap)
            let best = null
            let bestDist = Infinity
            for (let i = 0; i < kids.length; i++) {
              const w = kids[i]
              if (w === wrap || w.contains(root) || root.contains(w)) continue
              const head = w.querySelector('button[aria-expanded]') || w.querySelector(':scope > button')
              if (!head) continue
              const dist = Math.abs(i - myIndex)
              if (dist < bestDist) { bestDist = dist; best = { w, head } }
            }
            if (!best) return false
            const { w, head } = best
            // 0.14-era host card: wrapper (no class) > div.setCard (the box)
            //   > button.setHeader > [div.setHeadText > (setName, setDesc),
            //   span.setChevron(svg)]. The BOX is the header's parent.
            const cardEl = head.parentElement
            const cardCls = cardEl && cardEl !== w ? String(cardEl.className || '') : String(w.className || '')
            const textWrap = head.querySelector(':scope > div')
            const textDivs = textWrap ? [...textWrap.children].filter(c => c.tagName === 'DIV') : []
            const chev = head.lastElementChild
            setChrome({
              cardCls,
              headCls: String(head.className || ''),
              textWrapCls: textWrap ? String(textWrap.className) : '',
              nameCls: textDivs[0] ? String(textDivs[0].className) : '',
              descCls: textDivs[1] ? String(textDivs[1].className) : '',
              chevHtml: chev ? chev.outerHTML : '',
            })
            return true
          } catch { return false }
        }
        if (adopt()) return
        const timer = setInterval(() => {
          tries += 1
          if (adopt() || tries >= 8) clearInterval(timer)
        }, 400)
        return () => clearInterval(timer)
      }, [])
      // Drop the host chevron markup in once it is known (it is a themed
      // svg/span owned by the host stylesheet).
      react.useEffect(() => {
        if (chrome && chrome.chevHtml && chevRef.current) chevRef.current.innerHTML = chrome.chevHtml
      }, [chrome])
      const [current, setCurrent] = react.useState('')
      const [pw, setPw] = react.useState('')
      const [busy, setBusy] = react.useState(false)
      const [localSet, setLocalSet] = react.useState(null)
      const [msg, setMsg] = react.useState(null) // { text, error }
      const isSet = localSet !== null ? localSet : admin
      const run = async (action) => {
        if (busy) return
        setBusy(true)
        setMsg(null)
        const result = await action()
        setBusy(false)
        if (result.ok) {
          setCurrent('')
          setPw('')
          setLocalSet(result.cleared ? false : true)
          setMsg({ text: result.cleared ? T('card.cleared') : T('card.saved') })
        } else {
          setMsg({ text: result.error || T('dlg.wrong'), error: true })
        }
      }
      const save = () => {
        if (pw.length === 0 || busy) return
        if (admin && current.length === 0) { setMsg({ text: T('card.currentRequired'), error: true }); return }
        void run(() => onSave({ current, password: pw }))
      }
      const clear = () => {
        if (busy) return
        if (current.length === 0) { setMsg({ text: T('card.currentRequired'), error: true }); return }
        void run(() => onClear({ current }))
      }
      const adopted = chrome !== null
      const headChildren = adopted
        ? [
            h('div', { className: chrome.textWrapCls || 'workspace-lock-adminHeadMain', key: 'x' },
              h('div', { className: chrome.nameCls || 'workspace-lock-adminTitle' }, T('card.title')),
              h('div', { className: chrome.descCls || 'workspace-lock-adminStatus' }, isSet ? T('card.set') : T('card.unset')),
            ),
            h('span', { className: 'workspace-lock-adminChevron', 'aria-hidden': 'true', ref: chevRef, key: 'c' }),
          ]
        : [
            h('span', { className: 'workspace-lock-adminHeadMain', key: 'm' },
              h('span', { className: 'workspace-lock-adminTitle' }, T('card.title')),
              h('span', { className: 'workspace-lock-adminStatus' }, isSet ? T('card.set') : T('card.unset')),
            ),
            h('span', { className: 'workspace-lock-adminChevron', 'aria-hidden': 'true', key: 'c' }, open ? '⌄' : '›'),
          ]
      return h('div', {
        ref: rootRef,
        className: (adopted ? chrome.cardCls + ' ' : '') + 'workspace-lock-adminCard' + (adopted ? ' workspace-lock-adopted' : ''),
      },
        h('button', {
          type: 'button', className: (adopted ? chrome.headCls + ' ' : '') + 'workspace-lock-adminHead',
          onClick: () => setOpen(!open),
          'aria-expanded': open,
        }, headChildren),
        open ? h('div', { className: 'workspace-lock-adminBody' },
          h('p', { className: 'workspace-lock-adminDesc' }, T('card.desc')),
          h('div', { className: 'workspace-lock-adminField' },
            h('span', { className: 'workspace-lock-adminFieldLabel' }, T('card.current')),
            h('input', {
              type: 'password', className: 'workspace-lock-input', value: current, disabled: busy || !admin,
              placeholder: admin ? T('card.current') : '—',
              onChange: (e) => setCurrent(e.target.value),
            }),
          ),
          h('div', { className: 'workspace-lock-adminField' },
            h('span', { className: 'workspace-lock-adminFieldLabel' }, T('card.new')),
            h('input', {
              type: 'password', className: 'workspace-lock-input', value: pw, disabled: busy,
              placeholder: T('card.new'),
              onChange: (e) => setPw(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') save() },
            }),
          ),
          h('div', { className: 'workspace-lock-adminActions' },
            h('button', {
              type: 'button', className: 'workspace-lock-btn workspace-lock-btnPrimary',
              onClick: save, disabled: busy || pw.length === 0 || (admin && current.length === 0),
            }, busy ? T('card.busy') : T('card.save')),
            isSet ? h('button', {
              type: 'button', className: 'workspace-lock-btn workspace-lock-btnDanger',
              onClick: clear, disabled: busy || current.length === 0,
            }, T('card.clear')) : null,
          ),
          msg ? h('p', { className: 'workspace-lock-adminMsg' + (msg.error ? ' workspace-lock-adminErr' : '') }, msg.text) : null,
        ) : null,
      )
    }

    // ----------------------------------------------------------------- apply

    function apply(ctx) {
      // A duplicated client injection must not mount a second UI.
      if (window.__workspaceLockApplied === true) return
      window.__workspaceLockApplied = true

      try {
        ensureStyles() // nothing else guarantees the stylesheet now that the sidebar entry is gone
        const workspaces = ctx.get('workspaces')
        // The sessions service may not be registered yet when apply runs, and
        // its context key differs across cores — resolve lazily, trying the
        // known candidates once per tick until one sticks.
        let sessions = null
        let sessionsKey = null
        const unsubscribers = []
        const SESSION_KEYS = ['sessions', 'session']
        const resolveSessions = () => {
          if (sessions !== null) return sessions
          for (const key of SESSION_KEYS) {
            try {
              const svc = ctx.get(key)
              if (svc && svc.list && typeof svc.list.getSnapshot === 'function') {
                sessions = svc
                sessionsKey = key
                try { unsubscribers.push(svc.list.subscribe(() => scheduleSync())) } catch { /* optional */ }
                break
              }
            } catch { /* not registered yet */ }
          }
          return sessions
        }

        const store = createStore()

        // ---- actions --------------------------------------------------------

        const openDialog = (mode, meta) => {
          store.set({ dialog: { mode, name: meta.title !== '' ? meta.title : meta.id, workspaceId: meta.id }, dialogError: '' })
        }
        const actions = {
          closeDialog: () => { store.set({ dialog: null, dialogError: '' }) },
          submitDialog: async (pw) => {
            const { dialog } = store.get()
            if (dialog === null) return
            store.set({ busy: true, dialogError: '' })
            try {
              if (dialog.mode === 'set') {
                await postLock('set', { workspaceId: dialog.workspaceId, password: pw })
                const data = await fetchLocks()
                const unlocked = new Set(store.get().unlocked); unlocked.add(dialog.workspaceId)
                store.set({ locks: data.locks, admin: data.admin, unlocked })
              } else if (dialog.mode === 'unlock') {
                const result = await postLock('unlock', { workspaceId: dialog.workspaceId, password: pw })
                const unlocked = new Set(store.get().unlocked)
                if (result.master === true) {
                  // Admin password: unlock EVERY locked workspace in this page.
                  for (const id of Object.keys(store.get().locks ?? {})) unlocked.add(id)
                }
                unlocked.add(dialog.workspaceId)
                store.set({ unlocked })
              } else {
                await postLock('remove', { workspaceId: dialog.workspaceId, password: pw })
                const data = await fetchLocks()
                const unlocked = new Set(store.get().unlocked); unlocked.delete(dialog.workspaceId)
                store.set({ locks: data.locks, admin: data.admin, unlocked })
              }
              store.set({ dialog: null, dialogError: '', busy: false })
            } catch (error) {
              const message = error && error.code === 'wrong-password' ? T('dlg.wrong') : String(error && error.message || error)
              store.set({ busy: false, dialogError: message })
            }
          },
          adminSave: async ({ current, password }) => {
            try {
              const result = await postLock('admin-set', { current: current || undefined, password })
              if (result.ok !== true) return { ok: false, error: T('dlg.wrong') }
              const data = await fetchLocks()
              store.set({ locks: data.locks, admin: data.admin })
              return { ok: true }
            } catch (error) {
              return { ok: false, error: error && error.code === 'wrong-password' ? T('dlg.wrong') : String(error && error.message || error) }
            }
          },
          adminClear: async ({ current }) => {
            try {
              const result = await postLock('admin-clear', { current })
              if (result.ok !== true) return { ok: false, error: T('dlg.wrong') }
              const data = await fetchLocks()
              store.set({ locks: data.locks, admin: data.admin })
              return { ok: true, cleared: true }
            } catch (error) {
              return { ok: false, error: error && error.code === 'wrong-password' ? T('dlg.wrong') : String(error && error.message || error) }
            }
          },
          submitLockScreen: async (pw) => {
            const { activeWsId } = derived
            if (activeWsId === undefined) return
            store.set({ busy: true, lockError: '' })
            try {
              const result = await postLock('unlock', { workspaceId: activeWsId, password: pw })
              const unlocked = new Set(store.get().unlocked)
              if (result.master === true) {
                // Admin password: unlock EVERY locked workspace in this page.
                for (const id of Object.keys(store.get().locks ?? {})) unlocked.add(id)
              }
              unlocked.add(activeWsId)
              store.set({ unlocked, busy: false })
            } catch (error) {
              const message = error && error.code === 'wrong-password' ? T('dlg.wrong') : String(error && error.message || error)
              store.set({ busy: false, lockError: message })
            }
          },
        }

        // ---- rendering surfaces ---------------------------------------------

        const dialogHost = document.createElement('div')
        dialogHost.setAttribute('data-workspace-lock-dialogs', '')
        let dialogRoot = null
        const renderDialog = () => {
          const raw = store.get()
          if (raw.dialog === null) {
            if (dialogRoot !== null) {
              try { dialogRoot.render(null) } catch { /* host going away anyway */ }
            }
            return
          }
          if (!dialogHost.isConnected) {
            document.body.appendChild(dialogHost)
            dialogRoot = createRoot(dialogHost)
          }
          dialogRoot.render(h(PasswordDialog, {
            mode: raw.dialog.mode,
            name: raw.dialog.name,
            admin: raw.admin,
            busy: raw.busy,
            error: raw.dialogError,
            onConfirm: actions.submitDialog,
            onClose: actions.closeDialog,
          }))
        }

        // Derived values recomputed each tick; the takeover render closure
        // reads them through `derived`.
        const derived = { view: 'none', activeWsId: undefined, lockedSessionTitles: new Set(), lockName: '', hiddenLocks: null }

        const takeover = createTakeover({
          render: (root) => {
            try {
              const raw = store.get()
              if (raw.dialog !== null) return // modal covers the screen; keep the panel mounted
              root.render(h(LockScreen, {
                name: derived.lockName,
                admin: raw.admin,
                busy: raw.busy,
                error: raw.lockError,
                onSubmit: actions.submitLockScreen,
              }))
            } catch (error) {
              console.error('[workspace-lock] render failed:', error)
            }
          },
        })

        // One setTimeout-coalesced pass drives everything (rAF is unusable
        // in this embedded renderer): derived state, lock-screen visibility,
        // dialog host, sidebar decoration. The body-wide MutationObserver
        // both self-heals the takeover (React re-renders) and re-runs
        // decoration for new rows; the store subscription keeps the UI in
        // step with action-driven data changes. The tick never calls
        // store.set, so no render loop is possible.
        let scheduled = false
        let disposed = false
        const tick = () => {
          scheduled = false
          if (disposed) return
          const raw = store.get()
          try {
            const sessionsSvc = resolveSessions()
            const activeWsId = deriveActive(workspaces, sessionsSvc)
            // Locks effective for THIS page: server locks minus the ones
            // unlocked in-page (a refresh restores the full set).
            const hiddenLocks = raw.locks === null
              ? null
              : Object.fromEntries(Object.entries(raw.locks).filter(([id]) => !raw.unlocked.has(id)))
            const lockedSessionTitles = collectLockedSessionTitles(workspaces, sessionsSvc, hiddenLocks)
            const activeLocked = activeWsId !== undefined && hiddenLocks !== null
              && Object.prototype.hasOwnProperty.call(hiddenLocks, activeWsId)
            const activeMeta = activeLocked
              ? rosterItems(workspaces).map(workspaceMeta).filter(Boolean).find((meta) => meta.id === activeWsId)
              : null
            derived.view = activeLocked ? 'lock' : 'none'
            derived.activeWsId = activeWsId
            derived.lockedSessionTitles = lockedSessionTitles
            derived.hiddenLocks = hiddenLocks
            derived.lockName = activeLocked ? (activeMeta && activeMeta.title !== '' ? activeMeta.title : activeWsId) : ''
          } catch (error) {
            console.error('[workspace-lock] derive failed:', error)
          }
          try { takeover.setActive(derived.view !== 'none') } catch (error) { console.error('[workspace-lock] takeover failed:', error) }
          try { renderDialog() } catch (error) { console.error('[workspace-lock] dialog failed:', error) }
          try { decorateSidebar(workspaces, resolveSessions(), derived.hiddenLocks, derived.lockedSessionTitles) } catch (error) { console.error('[workspace-lock] decorate failed:', error) }
        }
        const scheduleSync = () => {
          if (scheduled || disposed) return
          scheduled = true
          setTimeout(tick, 0)
        }

        store.subscribe(scheduleSync)

        // Host data changes (roster, current session) re-drive everything;
        // the sessions subscription is attached by resolveSessions on first
        // resolution.
        try { unsubscribers.push(workspaces.list.subscribe(scheduleSync)) } catch { /* roster face unavailable */ }

        // Settings → Plugins card: registered into the settings.plugin.item
        // slot keyed by our namespace. The tab only dispatches keys whose
        // namespace the host serves (our server half registers 'workspace-lock').
        // Same wiring dsh-market uses for its own card.
        ctx.inject(['settingsScope'], (scoped) => {
          try {
            scoped.slots.inject('settings.plugin.item', () => scoped.slots.register({
              name: 'settings.plugin.item',
              key: 'workspace-lock',
            }, () => h(AdminCard, {
              admin: store.get().admin,
              onSave: actions.adminSave,
              onClear: actions.adminClear,
            })))
          } catch (error) {
            console.error('[workspace-lock] settings card registration failed:', error)
          }
        })

        // ---- right-click menu ------------------------------------------------
        //
        // contextmenu on a workspace row: preventDefault (kills the native
        // browser menu) and open OUR OWN menu at the cursor IMMEDIATELY —
        // zero dependency on dsh-better-workspace (whose context menu broke
        // with its 0.14.0 auto-update). Opportunistic upgrade: if bw's own
        // context menu still appears within ~600ms, ours closes and the same
        // items are injected into it so they render as native menu rows.

        let fallbackEl = null
        let ctxPending = null
        let ctxTimer = null

        const closeFallbackMenu = () => {
          if (fallbackEl !== null) {
            fallbackEl.remove()
            fallbackEl = null
          }
        }

        const menuActionsFor = (id) => {
          const raw = store.get()
          const locked = raw.locks !== null && Object.prototype.hasOwnProperty.call(raw.locks, id)
          const pageUnlocked = raw.unlocked.has(id)
          if (!locked) return [{ mode: 'set', label: T('set'), icon: 'closed' }]
          const actions = []
          if (!pageUnlocked) actions.push({ mode: 'unlock', label: T('unlock'), icon: 'open' })
          actions.push({ mode: 'remove', label: T('remove'), icon: 'closed', danger: true })
          return actions
        }

        /** Close the host's portal menu by firing outside-pointer events. */
        const closeHostMenu = () => {
          try {
            document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
            document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          } catch { /* menu closes on its own eventually */ }
        }

    /**
     * Append 加锁/解锁/移除锁 to the host menu by CLONING one of its own
     * item wrappers (0.14: `_itemWrap_` with a `button[role=menuitem]`
     * inside) — the clone inherits the current build's styling exactly.
     * Icons: official primitives have no lock glyph, so we inline Outline16-
     * style padlocks; 移除锁 clones the native DANGER item (删除工作区) and
     * keeps its danger styling. Returns false when the menu has no native
     * item to clone.
     */
    const injectCtxItems = (menu, hit) => {
      for (const stale of menu.querySelectorAll('[' + CTX_ITEM_ATTR + ']')) stale.remove()
      const nativeItems = [...menu.querySelectorAll('[role="menuitem"]')].filter(i => !i.closest('[' + CTX_ITEM_ATTR + ']'))
      const normalTpl = nativeItems.length ? nativeItems[0].parentElement : null
      const dangerNative = nativeItems.find(i => /danger/i.test(String(i.className)))
      const dangerTpl = dangerNative ? dangerNative.parentElement : normalTpl
      if (normalTpl === null || dangerTpl === null) return false
      for (const action of menuActionsFor(hit.meta.id)) {
        const wrap = (action.danger ? dangerTpl : normalTpl).cloneNode(true)
        wrap.setAttribute(CTX_ITEM_ATTR, '')
        const iconSpan = wrap.querySelector('[class*="itemIcon"]')
        if (iconSpan !== null) iconSpan.innerHTML = action.icon === 'open' ? LOCK_OPEN_SVG : LOCK_CLOSED_SVG
        const labelSpan = wrap.querySelector('[class*="itemLabel"]')
        if (labelSpan !== null) labelSpan.textContent = action.label
        const btn = wrap.querySelector('[role="menuitem"]')
        if (btn !== null) {
          btn.addEventListener('click', (event) => {
            event.stopPropagation()
            closeHostMenu()
            openDialog(action.mode, hit.meta)
          })
        } else {
          wrap.addEventListener('click', () => { closeHostMenu(); openDialog(action.mode, hit.meta) })
        }
        menu.appendChild(wrap)
      }
      return true
    }

    const openFallbackMenu = (hit, x, y) => {
          ensureStyles()
          closeFallbackMenu()
          const back = document.createElement('div')
          back.className = 'workspace-lock-menuBack'
          back.setAttribute('data-workspace-lock-menu', '')
          back.addEventListener('mousedown', (event) => { if (event.target === back) closeFallbackMenu() })
          const menu = document.createElement('div')
          menu.className = 'workspace-lock-menu'
          for (const action of menuActionsFor(hit.meta.id)) {
            const item = document.createElement('button')
            item.type = 'button'
            item.className = 'workspace-lock-menuItem' + (action.danger ? ' workspace-lock-menuDanger' : '')
            const icon = document.createElement('span')
            icon.className = 'workspace-lock-menuIcon'
            icon.innerHTML = action.icon === 'open' ? LOCK_OPEN_SVG : LOCK_CLOSED_SVG
            const label = document.createElement('span')
            label.textContent = action.label
            item.appendChild(icon)
            item.appendChild(label)
            item.addEventListener('click', () => {
              closeFallbackMenu()
              openDialog(action.mode, hit.meta)
            })
            menu.appendChild(item)
          }
          menu.style.left = Math.max(4, Math.min(x, window.innerWidth - 180)) + 'px'
          menu.style.top = Math.max(4, Math.min(y, window.innerHeight - 110)) + 'px'
          back.appendChild(menu)
          document.body.appendChild(back)
          fallbackEl = back
        }

        const onContextMenu = (event) => {
          try {
            closeFallbackMenu()
            const raw = store.get()
            const target = event.target
            const hit = target instanceof Element ? resolveWorkspaceHit(target, raw.locks, workspaces) : null
            if (hit === null) return // not a workspace row: native/bw menus behave as usual
            event.preventDefault()
            openFallbackMenu(hit, event.clientX, event.clientY)
            ctxPending = hit
            if (ctxTimer !== null) clearTimeout(ctxTimer)
            let attempts = 0
            const tryUpgrade = () => {
              ctxTimer = null
              if (disposed || ctxPending !== hit) return
              const menu = findHostMenu()
              if (menu !== null && menu.isConnected && injectCtxItems(menu, hit)) {
                // The host's own menu showed up — hand over to it.
                ctxPending = null
                closeFallbackMenu()
                return
              }
              attempts += 1
              if (attempts >= 10) { ctxPending = null; return } // no host menu: ours stays
              ctxTimer = setTimeout(tryUpgrade, 60)
            }
            ctxTimer = setTimeout(tryUpgrade, 60)
          } catch (error) {
            console.error('[workspace-lock] context menu failed:', error)
          }
        }
        document.addEventListener('contextmenu', onContextMenu, true)

        const bodyObserver = new MutationObserver(scheduleSync)
        bodyObserver.observe(document.body, { childList: true, subtree: true })

        void fetchLocks()
          .then((data) => { store.set({ locks: data.locks, admin: data.admin }) })
          .catch((error) => { console.error('[workspace-lock] initial lock fetch failed:', error) })
          .finally(scheduleSync)

        // Diagnosis hook (removed on dispose): derived state at a glance.
        window.__workspaceLockDebug = () => {
          const raw = store.get()
          const sessionsSvc = resolveSessions()
          let current = 'unavailable'
          try { current = sessionsSvc ? sessionsSvc.list.getSnapshot().current : undefined } catch (e) { current = 'ERR:' + e }
          return {
            sessionsKey,
            current,
            activeWsId: derived.activeWsId,
            view: derived.view,
            locksCount: raw.locks ? Object.keys(raw.locks).length : null,
            admin: raw.admin,
            ls: window.localStorage.getItem(CURRENT_SESSION_KEY),
          }
        }

        ctx.effect(() => {
          return () => {
            disposed = true
            try { delete window.__workspaceLockDebug } catch { /* older engines */ }
            for (const unsubscribe of unsubscribers) {
              try { unsubscribe() } catch { /* already torn down */ }
            }
            document.removeEventListener('contextmenu', onContextMenu, true)
            if (ctxTimer !== null) clearTimeout(ctxTimer)
            ctxPending = null
            closeFallbackMenu()
            try { bodyObserver.disconnect() } catch { /* already gone */ }
            try { dialogRoot?.unmount() } catch { /* already gone */ }
            dialogRoot = null
            dialogHost.remove()
            try { takeover.dispose() } catch { /* already gone */ }
            window.__workspaceLockApplied = false
          }
        }, 'workspace-lock: ui')

        scheduleSync()
      } catch (error) {
        window.__workspaceLockApplied = false
        console.error('[workspace-lock] apply failed:', error)
      }
    }

    exports.apply = apply
    exports.inject = ['workspaces', 'slots']
    return module.exports
  },
})
