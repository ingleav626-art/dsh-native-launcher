# dsh-native-launcher

> 以"零额外安装"为设计原则：本插件基于 DSH 官方插件生态及其官方基础依赖构建，不重复引入其他开源框架或重型运行时，仅凭一个官方插件与 Windows 原生机制，让 DeepSeek Harness Web UI 获得桌面 App 式的一键启动体验。

## 设计理念

**dsh 的桌面化启动器 + 插件整合包。启动器把 WebUI 变成桌面应用，框架负责把生态里优秀的插件组合到一起——功能归上游，我们只做适配、管理与兼容。**

-  **桌面化已完成**：快捷方式、托盘、独立窗口、任务通知、关窗即退——启动器该有的都有了。它小而稳定，没有报告的问题就不再折腾；后续以 bug 修复与兼容性维护为主。
-  **"零额外安装"**：不引入 Electron / Python / WebView2 等任何重型桌面端或运行时；插件依赖 DSH 官方插件生态及其官方基础依赖，复用官方能力而不重复实现。除官方生态依赖外，不捆绑社区功能框架。装进 profile 即用，卸载即干净。
-  **以官方为中心**：不魔改、不替换官方 Web UI，一切围绕官方版本做加法；插件本身也只是标准 dsh bundle patch，官方升级后依然兼容。
-  **做框架，不做冗余功能**：整合包里的每个可选能力都来自社区现成的优秀插件，我们只做三件事——**适配**（让它在整合包里正常工作）、**管理**（统一开关与更新）、**兼容**（化解 UI 与注册冲突）。上游插件的迭代归上游，通过自动更新机制跟进，绝不分叉维护。
-  **集合包，不是捆绑套餐**：dsh 生态里同一功能往往有多个实现（通知、侧边栏……风格与质量各异）。本包内的可选功能全部**模块化、可独立开关**——你已选用了别人的通知插件？关掉本包的通知模块即可，两者绝不冲突；喜欢哪个用哪个，集合包只提供"装一个顶一堆"的便利，不替你做选择。
-  **个人喜好驱动**：规划中的功能首先是我想用，当然欢迎大家推荐一些好用的插件，我会考虑一并集成。

**一句话**：启动器让 dsh 像桌面软件一样工作；整合包让生态里的好东西各就各位——而挑哪些、开哪些，永远是你的自由。

## 安装

> **平台**：仅支持 **Windows**（Windows 10/11，x64）。macOS / Linux 请勿安装本插件。
>
> **版本要求**：需要 **dsh >= 0.1.5-rc.2**（当前官方最新版，也是本插件的适配与验证基准：`--no-open` 自 rc.8 起、任务通知所依赖的投影与服务契约自 0.1.5 起）。本插件此后以该版本为基线持续适配，**不再针对更低版本做适配与验证**——使用更低版本 dsh 请安装对应的历史插件版本（见下方「版本状态」）。dsh 版本过低时，插件启动会在日志中给出升级提示。
>
> 前置要求：`dsh plugin` 命令依赖 **pnpm**。若提示 `pnpm is not recognized`，先安装：
> ```bash
> npm install -g pnpm
> ```
> （或启用 Node 自带的 corepack：`corepack enable pnpm`）
>
> 设置页 schema 使用 DSH 官方维护的 `@deepseek-ai/schemastery`，随插件安装声明；它属于 DSH 官方基础依赖，不是额外的社区功能框架。

> **推荐方式（普通用户）**：从 npm 安装，再用 DSH 官方的插件添加命令接入——拿到的是已发布的正式版本，不需要 clone 源码。
>
> **源码方式（开发者）**：需要修改代码、或跟进尚未发布的改动时使用。下载源码即视为以开发者身份使用本插件。

```bash
# 推荐：npm 安装 + 官方插件添加
npm install -g dsh-native-launcher
dsh plugin --profile web add dsh-native-launcher

# 开发：源码安装（指向本仓库目录）
git clone https://github.com/ingleav626-art/dsh-native-launcher
dsh plugin --profile web add <path-to-repo>
# 重启 dsh web 后生效
```

安装后重启：桌面出现快捷方式，右下角托盘出现图标。双击快捷方式即用。

