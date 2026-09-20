// Client-half smoke test for dsh-workspace-lock (plain Node, no browser).
// Simulates the browser ModuleLoader with exactly the 9 specifiers the
// stock 0.1.5-rc.2 frontend registers, loads lib/client.js, runs its
// factory, and (1) verifies the entry exports, (2) verifies the factory
// requires ONLY shell-guaranteed modules (react / react-dom/client) — the
// classic "missed the module table" gate — and (3) runs apply() against a
// stub ctx + stub DOM (no sidebar/column present: every mount no-ops) and
// checks the injected effect disposes cleanly.
// Usage: node smoke_client.js
'use strict';
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log('OK', label);
  else { failures += 1; console.error('FAIL', label, detail === undefined ? '' : '— ' + detail); }
};

// ---- console.error must stay silent (the plugin logs, never throws) -------
const consoleErrors = [];
const origConsoleError = console.error;
console.error = (...a) => { consoleErrors.push(a.map((x) => String(x)).join(' ')); };

// ---- frozen module table (stock 0.1.5-rc.2 seed words) ---------------------
const reactNs = {
  Fragment: Symbol('Fragment'),
  createElement: () => null,
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useMemo: (f) => f(),
  useRef: (v) => ({ current: v }),
  useCallback: (f) => f,
  useReducer: (r, i) => [i, () => {}],
};
const required = [];
const table = {
  'react': reactNs,
  'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: reactNs.Fragment },
  'react-dom': { createPortal: () => null },
  'react-dom/client': { createRoot: () => ({ render() {}, unmount() {} }) },
  '@deepseek-ai/cordis': new Proxy({}, { get: (t, k) => (k === '__esModule' ? true : () => null) }),
  '@deepseek-ai/dsh-client-store': { defineStore: (s) => ({ s }), createSnapshotStore: () => ({}) },
  '@deepseek-ai/dsh-client-ui-slots': new Proxy({}, { get: (t, k) => (k === '__esModule' ? true : () => null) }),
  '@deepseek-ai/dsh-client-ui-primitives': new Proxy({}, { get: (t, k) => (k === '__esModule' ? true : () => null) }),
  '@deepseek-ai/dsh-client-ui-dockkit': new Proxy({}, { get: (t, k) => (k === '__esModule' ? true : () => null) }),
};
const requireMock = (id) => {
  required.push(id);
  if (!(id in table)) throw new Error('missed the module table: ' + id);
  return table[id];
};

// ---- minimal DOM stubs (everything missing -> mounts no-op safely) ---------
const makeEl = () => ({
  style: { setProperty() {}, removeProperty() {} },
  dataset: {},
  classList: { contains: () => false },
  children: [],
  textContent: '',
  innerHTML: '',
  isConnected: false,
  setAttribute() {},
  getAttribute: () => null,
  removeAttribute() {},
  hasAttribute: () => false,
  appendChild() {},
  insertAdjacentElement() {},
  remove() {},
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  matches: () => false,
  contains: () => false,
  closest: () => null,
  parentElement: null,
  nextElementSibling: null,
});
const listeners = [];
globalThis.Element = class Element {};
globalThis.window = globalThis;
globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.localStorage = {
  store: { 'dsh.sessions.current': JSON.stringify('sess-1') },
  getItem(k) { return k in this.store ? this.store[k] : null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
};
globalThis.document = {
  head: makeEl(),
  body: makeEl(),
  documentElement: makeEl(),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => makeEl(),
  addEventListener: (...args) => listeners.push(args),
  removeEventListener: (...args) => {
    const i = listeners.findIndex((l) => l[0] === args[0] && l[1] === args[1]);
    if (i >= 0) listeners.splice(i, 1);
  },
};

// ---- host service stubs ----------------------------------------------------
const workspaces = {
  list: {
    getSnapshot: () => ({
      items: [
        { workspaceId: 'ws-demo', title: 'Demo 工作区', path: '/root/ws/demo', sessionIds: ['sess-1'] },
        { workspaceId: 'ws-open', title: 'Open', path: '/root/ws/open', sessionIds: ['sess-2'] },
      ],
    }),
    subscribe: () => () => {},
  },
};
const sessions = {
  list: {
    getSnapshot: () => ({ current: 'sess-1', byId: { 'sess-1': { title: 'Secret session' } } }),
    subscribe: () => () => {},
  },
};
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, locks: { 'ws-demo': { s: 'aa', h: 'bb', t: '2026-09-17T00:00:00Z' } } }),
});

// ---- load the bundle -------------------------------------------------------
let captured = null;
globalThis.__ModuleLoader__ = { load: (m) => { captured = m; } };
eval(fs.readFileSync(path.join(__dirname, '..', 'dsh-workspace-lock', 'lib', 'client.js'), 'utf8'));

check('ModuleLoader.load called', captured !== null);
check('module id', captured && captured.id === 'dsh-workspace-lock', captured && captured.id);

const mod = captured.factory(requireMock);
check('exports apply', typeof mod.apply === 'function');
check('exports inject', JSON.stringify(mod.inject) === '["workspaces","slots"]', JSON.stringify(mod.inject));
check(
  'requires only shell-guaranteed modules',
  required.length > 0 && required.every((id) => id === 'react' || id === 'react-dom/client'),
  '[' + required.join(', ') + ']',
);

// ---- run apply against the stub ctx ---------------------------------------
let capturedDispose = null;
let effectLabel = null;
const ctx = {
  logger: { info() {} },
  get: (key) => {
    if (key === 'workspaces') return workspaces;
    if (key === 'sessions') return sessions;
    throw new Error('unknown service: ' + key);
  },
  effect: (cb, label) => { effectLabel = label; capturedDispose = cb(); },
  inject: (deps, cb) => {
    if (deps.includes('settingsScope')) return cb({ slots: { inject() {}, register() { return () => {}; } } });
    return undefined;
  },
};
mod.apply(ctx);

const flush = () => new Promise((resolve) => setImmediate(resolve));
// Top-level await would make this CJS file ambiguous under Node 24 — the
// async tail runs in an IIFE instead. The plugin schedules its ticks with
// setTimeout(0) since the fix, so give the timer queue real time to run.
(async () => {
await flush();
await new Promise((resolve) => setTimeout(resolve, 80));
await flush();

check('effect registered', effectLabel === 'workspace-lock: ui', effectLabel);
check('guard set', globalThis.__workspaceLockApplied === true);
check('no console.error during apply/tick', consoleErrors.length === 0, consoleErrors.join(' | '));

if (capturedDispose) capturedDispose();
check('dispose resets guard', globalThis.__workspaceLockApplied === false);
check('click listener removed', listeners.length === 0);

console.error = origConsoleError;
if (consoleErrors.length) console.log('CAPTURED console.error:', consoleErrors.join(' | '));
if (failures > 0) {
  console.error(`smoke_client: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('smoke_client: ALL PASS');
})();
