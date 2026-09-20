# dsh-workspace-lock

[English](#english) | [中文](#中文)

A single-purpose workspace password lock for the DeepSeek Harness (DSH) web UI.
Right-click a workspace in the sidebar → lock it: its sessions hide and the chat
area becomes a lock screen until unlocked. Nothing else.

一个只做加锁的 DSH 工作区密码锁插件：侧栏右键工作区即可加锁，会话隐藏、聊天区
变为锁屏。不掺别的功能。

<a id="english"></a>

## Why / 特点

- **Single purpose / 只做加锁** — one right-click action plus one optional
  settings card (admin master password). No panels, no styling options.
- **Simple / 简洁** — hand-written, no build step, no dependencies beyond what
  every DSH install ships.
- **Native-first / 最大程度兼容原生** — renders through the host's own UI
  primitives, injects into the native context menu, adopts the native settings
  card chrome, and follows the system light/dark preference
  (`prefers-color-scheme`).

## Features / 功能

- Right-click 加锁 / 解锁 / 移除锁：injects dsh-better-workspace's native menu
  when present (0.11 and 0.14), opens its own themed menu otherwise.
- Locked = monochrome padlock badge + session rows hidden (search results too)
  + lock screen on the chat area while the workspace is active.
- Optional admin master password: unlocks everything at once (Settings →
  Plugins → 工作区锁).
- Unlock is page-scoped; a refresh locks again.

> UI-level only / 界面级：只隐藏界面显示，不加密数据、不拦截服务端 API，
> 用于防止随手翻看，不是安全边界。

<a id="中文"></a>

## 安装

要求 DSH >= 0.1.5-rc.1（在 0.1.5-rc.2 上开发测试）。

```bash
dsh plugin --profile web add link:/path/to/this/repo
docker restart dsh-harness
```

移除：

```bash
dsh plugin --profile web remove dsh-workspace-lock
docker restart dsh-harness
```

锁数据保存在 `<home>/.dsh/workspace-locks.json`（dsh-data 卷），卸载或重启不丢失。

## Compatibility / 兼容性

- DSH 0.1.5-rc.2 上开发测试，目标 >= 0.1.5-rc.1。客户端只 require 原生种子模块
  （`react`、`react-dom/client`、`dsh-client-ui-slots`），不依赖闭源的
  `@deepseek-ai/dsh-client-runtime`，无构建步骤。
- dsh-better-workspace 0.11 / 0.14 的菜单注入均支持；未安装时用自带菜单。

## License

MIT
