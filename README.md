# dsh-workspace-lock

[English](#english) | [中文](#中文)

Per-workspace password locks for the DeepSeek Harness (DSH) web UI. Right-click a
workspace in the sidebar to lock it; its sessions hide and the chat area is
replaced by a lock screen until the correct password is entered.

为 DeepSeek Harness (DSH) 网页界面开发的**工作区密码锁**插件：在侧栏右键工作区即可加锁，
被锁工作区的会话隐藏、聊天区变为锁屏，输入密码才能查看。

<a id="english"></a>

## Features

- **Right-click menu** — 加锁 (Lock) / 解锁 (Unlock) / 移除锁 (Remove lock) on any
  workspace row. Renders as a native context-menu row: it injects into
  dsh-better-workspace's own menu when that plugin is present (0.11 and 0.14
  supported), and otherwise opens its own themed menu at the cursor.
- **Sidebar hiding** — a locked workspace's session rows hide and the row gets a
  minimal monochrome padlock badge; matching entries are hidden from search too.
- **Lock screen** — while a locked workspace is the active one, the chat area is
  replaced by a lock screen (supports the admin master password).
- **Admin master password** — configured in Settings → Plugins → 工作区锁. Unlocks
  every workspace at once and can replace any workspace password. Stored only as
  a salted hash.
- **Page-scoped unlock** — unlocking lasts for the current browser page; a refresh
  locks everything again.
- **Theme following** — all surfaces follow the system light/dark preference via
  `prefers-color-scheme` (the same signal the DSH app itself uses).
- **bw-independent** — works with or without dsh-better-workspace; sidebar
  decoration speaks both the bw-tree dialect and the stock sidebar.

<a id="中文"></a>

## 功能说明（中文）

- **右键菜单**：在侧栏工作区行上右键 → 加锁 / 解锁 / 移除锁。装了
  dsh-better-workspace 时自动注入它的原生菜单（兼容 0.11 与 0.14 两种实现）；
  未安装时在鼠标位置弹出自带的主题化菜单。
- **侧栏隐藏**：被锁工作区的会话行隐藏，行尾显示黑白线性挂锁徽标；搜索结果同步隐藏。
- **锁屏**：被锁工作区处于打开状态时，聊天区被锁屏替代（支持管理员密码）。
- **管理员密码**：在 设置 → 插件 → 工作区锁 卡片中设置，可一次性解锁所有工作区，
  也可代替任意工作区密码。服务器仅保存加盐哈希。
- **刷新即重新上锁**：解锁只在当前页面有效，刷新浏览器后全部恢复锁定。
- **主题跟随**：锁屏/弹窗/菜单跟随系统深浅色（与 DSH 主界面同一信号）。

## What it is NOT / 边界

This is a **UI-level lock**. It hides things in the interface; it does not encrypt
data and does not gate the server APIs — content remains technically reachable via
direct API calls. It protects against casual shoulder-surfing on a shared screen,
nothing more. / 这是**界面级**锁：只隐藏界面显示，不加密数据、不拦截服务端 API，
用于防止同事随手翻看，不是安全边界。

## Install / 安装

Requires DSH >= 0.1.5-rc.1 (tested on 0.1.5-rc.2). No build step, no dependencies
beyond what every DSH install ships.

```bash
# from a checkout of this repo, inside the DSH host container:
dsh plugin --profile web add link:/path/to/this/repo
docker restart dsh-harness   # or however you restart your DSH web process
```

To remove:

```bash
dsh plugin --profile web remove dsh-workspace-lock
docker restart dsh-harness
```

Locks and the admin password live in `<home>/.dsh/workspace-locks.json` (the
dsh-data volume) and survive removals and restarts.

## How it works / 工作原理

- **Host half** (`lib/index.js`, a cordis component): same-origin-fenced routes
  under `/api/workspace-locks/*` (list / set / unlock / remove / unlock-all /
  admin-set / admin-clear), salted-SHA-256 storage with atomic writes, and an
  800 ms wrong-password delay. The admin password is registered as a Settings →
  Plugins namespace so the card appears in the settings UI.
- **Browser half** (`lib/client.js`): a hand-written `window.__ModuleLoader__`
  module (no build step) that requires only `react` and `react-dom/client`.
  It renders the lock screen and password dialogs, decorates the sidebar
  (dsh-better-workspace tree dialect plus stock-sidebar fallback), injects the
  right-click menu items, and adopts the host PluginCard chrome for its
  Settings card so it always looks native.

## Compatibility / 兼容性

- DSH core: built for 0.1.5-rc.2, targets >= 0.1.5-rc.1.
- dsh-better-workspace: 0.11.x (`.bw-ctx-*` menu injection) and 0.14.x
  (`div[role="menu"]` portal injection) both supported; absent = own menu.
- Client bundle requires only `react` + `react-dom/client` (always in the
  host module table), plus `@deepseek-ai/dsh-client-ui-slots` for the
  Settings card slot.

## Development / 开发

No build step. Edit `lib/client.js` / `lib/index.js` directly.

```bash
node smoke/smoke_host.mjs    # host half: routes, fencing, hashing, storage
node smoke/smoke_client.js   # client half: factory loads against a mock module table
```

## License

[MIT](LICENSE)
