# dsh-workspace-lock

[English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

A single-purpose workspace password lock for the DeepSeek Harness (DSH) web UI.
Right-click a workspace in the sidebar to lock it: its sessions hide and the
chat area becomes a lock screen until unlocked. Nothing else.

### Features

- Right-click a workspace → **加锁 / 解锁 / 移除锁**; the entries are injected
  into the sidebar's native menu when present (dsh-better-workspace, or the
  stock sidebar's row menu), otherwise the plugin's own menu is used.
- A locked workspace shows a padlock badge, its sessions hide, and the chat
  area shows a lock screen; a page refresh locks again.
- Optional admin master password: unlocks every workspace at once
  (Settings → Plugins → dsh-workspace-lock).

> UI-level only: hides interface content; no encryption, no server-side gating.

Full history: [CHANGELOG.md](CHANGELOG.md).

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

- No dsh peerDependencies declared — the 0.2.0 plugin version gate does not
  apply. The client requires only the host seed modules (`react`,
  `react-dom/client`); no build step.
- Menu injection works with dsh-better-workspace 0.11 – 0.27 and the stock
  sidebar.

### License

MIT

---

<a id="中文"></a>

## 中文

一个只做加锁的 DSH 工作区密码锁插件：侧栏右键工作区即可加锁，会话隐藏、
聊天区变为锁屏。不掺别的功能。

### 功能说明

- 右键工作区 → **加锁 / 解锁 / 移除锁**；侧栏原生菜单可用时注入其中
  （dsh-better-workspace、原生侧栏行菜单），否则使用自带菜单。
- 加锁后：行上挂锁徽标、会话隐藏、聊天区锁屏；刷新页面重新上锁。
- 可选管理员密码：一键解锁全部工作区（设置 → 插件 → dsh-workspace-lock）。

> 界面级：只隐藏界面显示，不加密数据、不拦截服务端 API。

完整历史见 [CHANGELOG.md](CHANGELOG.md)。

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

- 不声明 dsh 包 peerDependencies —— 0.2.0 起的插件版本门禁不适用。客户端只
  require 原生种子模块（`react`、`react-dom/client`），无构建步骤。
- 菜单注入支持 dsh-better-workspace 0.11 – 0.27 与原生侧栏。

### 许可证

MIT