**安装为应用（推荐，一次性）**：普通标签页打开 `http://127.0.0.1:3080` → 视觉中心出现安装提示框 → 点「安装」→ 弹出浏览器安装提示 → 确认。装完后：
- 快捷方式自动打开**已安装的应用**（独立窗口、任务栏独立图标、可固定）
- 若点安装无反应（浏览器安装抑制期），用 Edge 菜单 `⋯ → 更多工具 → 应用 → 将此站点安装为应用`

## 特性

- **桌面快捷方式**：安装后自动生成桌面快捷方式，双击即可启动或返回 WebUI；支持自定义名称与强制重建。
- **独立应用窗口**：可将 WebUI 安装为桌面应用——拥有独立任务栏图标、无浏览器地址栏；未安装应用时按设置的打开方式回退（独立窗口 / 默认浏览器）。
- **窗口自动聚焦**：WebUI 已在运行时，再次点击快捷方式或托盘仅将现有窗口切换至前台，不会重复开启实例。
- **系统托盘**：常驻托盘图标，提供"打开 WebUI"与"退出"入口，并可发送 Windows 原生通知；可在设置中选择 dsh 停止后托盘是否保留。
- **任务通知**：任务完成、出错、中止、被阻塞、达到上限，以及等待审批 / 回答 / 计划审阅时，通过 Windows 原生通知提醒并进入通知中心；关闭全部页面后由后台补发，确保消息不遗漏。设置页有「**发送测试通知**」按钮，一键验证「模块 → 投递端 → 托盘 → 系统」整条链路（排错第一站）。
- **关闭语义**：关闭全部窗口且无运行中任务时自动停止服务；存在运行中任务则等待其完成后再停止。防抖时长与二次确认窗口均可调整。
- **完整设置界面**：启动命令、端口、快捷方式名称、打开方式、托盘开关、通知开关、关闭语义参数及各功能模块开关，均在设置页可视化配置并持久化保存。
- **模块化设计**：附加功能以独立模块形式提供，可在设置页单独启用或停用；已使用其他同类插件的用户可关闭对应模块，避免功能冲突。
- **一键卸载**：在设置页完成卸载——自动停止服务、移除桌面快捷方式、清理生成文件与注册表项、从 profile 移除插件条目；可选同时清除全部个人配置。卸载过程记录于独立日志文件。
- **日志与诊断**：启动、运行、卸载全过程均有结构化日志记录，**全部集中在 `%USERPROFILE%\.dsh-webui-launcher\logs\` 这一个文件夹里**（含 client 侧事件——经 `ntf-log` 汇入主日志，浏览器控制台不留任何东西）。出问题时**把整个 `logs` 文件夹发过来即可**，不用挑也不用筛选：主日志 `native-launcher.log` 内容最全，其余是各组件的时间线补充（启动分支、开页面、托盘、Toast、PWA 扫描、卸载）。设置页有「打开日志目录（排错用）」按钮，一键定位。

###  下一步实现（整合包路线）

> 启动器本体已趋稳定，重心转向「整合包」：把社区里现成的优秀插件组合进统一的框架与管理体系。以下多为集成与适配工作，功能本体由上游维护。

**框架层（我们做）：**

- **插件管理与自动更新**：已安装插件的统一管理界面 + 上游版本检测与一键更新（含 vendored 模块的上游跟进）
- **external/dev 模块发现**：支持从 npm 或本地路径加载第三方模块，为接入插件市场铺路
- **手机端体验**：移动端 UI 适配，把 dsh 当作远程遥控器使用
- **多浏览器适配**：Chrome / Firefox 的 PWA 安装引导差异化处理
- **设置项热生效扩展**：运行参数类选项保存后免重启生效

**集成层（适配社区现成插件）：**

- **背景美化**：自定义图片作为工作区背景
- **文件侧边栏**：集成现有的文件侧边栏能力
- **子代理通讯**：集成并增强子代理交互体验
- **非多模态模型读图**：借助现有插件为纯文本模型补上读图能力
- **桌宠**：选一款喜欢的桌宠接入整合包
- **插件市场**：直接对接社区已有的插件市场实现
- **绘画文件归档与清理**：生成图片的归档管理

## 常见问题

**Q：任务完成了但没收到通知？**
A：通知主通道是托盘原生通知（不依赖浏览器权限）。若托盘也没弹：先确认托盘图标在（重启 dsh 会自动拉起/换新托盘），再看 `~/.dsh-webui-launcher/logs/tray-notify.log` 是否有失败原因。另注意 Windows 会**静默屏蔽短时间内的连续通知**（同 tag 几秒内重复时尤其明显）——设置页"发送测试通知"请**间隔几秒**再点。

**Q：关掉窗口后服务退出了，但我不想让它退？**
A：在设置页关闭「关窗自动退出」——关窗后服务常驻（手动用托盘"退出 WebUI"才退出）。

**Q：卸载 / 改名后，桌面上还留着旧的快捷方式图标？**
A：文件其实已经删除了，是**桌面显示没有刷新**——按 `F5` 或右键桌面选"刷新"即可；图标显示异常同理（Windows 图标缓存）。刷新后如果仍有残留，再反馈并附上 `logs` 文件夹。

**Q：任务还在跑，我关了窗口，任务会丢吗？**
A：不会。有任务在跑时服务会**驻留**，任务跑完（且仍无窗口）才自动退出；任务完成还会弹托盘通知。

**Q：改了端口，启动打开的还是旧页面？**
A：改 `port` 后已安装的旧 PWA 仍指向旧端口，启动会自动回退 `--app` 模式（功能可用）；清理旧应用请到 `edge://apps` 手动卸载。

