# dsh-native-launcher

> 以"零额外安装"为设计原则：仅凭一个官方插件与 Windows 原生机制，让 DeepSeek Harness Web UI 获得桌面 App 式的一键启动体验。

## 设计理念

**不额外安装任何东西。以官方 DeepSeek Harness 为中心，通过官方支持的插件机制，尝试拼出类似桌面端的体验。**

- 🧊 **零额外安装**：不引入 Electron / Python / WebView2 等任何重型桌面端或运行时——只有官方 dsh 插件 + Windows 自带机制（wscript / powershell / cmd / NotifyIcon / AppsFolder）。装进 profile 即用，卸载即干净。
- 🎯 **以官方为中心**：不魔改、不替换官方 Web UI，一切围绕官方版本做加法；插件本身也只是标准 dsh bundle patch，官方升级后依然兼容。
- 🪶 **轻量体验优先**：适合想获得"桌面 App"般手感、又不想额外下载软件的人——装一个插件，换来快捷方式、托盘、独立应用窗口。
- 🔌 **原生能力借用**：浏览器本身就是最好的"桌面壳"——PWA 安装、`--app` 独立窗口、系统应用注册，这些官方浏览器能力直接借用，不为小众需求自造轮子；同时也为"想深度适配浏览器生态"的用户保留了路径（安装为应用后任务栏/开始菜单/可固定全部由系统管理）。

**一句话**：用最小的插件代价，换取最接近原生的桌面体验；不装软件，只用官方的东西。

## 版本状态

### ✅ v0.1（当前）—— 桌面化基础体验

