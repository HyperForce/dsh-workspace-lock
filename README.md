# dsh-workspace-lock

[English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

A single-purpose workspace password lock for the DeepSeek Harness (DSH) web UI.
Right-click a workspace in the sidebar to lock it: its sessions hide and the
chat area becomes a lock screen until unlocked. Nothing else.

### Features

- **Lock / unlock / remove lock** — right-click a workspace row: the plugin's
  own menu opens immediately, and when the sidebar's native context menu shows
  up (dsh-better-workspace 0.11 / 0.14 / 0.23 / 0.27, or the stock 0.1.7+
  sidebar's row "…" menu) the same entries are injected into it with native
  styling.
- **Locked state** — a monochrome padlock badge on the workspace row, its
  session rows hidden in the sidebar (search results included), and a lock
  screen over the chat area while one of its sessions is open.
- **Optional admin master password** (Settings → Plugins → dsh-workspace-lock)
  — unlocks every workspace at once and can replace any workspace password for
  unlock/remove; stored server-side as a salted hash only.
- **Page-scoped unlock** — a browser refresh locks the page again.

> UI-level only: this hides things in the interface. It does not encrypt data
> or gate server-side APIs — it guards against casual peeking, not deliberate
> attacks.

### Install

Requires DSH >= 0.1.5-rc.1 (tested on 0.1.5-rc.2, 0.1.7-rc.1 and
0.2.0-rc.1/rc.2):

```bash
dsh plugin --profile web add link:/path/to/this/repo
docker restart dsh-harness
```

Remove:

```bash
dsh plugin --profile web remove dsh-workspace-lock
docker restart dsh-harness
```

Locks persist in `<home>/.dsh/workspace-locks.json` (inside the dsh-data
volume) and survive restarts and reinstalls.

### Compatibility

- Developed and tested on DSH 0.1.5-rc.2, 0.1.7-rc.1 and 0.2.0-rc.1/rc.2;
  targets >= 0.1.5-rc.1. The client requires only the host seed modules
  (`react`, `react-dom/client`), never imports the closed-source
  `@deepseek-ai/dsh-client-runtime`, and has no build step. It declares no dsh
  peerDependencies, so the plugin version gate introduced in 0.2.0 does not
  apply.
- Context-menu injection supports dsh-better-workspace 0.11 / 0.14 / 0.23 /
  0.27 and the stock sidebar's row "…" menu; with neither present, the
  plugin's own menu is used.

### License

MIT

---

<a id="中文"></a>

## 中文

一个只做加锁的 DSH 工作区密码锁插件：侧栏右键工作区即可加锁，会话隐藏、
聊天区变为锁屏。不掺别的功能。

### 功能说明

- **加锁 / 解锁 / 移除锁** — 右键工作区行，自带菜单立即弹出；若侧栏自己的菜单
  随后出现（dsh-better-workspace 0.11 / 0.14 / 0.23 / 0.27 的右键菜单，或
  DSH 0.1.7+ 原生侧栏行尾"…"按钮的菜单），同名条目会克隆原生样式注入其中，
  自带菜单自动让位。
- **锁定效果** — 工作区行出现单色挂锁徽标；该工作区的会话在侧栏隐藏（搜索
  结果同步隐藏）；该工作区的会话打开时聊天区被锁屏覆盖，输入密码解锁。
- **管理员密码（可选）** — 在插件自己的设置页（设置 → 插件 →
  dsh-workspace-lock 的查看页）设置，可一键解锁全部工作区，也可代替任意
  工作区密码解锁/移除锁；仅以加盐哈希保存在服务器。
- **页面级解锁** — 解锁只对当前页面生效，刷新浏览器后重新上锁。

> 界面级：只隐藏界面显示，不加密数据、不拦截服务端 API，用于防止随手翻看，
> 不是安全边界。

### 安装

要求 DSH >= 0.1.5-rc.1（在 0.1.5-rc.2、0.1.7-rc.1 与 0.2.0-rc.1/rc.2 上开发
测试）：

```bash
dsh plugin --profile web add link:/path/to/this/repo
docker restart dsh-harness
```

移除：

```bash
dsh plugin --profile web remove dsh-workspace-lock
docker restart dsh-harness
```

锁数据保存在 `<home>/.dsh/workspace-locks.json`（dsh-data 卷内），卸载或重启
不丢失。

### 兼容性

- 在 DSH 0.1.5-rc.2、0.1.7-rc.1 与 0.2.0-rc.1/rc.2 上开发测试，目标
  \>= 0.1.5-rc.1。客户端只 require 原生种子模块（`react`、
  `react-dom/client`），不依赖闭源的 `@deepseek-ai/dsh-client-runtime`，无
  构建步骤；不声明 dsh 包 peerDependencies，因此不受 0.2.0 起的插件版本门禁
  影响。
- dsh-better-workspace 0.11 / 0.14 / 0.23 / 0.27 的菜单注入均支持；无
  better-workspace 的原生侧栏行尾"…"菜单同样支持；两者皆无时使用自带菜单。

### 许可证

MIT