**Q：卸载重装了浏览器应用（PWA），通知没了？**
A：托盘通知不依赖浏览器，不受影响；重装应用后如页面异常，重启 dsh 即可。

**Q：托盘图标不见了？**
A：重启 dsh 会自动重新拉起（含旧托盘自动换新）；仍不行就任务管理器结束残留的 PowerShell 托盘进程（含 pwsh）再重启。

**Q：一个任务会收到两条通知？**
A：不会。通知只有系统托盘一个通道（v0.3.6 起浏览器通知已移除），不存在双弹。

**Q：双击快捷方式只有命令行窗口，WebUI 没打开？**
A：快捷方式通过 `dsh --profile web` 启动服务，**依赖 PATH 中的全局 dsh 命令**。若你平时用 `npx @deepseek-ai/dsh web` 运行（dsh 未全局安装），`dsh` 命令不存在会导致启动失败。v0.2.1 起会自动回退 npx 启动并在窗口显示提示；

## 卸载

> **范围说明**：一键卸载仅移除本插件提供的**桌面化增强组件**（快捷方式 / 托盘 / 自动打开等）；dsh 服务本身与其数据不受影响。

**推荐：设置页一键卸载**——打开 WebUI 设置 → "WebUI 启动器" → 一键卸载启动器：

- 停止系统托盘与 dsh 后端服务（确认后约 6 秒自动停止，无需手动 taskkill）
- 删除桌面快捷方式、清理全部生成文件与通知注册表项
- 从 profile 移除插件条目（自动备份 `package.json.before-uninstall`）
- 可勾选「同时清除全部个性化配置」——不清除则重装后会恢复你的偏好（与主流软件一致）
- 全程记录于 `%USERPROFILE%\.dsh-webui-launcher\logs\uninstall.log`（该日志不会被清理，失败可溯源）

<details><summary>手动清理（备用方案，点开）</summary>

```bash
dsh plugin --profile web remove dsh-native-launcher   # 1. 移除插件（profile 依赖 + bundle）
```

```powershell
Remove-Item "$env:USERPROFILE\.dsh-webui-launcher" -Recurse -Force   # 2. 启动脚本/托盘/图标/日志
Remove-Item "$env:USERPROFILE\Desktop\DSH WebUI.lnk"                 # 3. 桌面快捷方式（按实际名字）
reg delete "HKCU\Software\Classes\AppUserModelId\DshNativeLauncher" /f   # 4. 通知标识注册表项
```

- **已安装的 PWA**（若装过）：Edge 打开 `edge://apps` → DSH WebUI → 卸载

