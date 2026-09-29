# dsh-workspace-lock

[English](#english) | [中文](#中文)

Single-purpose workspace password lock for the DeepSeek Harness (DSH) web UI:
right-click a workspace to lock it — its sessions hide and the chat area
becomes a lock screen until unlocked. Nothing else.

一个只做加锁的 DSH 工作区密码锁插件：侧栏里右键工作区即可加锁，会话隐藏、
聊天区变为锁屏。不掺别的功能。

<a id="english"></a>

## Why / 特点

- **Single purpose / 只做加锁** — one context-menu action plus one optional
  admin master password page. No panels, no styling options.
- **Simple / 简洁** — hand-written, no build step, no dependencies beyond the
  host seed (`react`, `react-dom/client`).
- **Native-first / 最大程度兼容原生** — injects into the sidebar's own context
  menu (dsh-better-workspace's tree menu and the stock sidebar's row "…" menu
  alike) by cloning its native rows, and follows the system light/dark
  preference (`prefers-color-scheme`).

<a id="中文"></a>

## 功能说明（中文）

- **加锁 / 解锁 / 移除锁**：右键工作区行，自带菜单立即弹出；若侧栏自己的
  菜单随后出现（dsh-better-workspace 0.11 / 0.14 / 0.23 的右键菜单，或
  DSH 0.1.7 原生侧栏行尾"…"按钮的菜单），同名条目会克隆原生样式注入其中，
  自带菜单自动让位。
- **锁定效果**：工作区行出现单色挂锁徽标；该工作区的会话在侧栏隐藏（搜索
  结果同步隐藏）；该工作区的会话打开时聊天区被锁屏覆盖，输入密码解锁。
- **管理员密码（可选）**：在插件自己的设置页（设置 → 插件 →
  dsh-workspace-lock 的查看页；rc.2 时代为插件配置卡片）设置，可一键解锁
  全部工作区，也可代替任意工作区密码解锁/移除锁；仅以加盐哈希保存在服务器。
- **页面级解锁**：解锁只对当前页面生效，刷新浏览器后重新上锁。

> 界面级：只隐藏界面显示，不加密数据、不拦截服务端 API，用于防止随手翻看，
> 不是安全边界。

## Install / 安装

Requires DSH >= 0.1.5-rc.1 (tested on 0.1.5-rc.2, 0.1.7-rc.1 and 0.2.0-rc.1) /
要求 DSH >= 0.1.5-rc.1（在 0.1.5-rc.2、0.1.7-rc.1 与 0.2.0-rc.1 上开发测试）：

```bash
dsh plugin --profile web add link:/path/to/this/repo
docker restart dsh-harness
```

Remove / 移除：

```bash
dsh plugin --profile web remove dsh-workspace-lock
docker restart dsh-harness
```

Locks persist in `<home>/.dsh/workspace-locks.json` (inside the dsh-data
volume) / 锁数据保存在 `<home>/.dsh/workspace-locks.json`（dsh-data 卷），
卸载或重启不丢失。

## Compatibility / 兼容性

- 在 DSH 0.1.5-rc.2、0.1.7-rc.1 与 0.2.0-rc.1 上开发测试，目标 >= 0.1.5-rc.1。
  客户端只 require 原生种子模块（`react`、`react-dom/client`），不依赖闭源的
  `@deepseek-ai/dsh-client-runtime`，无构建步骤；不声明 dsh 包 peerDependencies，
  因此不受 0.2.0 起的插件版本门禁影响。
- 0.1.7 移除了 `settings.register`，本插件改用 `plugins.bundle.config` 槽位
  提供设置页，同时保留 rc.2 时代的卡片注册，两个版本都能管理管理员密码。
- dsh-better-workspace 0.11 / 0.14 / 0.23 的菜单注入均支持；无 better-workspace
  的原生侧栏同样支持；两者皆无时使用自带菜单。

## License

MIT