- 桌面快捷方式（官方图标）+ 静默启动（无黑窗）
- TCP 端口探测：已运行则直连，未运行才启动（不重复启动）
- **已安装 PWA 应用优先打开**：装过应用的直接打开应用窗口，未安装自动回退浏览器
- 系统托盘（打开 / 停止 / 退出）
- 安装引导模态框（白底，一键唤出浏览器原生安装流程）
- 设置页增强 section（查看配置 / 重建快捷方式）+ **独立"通知"设置 section**
- **任务完成通知**（完整集成 [dsh-notification](https://github.com/omdsh-dev/dsh-notification)，MIT）：会话投影驱动，区分 **正常完成 / 出错 / 被中止 / 被阻塞 / 达 Token 上限**，逐类型开关 + 关键词规则（包含/排除 + 正则）+ 高级选项（手动关闭 / 仅在任务不在眼前时通知）；投影 turn 推进检测天然避免历史重放轰炸
- 官方 DSH 图标全入口统一

**安装为应用后自动获得**（浏览器原生能力，无需本插件代码）：任务栏独立图标、无地址栏独立窗口、开始菜单条目、可固定任务栏、应用级关闭——与桌面 App 一致的窗口体验。

### 🚧 下一步（规划中）

- **v0.2 关闭语义**：关闭 WebUI 窗口 = 优雅退出后台服务（客户端断开检测 + 任务检查 + `ctx.fiber.dispose()` 持久化 flush），有任务在跑时不退出
- **侧边栏数据面板**：在 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 中提供"启动器状态"面板（服务状态 / 托盘状态 / PWA 安装状态 / 快捷方式状态 + 快捷操作）
- **功能可自定义化**：设置页升级为完整配置 UI（托盘开关 / 自动打开 / 打开方式 / 端口等全部可调、可持久化）
- **应用内退出按钮**：页面内一键退出（检查任务 → 确认 → 优雅关闭）
- **多浏览器适配**：Chrome / Firefox 的 PWA 安装引导差异化处理

完整设计验证见文末 [设计验证：桌面端体验（Roadmap）](#设计验证桌面端体验roadmap)。

## 配套推荐

| 插件 | 作用 | 安装 |
| --- | --- | --- |
| [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 侧边栏工作台（本插件状态面板将挂载其上） | `npm i -g dsh-better-sidebar` + `dsh plugin --profile web add dsh-better-sidebar` |

> 任务通知已**内置**（原 [dsh-notification](https://github.com/omdsh-dev/dsh-notification) 的功能已合并升级进本插件，无需再装）。

## 特性

- 🖱️ **桌面快捷方式**：安装即生成（默认名 `DSH WebUI`，官方 DSH 图标），双击即用；幂等——已存在则跳过，指向错误/图标变更自动重建，设置页可强制重建
- 🤫 **静默启动**：wscript 隐藏窗口，无 cmd 黑窗、无闪屏
- 🔌 **TCP 端口探测**：实例已在运行 → 直接打开连上；未运行 → 才启动（不会 EADDRINUSE 失败；对 0.0.0.0 / 127.0.0.1 / [::] 监听形态免疫）
- 🖥️ **已安装应用优先打开**：若 Edge/Chrome 已把站点安装为 PWA 应用，快捷方式直接打开**已安装的应用窗口**（独立任务栏、无地址栏、官方图标）；未安装时按 `openMode` 回退（`--app` 独立窗口 / `--new-window` / 默认）
- 🛟 **冷启动自愈**：浏览器完全未运行时（首进程可能吞掉 `--app-id`/`--app` 参数），每次启动都会验证浏览器进程是否真的起来——没起来自动换下一条路径，最终回退默认方式打开，不再"点了没反应"
- 🪟 **系统托盘**：NotifyIcon 托盘菜单（打开 WebUI / 退出 WebUI），单实例互斥，**无论从快捷方式还是终端直接启动 dsh 都会出现**；"退出 WebUI"＝停止 DSH 服务 + 关闭浏览器应用窗口 + 关闭托盘，一次彻底退出
- ⚙️ **安装引导**：站点可安装时自动弹出白底安装模态框（含安装按钮与浏览器限制兜底提示），可一键唤出 Edge/Chrome 原生安装流程
- 🎨 **官方图标**：应用 / 快捷方式 / 托盘 / favicon 全部使用 DeepSeek Harness 官方图标（favicon.svg 原版渲染）
- ⚙️ **增强设置页**：设置侧边栏新增 "WebUI 启动器" section，可查看配置、一键重新生成快捷方式
- 🧊 **零依赖**：仅 node builtins + Windows 自带工具

## 安装

> 前置要求：`dsh plugin` 命令依赖 **pnpm**。若提示 `pnpm is not recognized`，先安装：
> ```bash
> npm install -g pnpm
> ```
> （或启用 Node 自带的 corepack：`corepack enable pnpm`）

```bash
git clone https://github.com/ingleav626-art/dsh-native-launcher
dsh plugin --profile web add <path-to-repo>
# 重启 dsh web 后生效
```

安装后重启：桌面出现快捷方式，右下角托盘出现图标。双击快捷方式即用。

**安装为应用（推荐，一次性）**：普通标签页打开 `http://127.0.0.1:3080` → 右下角出现安装模态框 → 点「安装」→ 确认。装完后：
- 快捷方式自动打开**已安装的应用**（独立窗口、任务栏独立图标、可固定）
- 若点安装无反应（浏览器安装抑制期），用 Edge 菜单 `⋯ → 更多工具 → 应用 → 将此站点安装为应用`

## 配置

`cordis.patch.yml`（或 profile 的 patch 层覆盖）：

```yaml
- id: native-launcher
  config:
    # 快捷方式双击后执行的启动命令（cmd 中运行，依赖 PATH 里的 dsh）
    launchCommand: dsh --profile web
    # 是否自动打开浏览器（仅快捷方式启动且带 DSH_LAUNCHER=1 时）
    autoOpen: true
    # 快捷方式名称（不含扩展名）
    shortcutName: DSH WebUI
    # 快捷方式已存在时是否强制覆盖
    force: false
    # 端口探测端口（需与 webserver 端口一致）
    port: 3080
    # 是否启用系统托盘
    tray: true
    # 打开方式：app（--app 独立窗口，默认）| new-window（独立窗口）| default（浏览器默认行为）
    openMode: app
```

## 工作原理

```
桌面快捷方式(DSH WebUI.lnk)
    │ wscript.exe launcher.vbs（隐藏窗口，无黑窗）
    ▼
launch.cmd TCP 端口探测 (127.0.0.1:<port>)
    ├─ 已监听 → 拉起托盘 → open-webui.ps1（打开已装应用/浏览器，不重复启动）
    └─ 未监听 → 拉起托盘 → set DSH_LAUNCHER=1 && dsh --profile web（静默启动）
                                │
                                ▼
                         插件 apply（任意启动方式都会执行）
                                ├─ 拉起系统托盘（Mutex 单实例，已存在则自动退出）
                                ├─ 注册 PWA 路由（manifest + 官方图标）
                                ├─ 注册设置页 "WebUI 启动器" section
                                └─ 检测 DSH_LAUNCHER=1 → loader.await() 就绪
                                   → webServer.port 就绪 → 打开 WebUI
```

**open-webui.ps1 打开链路（多路探测，命中一个即启动）**：

| 优先级 | 方式 | 说明 |
| --- | --- | --- |
| 0 | `--app-id=<app_id>` | host 启动时扫描 Edge 已安装应用（Manifest Resources + Preferences 按站点 URL 匹配），部署自适应 |
| 0b | AppsFolder（`explorer shell:AppsFolder\<AUMID>`） | Windows 已注册应用列表，按站点 host 前缀 + 名称匹配 |
| 1-2 | PWA 快捷方式扫描 | 开始菜单 / 任务栏 / 桌面（浏览器 exe + `--app-id` 特征），避免自我递归 |
| 3 | Chromium Web Applications 目录 | 旧结构 internal manifest 匹配 |
| 4 | `--app` / `--new-window` / 默认 | 未安装应用时的浏览器回退 |

生成物（用户目录 `~/.dsh-webui-launcher/`）：

| 文件 | 作用 |
| --- | --- |
| `launcher.vbs` | wscript 入口：隐藏窗口调起 cmd |
| `launch.cmd` | TCP 端口探测 + 启动/直连 + 拉起托盘 |
| `open-webui.ps1` | 多路探测打开已安装应用 / 浏览器 |
| `tray.ps1` | NotifyIcon 托盘（单实例 Mutex + 停止二次确认） |
| `dsh-webui.ico` | 快捷方式 / 托盘图标（官方 DSH 图标） |
| `pwa-scan.log` | PWA 应用扫描诊断日志（每次启动重写，排查用） |

## 与同类方案对比

| 方案 | 形态 | 亮点 | 短板 |
| --- | --- | --- | --- |
| **dsh-native-launcher（本插件）** | 标准 dsh 插件 + Windows 自带机制 | 轻量（零重型依赖）、托盘、已装应用优先打开、安装引导、设置页、端口直连、静默启动、官方图标 | 仅 Windows |
| [jenokagong/dsh-webui-launcher](https://github.com/jenokagong-dotcom/dsh-webui-launcher) | 纯 bat | 控制台可最小化恢复、快速启动（~2s） | 关窗=停服务、无托盘、无端口直连 |
| [LvienOeria 插件](https://github.com/LvienOeria/ds-harness-webui-launcher) | dsh 插件 | 幂等 state hash、配置 .bak 备份、坏配置大声报错 | **不支持 Windows**，无托盘/快捷方式 |
| [zhanweipan 启动器](https://github.com/zhanweipan/ds-harness-launcher) | Electron | 一键部署、版本管理、多实例、日志面板 | 重型桌面端，与轻量定位相悖 |
| [Hllojjh 托盘](https://github.com/Hllojjh/ds-harness-tray) | Python 托盘 | 单实例互斥、只停自己进程树、外部占用识别、二次确认 | 依赖 Python 运行时 |
| [Ruler4396 启动器](https://github.com/Ruler4396/ds-harness-webui) | WebView2 | 服务驻留三模式、关窗即停 | 依赖 WebView2 运行时 |

**差异化**：同为 dsh 插件的方案里，LvienOeria 不支持 Windows、jenokagong 无托盘，而重型桌面端（Electron/WebView2/Python）都要求**额外安装运行时**——与"不额外安装任何东西"的理念相悖。本插件是"纯 Windows 原生 + 纯插件"的最小代价路线：**桌面"应用窗口"走浏览器原生 PWA 机制**——用户安装 PWA 后快捷方式直接打开已安装应用（任务栏独立、官方图标、可固定），而非自造浏览器壳——同样是"任务栏独立应用"，成本比 Electron/WebView2 低一个数量级，且零运行时依赖。

## 卸载

```bash
dsh plugin --profile web remove dsh-native-launcher   # 1. 移除插件（profile 依赖 + bundle）
```

然后手动清理生成物（插件只负责生成，不负责回收）：

```powershell
Remove-Item "$env:USERPROFILE\.dsh-webui-launcher" -Recurse -Force   # 2. 启动脚本/托盘/图标/日志
Remove-Item "$env:USERPROFILE\Desktop\DSH WebUI.lnk"                 # 3. 桌面快捷方式
```

- **托盘进程**：右键托盘 → 退出托盘（若还在运行）
- **已安装的 PWA**（若装过）：Edge 打开 `edge://apps` → DSH WebUI → 卸载
- 最后重启 dsh

## 设计验证：桌面端体验（Roadmap）

目标：让 Web UI 拥有桌面 App 的关闭语义——"关掉窗口 = 关掉应用"，同时**任务感知**。

| 能力 | 可行性 | 方案 |
| --- | --- | --- |
| 关闭 WebUI 同步退出后台实例 | ✅ 可行 | Client 心跳 RPC（页面存活上报）→ Host 超时判定 → `ctx.fiber.dispose()` 优雅退出（含持久化 flush） |
| 关闭前任务检查 | ✅ 可行 | `ctx.agents.list()` 查 `agent.status`（idle/running）+ `agent/status` 事件 |
| 页面弹窗提醒/阻止关闭 | ⚠️ 部分可行 | 浏览器 `beforeunload` 已被浏览器弱化；替代方案：**应用内"退出"按钮**（页面 UI → 检查任务 → 弹确认 → RPC 优雅关闭），把关闭动作从浏览器 X 挪到应用内，可控性大增 |
| 阻止关闭后台实例 | ✅ 可行 | 服务端决策：客户端断开时检查任务——有任务则不退出，任务结束且仍无客户端再自动退出 |

**设计要点**：浏览器关闭不可靠拦截 → **服务端拥有进程生杀权**（断开检测 + 任务状态 + 优雅退出），页面只做"尽力提醒 + 应用内退出入口"。

## 开发

```bash
node tools/make-ico.mjs <input.png> <output.ico>   # PNG → ICO（≤256px，内嵌 PNG）
```

本地调试：目录 `link:` 方式安装，改 `lib/index.js` 后重启 dsh 即生效。

## 致谢

- **任务通知功能完整集成自**：[dsh-notification](https://github.com/omdsh-dev/dsh-notification)（MIT License, Copyright (c) 2026 DeepSeek）——host 投影（`lib/notification-host.js`）与 client 完成检测/设置（`lib/notification-client.js`）为其**原样构建产物**，通过本插件包内模块挂载（含 `Settings > 通知` 设置页）
- 图标使用官方 DeepSeek Harness 品牌图标（源自 dsh web 的 `favicon.svg`），仅用于非商业开源插件场景

## 许可证

MIT