</details>

最后重启 dsh。

<details><summary>想连 <b>dsh 本体一起移除</b>？（与本插件无关，谨慎操作）</summary>

本插件不代管 dsh 本体的卸载（会话记录、全局设置等其他数据也在其中）。如确定不再使用：

```powershell
npm uninstall -g @deepseek-ai/dsh    # 移除 dsh 服务端
```

并按需备份后清理 `DSH_HOME` 目录（默认 `%USERPROFILE%\.dsh` 或自定义路径，含 sessions / settings 等个人数据）。
</details>

## 版本状态

> 当前版本 **v0.4.1**。各版本详情见 GitHub Releases；里程碑之外的迭代见提交记录。

- **v0.4.1 — 启动耗时的根因修复版本**。修复隐藏窗口启动被系统按后台任务限制性能、导致快捷方式启动被拖到 20~40 秒的问题（实测服务加载 32.4 秒 → 6.0 秒，且运行期同样受益）；修复「仅在任务不在眼前时通知」在页面持续处于前台时静默失效；启动前的服务存活检测由约 2 秒降至毫秒级；启动入口由批处理脚本（`.cmd`）迁移至 PowerShell 脚本（`.ps1`），行为逻辑不变
- **v0.4.0 — 架构重写版本**。功能增量很少，重心是完整重写：全部代码迁移到 TypeScript 严格模式工程（esbuild 构建，产物按职责拆分），插件功能改为模块容器接入（可单独禁用/替换，为分包独立迭代打底），启动脚本/托盘/快捷方式链路建立自动化守卫。功能面：新增**任务通知卡片点击唤起已有窗口**（不重复开页，需网页已安装为应用）与**开机自启动**（默认关，设置页开启，即时生效）；修复双击快捷方式无法唤起、自动打开静默失效；设置页精简重复开关
- **v0.3.6** — 通知 v2：0.1.5 上任务通知全面恢复（判断与发送移到插件后台，网页全关照样弹）；关窗等待任务完成真正生效；通知设置卡片（规则编辑 / 测试通知 / 即时生效）；日志统一 `logs\` 子目录 + 一键打开；模块重构，包体积显著缩减
- **v0.3.5** — dsh 0.1.5-rc.2 适配：设置页 RPC 兜底桥（规避官方 connection 回归）；冷启动自动开页面修复（带 token 探测，一次点击即开）
- **v0.3.3** — 设置页完整表单 + 一键卸载 + 模块化整合包框架 + 托盘可靠性白箱化
- **v0.2.3** — 托盘拉起重构（WScript 隐藏启动，彻底无黑窗）
- **v0.2.2** — rc.8 适配（`--no-open` 防双开）+ 关闭语义修复（任务在跑立即挂起等待）
- **v0.2.1** — 启动可靠性修复（launch.cmd 分支 / HTTP 探测 / npx 回退 / 托盘重试 / 环境自诊断）
- **v0.2** — 托盘原生 Toast 主通道 + 等待确认通知 + 关闭语义（桌面应用行为）+ 托盘自更新
- **v0.1** — 桌面化基础：快捷方式、静默启动、端口探测、托盘、PWA 优先、安装引导、任务通知集成

## 工作原理

```
桌面快捷方式(DSH WebUI.lnk)
    │ wscript.exe launcher.vbs（隐藏窗口，无黑窗）
    ▼
launch.cmd HTTP 就绪探测 (127.0.0.1:<port>)
    ├─ 已运行(HTTP 200) → 拉起托盘 → open-webui.ps1（打开已装应用/浏览器，不重复启动）
    └─ 未运行 → 拉起托盘 → set DSH_LAUNCHER=1 && dsh --profile web（静默启动；dsh 不在 PATH 时自动回退 npx --yes @deepseek-ai/dsh）
                                │
                                ▼
                         插件 apply（任意启动方式都会执行）
                                ├─ 拉起系统托盘（Mutex 单实例 + 版本自更新）
                                ├─ 注册 PWA 路由（manifest + 官方图标）
                                ├─ 注册设置页 "WebUI 启动器" section
                                ├─ 注册通知/关闭语义（见下）
                                └─ 检测 DSH_LAUNCHER=1 → loader.await() 就绪
                                   → webServer.port 就绪 → 打开 WebUI
