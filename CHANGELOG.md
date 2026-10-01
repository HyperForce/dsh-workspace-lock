# Changelog

## v0.4.0 (2026-09-25)

- Adapted to DSH 0.1.7: `settings.register` was removed, so the admin-password page now registers into the `plugins.bundle.config` slot (keyed by package name); the rc.2-era `settings.plugin.item` card seat is kept for older hosts.
- Stock-sidebar support: the row's "…" hover button is a menu trigger and its native menu (重命名 / 删除工作区) receives the lock items; host-menu detection keys on new `[role="menu"]` elements (baseline diff).
- Center-column takeover also matches `[data-panel-conversation]` (0.1.7 layout marker); the sidebar decoration scan falls back to the whole document and always runs, so stale badges are stripped when the last lock is removed.
- AdminCard rewritten standalone (own tokens, no host-chrome adoption), reactive to store changes.
- Verified end-to-end on 0.1.7-rc.1 and, unchanged, on 0.2.0-rc.1/rc.2.

## v0.3.6

- Settings card subtitle shows a short plugin description; the admin-password status moved into the expanded body.

## v0.3.5

- Escape closes the context menu; minimized native-impact audit.

## v0.3.4

- First public release (repo renamed from dsh-ws-lock; no abbreviated names anywhere).

## v0.1.0 – v0.3.3 (pre-publish)

- v0.1.0: sidebar entry + manager panel (archived).
- v0.2.0: right-click interaction — 加锁/解锁/移除锁 injected into the sidebar's own context menu, own themed menu as fallback.
- v0.2.1: theme tokens follow the system via `prefers-color-scheme`.
- v0.3.0: admin master password (salted hash only, unlock-all, authorizes any unlock/remove; re-set/clear requires the current one).
- v0.3.1 – v0.3.3: collapsible settings card adopting the host PluginCard chrome (era-specific trick, dropped in v0.4.0).