```

**open-webui.ps1 打开链路（多路探测，命中一个即启动）**：

| 优先级 | 方式 | 说明 |
| --- | --- | --- |
| 0 | 已运行检测 → **聚焦现有窗口** | 按 app_id / 端口 URL（任意 host）匹配 pwahelper/msedge 进程；已在运行则 Win32 聚焦，绝不新开 |
| 0 | `--app-id=<app_id>` | host 启动时扫描 Edge 已安装应用（Manifest Resources + Preferences 按站点 URL 匹配），部署自适应；冷启动后验证进程是否真的出现 |
| 0b | AppsFolder（`explorer shell:AppsFolder\<AUMID>`） | Windows 已注册应用列表，按站点 host 前缀 + 名称匹配 |
| 1-2 | PWA 快捷方式扫描 | 开始菜单 / 任务栏 / 桌面（浏览器 exe + `--app-id` 特征），避免自我递归 |
| 3 | Chromium Web Applications 目录 | 旧结构 internal manifest 匹配 |
| 4 | `--app` / `--new-window` / 默认 | 未安装应用时的浏览器回退 |

**通知链路（可靠主通道，v0.3.6 起全部在插件后台完成，不依赖网页）**：

```
会话事件（官方投影服务，host 侧变更流）
   → 转场判定 → 通知设置/规则过滤 → 写 tray-notify.json
等待批准 / 回答 / 计划审阅：页面传感器上报 → 同一判定与投递
      → 托盘 Timer 1.5s 轮询 → PowerShell 原生 Toast（AUMID 注册）
         ├─ 成功 → 删除队列文件
         └─ 失败 → 记 tray-notify.log + BalloonTip + 提示音
```

**关闭语义（桌面 App 行为）**：

```
页面加载 → online 登记（per-tab clientId）
页面关闭/刷新 → pagehide + fetch keepalive → offline 上报
   → 全部客户端离线 → 20s 防抖（刷新/重连可取消）
   → 任务空闲 → 2s 二次确认 → appExit(0) 官方优雅退出（持久化 flush）
   → 任务在跑 → 驻留；任务完成且仍无客户端 → 自动退出
```

## 配置

`cordis.patch.yml`（或 profile 的 patch 层覆盖）：

```yaml
- id: native-launcher
  config:
    # 快捷方式双击后执行的启动命令（cmd 中运行，依赖 PATH 里的 dsh；dsh 缺失时自动回退 npx --yes @deepseek-ai/dsh）
    # --no-open：让官方 dsh web（rc.8 起默认自动开浏览器）让位，避免双开——浏览器由插件负责打开（PWA 应用优先）
    launchCommand: dsh --profile web --no-open
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
    # 关闭语义（桌面应用行为）：所有页面窗口关闭后，无任务则优雅退出服务；有任务则驻留到完成
    closeToExit: true
```

生成物（用户目录 `~/.dsh-webui-launcher/`，**日志统一在 `logs/` 子目录**）：

> **排错时的一步操作**：把 `logs` 文件夹**整个发过来**即可（不必判断该看哪个文件）。
> 所有日志都在那一个文件夹里，没有第二处——主日志 `native-launcher.log` 最全，其余按组件分文件。
> 设置页「打开日志目录（排错用）」按钮可直接弹出该文件夹。

| 文件 | 作用 |
| --- | --- |
| `launcher.vbs` | wscript 入口：隐藏窗口调起 cmd |
| `launch.cmd` | HTTP 就绪探测 + 启动/直连 + 拉起托盘（dsh 缺失时自动 npx 回退） |
| `open-webui.ps1` | 多路探测打开已安装应用 / 浏览器（已运行→聚焦，未运行→启动） |
| `tray.ps1` | NotifyIcon 托盘（单实例 Mutex；打开 / 退出 WebUI；Toast 通知轮询；版本标记） |
| `tray-version.txt` | 托盘脚本版本标记（apply 用它做托盘自更新） |
| `tray-notify.json` | 通知队列文件（host 写 → 托盘轮询弹 Toast → 消费删除） |
| `dsh-webui.ico` | 快捷方式 / 托盘图标（官方 DSH 图标） |
| `logs/native-launcher.log` | **主日志**：启动/快捷方式/托盘/通知/关闭语义/设置/模块，含环境快照与 client 侧事件（`[ntf]` 域） |
| `logs/native-launcher.prev.log` | 主日志的上一代（超过 1MB 自动轮转归档） |
| `logs/launch.log` | 快捷方式启动分支日志（每次双击的探测结果与走向，排查用） |
| `logs/open-webui.log` | 打开页面链日志（PWA 优先/聚焦/新开窗口的判定过程，排查用） |
| `logs/tray-exit.log` | 托盘启动与退出原因记录（mutex 冲突 / 正常退出，排查用） |
| `logs/tray-notify.log` | 托盘 Toast 消费与失败原因 / tick 错误（排查用） |
| `logs/pwa-scan.log` | PWA 应用扫描诊断日志（每次启动重写，排查用） |
| `logs/uninstall.log` | 一键卸载的审计日志（刻意不随卸载清理，失败可溯源） |

## 与同类方案对比

| 方案 | 形态 | 亮点 | 短板 |
| --- | --- | --- | --- |
| **dsh-native-launcher（本插件）** | 标准 dsh 插件 + Windows 自带机制 | 轻量（零重型依赖）、托盘、已装应用优先打开、可靠通知、关窗自动退出、安装引导、设置页、端口直连、静默启动、官方图标 | 仅 Windows |
| [jenokagong/dsh-webui-launcher](https://github.com/jenokagong-dotcom/dsh-webui-launcher) | 纯 bat | 控制台可最小化恢复、快速启动（~2s） | 关窗=停服务、无托盘、无端口直连 |
| [LvienOeria 插件](https://github.com/LvienOeria/ds-harness-webui-launcher) | dsh 插件 | 幂等 state hash、配置 .bak 备份、坏配置大声报错 | **不支持 Windows**，无托盘/快捷方式 |
| [zhanweipan 启动器](https://github.com/zhanweipan/ds-harness-launcher) | Electron | 一键部署、版本管理、多实例、日志面板 | 重型桌面端，与轻量定位相悖 |
| [Hllojjh 托盘](https://github.com/Hllojjh/ds-harness-tray) | Python 托盘 | 单实例互斥、只停自己进程树、外部占用识别、二次确认 | 依赖 Python 运行时 |
| [Ruler4396 启动器](https://github.com/Ruler4396/ds-harness-webui) | WebView2 | 服务驻留三模式、关窗即停 | 依赖 WebView2 运行时 |

**差异化**：同为 dsh 插件的方案里，LvienOeria 不支持 Windows、jenokagong 无托盘，而重型桌面端（Electron/WebView2/Python）都要求**额外安装运行时**——与"不额外安装任何东西"的理念相悖。本插件是"纯 Windows 原生 + 纯插件"的最小代价路线：**桌面"应用窗口"走浏览器原生 PWA 机制**——用户安装 PWA 后快捷方式直接打开已安装应用（任务栏独立、官方图标、可固定），而非自造浏览器壳——同样是"任务栏独立应用"，成本比 Electron/WebView2 低一个数量级，且不引入额外的重型运行时。


## 致谢

- 构建于 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 插件生态之上（MIT License, Copyright (c) 2026 DeepSeek）——"以最小破坏性利用原生插件生态实现桌面级体验"的设计理念，依赖其 Cordis 插件机制与官方 API
- **任务通知设计源自**：[dsh-notification](https://github.com/omdsh-dev/dsh-notification)（MIT License, Copyright (c) 2026 DeepSeek）——上游已停止维护（失效于 dsh 0.1.5 的架构变更）；v0.3.6 起按其决策链设计重写为本项目**自维护的通知模块**（决策收归插件后台、托盘为唯一通道），上游的贡献与设计归属致谢于此
- 图标使用官方 DeepSeek Harness 品牌图标（源自 dsh web 的 `favicon.svg`），仅用于非商业开源插件场景

## 许可证

MIT
