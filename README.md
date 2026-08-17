# dsh-native-launcher

> **给 DeepSeek Harness 的 Web 界面一个"桌面应用"级的体验：双击启动、托盘常驻、任务完成通知、关窗自动退出——全程不安装任何额外软件。**

🪟 **仅支持 Windows** · 当前版本 **v0.2.0** · [查看更新历史](#版本历史)

![效果图占位：桌面快捷方式 + 系统托盘 + 任务完成通知 + 独立应用窗口](assets/screenshot-placeholder.png)
<!-- 截图占位：请替换为实际截图（快捷方式 / 托盘菜单 / Toast 通知 / PWA 应用窗口） -->

---

## 🚀 快速开始（10 秒上手）

```bash
npm install -g pnpm                                   # ① 前置要求（仅首次）
npm install -g dsh-native-launcher                    # ② 安装插件
dsh plugin --profile web add dsh-native-launcher      # ③ 挂载到 profile
# ④ 重启 dsh web
```

> ⚠️ **前置提醒**：第③步依赖 **pnpm**。如果报 `pnpm is not recognized`，执行第①步（或 `corepack enable pnpm`）后再试。

重启后：**桌面出现"DSH WebUI"快捷方式**，右下角出现**托盘图标**——双击快捷方式即用。

---

## ✨ 核心亮点

1. 🖱️ **双击即用**——桌面快捷方式，静默启动，无黑窗无闪屏
2. 🪟 **系统托盘常驻**——"打开 WebUI / 退出 WebUI"，退出＝停服务+关窗口+退托盘，一次干净
3. 🔔 **任务完成通知**——回合结束弹**系统原生通知**（完成/出错/中止/阻塞/Token 上限），**不依赖浏览器通知权限**，关掉页面也不漏提醒
4. 🚪 **关窗自动退出**——关闭所有窗口后服务自动优雅退出；**有任务在跑绝不中断**，跑完才退
5. 🖥️ **应用窗口优先**——把站点安装为应用后，快捷方式直接打开**独立应用窗口**（无地址栏、任务栏独立图标），窗口已开着时只唤起、不重复弹
6. 🧊 **零额外安装**——只用官方插件 + Windows 自带能力，装进 profile 即用、卸载即干净

---

## 📱 安装为应用（可选，推荐）

用普通浏览器打开 `http://127.0.0.1:3080` → 页面右下角出现**安装引导** → 点「安装」→ 确认。

装完后：快捷方式直接打开**应用窗口**（独立任务栏图标、无地址栏、可固定任务栏）；点安装没反应时，用 Edge 菜单 `⋯ → 更多工具 → 应用 → 将此站点安装为应用`。

---

## ⚙️ 配置（进阶用户）

在 profile 的 patch 层覆盖 `cordis.patch.yml`：

```yaml
- id: native-launcher
  config:
    launchCommand: dsh --profile web    # 快捷方式双击后执行的启动命令
    autoOpen: true                      # 快捷方式启动时自动打开浏览器
    shortcutName: DSH WebUI             # 快捷方式名称
    port: 3080                          # 端口（需与 webserver 一致）
    tray: true                          # 系统托盘
    openMode: app                       # app=应用窗口 | new-window | default
    closeToExit: true                   # 关窗自动退出（有任务驻留到完成）
```

> 设置页里也有"WebUI 启动器"面板：查看当前配置、一键重建快捷方式；另有独立"通知"设置页（完成原因开关、关键词规则、等待确认开关、测试按钮）。

---

## ❓ 常见问题

**Q：任务完成了但没收到通知？**
A：通知主通道是托盘原生通知（不依赖浏览器权限）。如果连托盘都没有弹：先确认托盘图标在（重启 dsh 会自动拉起/换新托盘），再看 `~/.dsh-webui-launcher/tray-notify.log` 是否有失败原因。另注意 Windows 会**静默屏蔽短时间内的连续通知**——测试按钮请间隔几秒再点。

**Q：关掉窗口后服务退出了，但我不想让它退？**
A：把配置 `closeToExit` 改为 `false`——关窗后服务常驻（手动用托盘"退出 WebUI"才退出）。

**Q：任务还在跑，我关了窗口，任务会丢吗？**
A：不会。有任务在跑时服务会**驻留**，任务跑完（且仍无窗口）才自动退出；任务完成还会弹托盘通知。

**Q：改了端口，启动打开的还是旧页面？**
A：改 `port` 后旧 PWA 应用仍指向旧端口，启动会自动回退为浏览器模式（功能可用）；清理旧应用请到 `edge://apps` 手动卸载。

**Q：卸载重装了浏览器应用，通知没了？**
A：托盘通知不受影响；浏览器兜底通知需要在通知设置页重新点一次"请求权限"。

**Q：托盘图标不见了？**
A：重启 dsh 会自动重新拉起（含旧托盘自动换新）；仍不行就任务管理器结束残留的 PowerShell 托盘进程再重启。

**Q：一个任务会收到两条通知（托盘+浏览器）？**
A：不会。托盘是主通道，浏览器通知只在其未送达时兜底（3 秒确认），正常情况下只弹一条。

---

## 🔧 工作原理（开发者）

<details>
<summary>点击展开：架构与实现细节</summary>

### 总览

```
桌面快捷方式 → 静默启动 → dsh 服务 + 系统托盘 + 应用窗口
     └─ 关窗 → 自动优雅退出（有任务驻留）
     └─ 回合结束 → 托盘原生通知（页面关了也补发）
```

所有能力只由两部分组成：**标准 dsh 插件**（挂载官方插槽、监听官方事件）+ **Windows 自带机制**（脚本、托盘、原生通知、系统注册）。不改官方 Web UI、不碰浏览器结构。

### 技术来源

| 层 | 来源 |
| --- | --- |
| 静默启动 / 端口探测 / 托盘 / 原生 Toast / 窗口聚焦 | Windows 自带（wscript / cmd / .NET / user32 / Windows.UI.Notifications）——纯桥接 |
| 设置页插槽 / 事件流 / 投影 / 优雅退出（appExit） | 官方 dsh 能力——直接使用 |
| 任务完成检测 / 规则过滤 / 等待确认检测 | [dsh-notification](https://github.com/omdsh-dev/dsh-notification)（MIT，原样构建产物集成，随上游更新） |
| 应用窗口 | 浏览器原生 PWA 机制 |
| 自研部分 | 仅"胶水"：多路打开探测链、托盘逻辑、通知桥接层、关闭语义状态机、设置 UI |

### 生成物（用户目录 `~/.dsh-webui-launcher/`）

| 文件 | 作用 |
| --- | --- |
| `launcher.vbs` / `launch.cmd` | 静默启动入口 + TCP 端口探测 |
| `open-webui.ps1` | 打开已装应用/浏览器（已运行→聚焦，未运行→启动，多级回退） |
| `tray.ps1` | 托盘：菜单 / Toast 通知轮询 / 退出流程 / 版本自更新 |
| `tray-version.txt` | 托盘版本标记（重启 dsh 自动换新托盘） |
| `tray-notify.json` | 通知队列（host 写 → 托盘弹 → 消费删除） |
| `native-launcher.log` | 运行日志（启动/托盘/通知/关闭语义诊断） |
| `tray-notify.log` | 托盘 Toast 失败原因 |
| `pwa-scan.log` | PWA 应用扫描诊断 |

### 通知链路

```
回合结束（agent 实时窗口判定，防历史重放）
  ├─ 页面开着：规则过滤 → 上报 host → 队列文件
  │     └─ 3 秒确认：托盘已弹 → 浏览器不弹；未弹 → 浏览器兜底
  └─ 页面已关：host 2 秒确认窗口后直接补写（全量）
        └─ 托盘轮询 → PowerShell 原生 Toast（有声、进通知中心）
           └─ 失败 → BalloonTip + 提示音 + 日志
```

等待批准 / 回答 / 计划审阅（`pendingInteraction`）走同一通道。

### 关闭语义

```
页面 online/offline 上报（pagehide + keepalive，浏览器保证送达）
  → 全部离线 → 20s 防抖（刷新/重连可取消）
  → 任务空闲 → 2s 二次确认 → 官方 appExit 优雅退出（持久化 flush）
  → 任务在跑 → 驻留；完成且仍无客户端 → 自动退出
```

### 与同类方案对比

| 方案 | 形态 | 亮点 | 短板 |
| --- | --- | --- | --- |
| **本插件** | dsh 插件 + Windows 自带机制 | 零额外安装、托盘、应用窗口、可靠通知、关窗自动退出 | 仅 Windows |
| [jenokagong/dsh-webui-launcher](https://github.com/jenokagong-dotcom/dsh-webui-launcher) | 纯 bat | 简单快速 | 无托盘/无通知/关窗即停 |
| [LvienOeria 插件](https://github.com/LvienOeria/ds-harness-webui-launcher) | dsh 插件 | 配置备份 | 不支持 Windows |
| [zhanweipan 启动器](https://github.com/zhanweipan/ds-harness-launcher) | Electron | 功能全 | 需安装重型运行时 |
| [Hllojjh 托盘](https://github.com/Hllojjh/ds-harness-tray) | Python | 托盘 | 需 Python |
| [Ruler4396 启动器](https://github.com/Ruler4396/ds-harness-webui) | WebView2 | 窗口 | 需 WebView2 |

</details>

---

## 📚 术语表

| 术语 | 含义 |
| --- | --- |
| **PWA** | 把网页"安装"成应用的浏览器机制（独立窗口、任务栏图标） |
| **系统托盘** | 任务栏右下角的小图标区（时钟旁边） |
| **Toast** | Windows 原生通知（右下角弹出、进通知中心、带声音） |
| **优雅退出** | 退出前保存好数据再关闭（不会丢会话状态） |
| **wscript / powershell / NotifyIcon 等** | 本插件桥接的 Windows 自带组件（无需你安装任何东西） |

---

## 版本历史

### v0.2.0（当前）
- **可靠通知**：托盘原生 Toast 主通道（不再依赖浏览器通知权限）、浏览器兜底不双弹、页面关闭自动补发
- **关闭语义**：关窗自动退出 + 任务保护（有任务驻留到完成）
- **等待确认通知**：批准 / 回答 / 计划审阅（上游 dsh-notification v0.1.2 同步）
- 托盘自更新、强杀残留清理、多进程名兼容（powershell/pwsh）

### v0.1.0
- 桌面快捷方式、静默启动、TCP 端口探测、托盘（打开/彻底退出）
- PWA 应用窗口优先 + 聚焦唤起不重复弹窗、多代 Edge 兼容
- 安装引导、设置页增强、任务完成通知（dsh-notification 集成）

---

## 🗑️ 卸载

```bash
dsh plugin --profile web remove dsh-native-launcher
```

```powershell
Remove-Item "$env:USERPROFILE\.dsh-webui-launcher" -Recurse -Force   # 启动脚本/托盘/日志
Remove-Item "$env:USERPROFILE\Desktop\DSH WebUI.lnk"                 # 桌面快捷方式
```

- 托盘进程：右键托盘退出（若还在运行）
- 已安装的 PWA：`edge://apps` → DSH WebUI → 卸载
- 最后重启 dsh

---

## ❤️ 致谢

- **任务通知功能集成自** [dsh-notification](https://github.com/omdsh-dev/dsh-notification)（MIT License, Copyright (c) 2026 DeepSeek）——host 投影与 client 完成检测/设置为上游**原样构建产物**，随上游版本同步
- 图标使用官方 DeepSeek Harness 品牌图标（源自 dsh web 的 `favicon.svg`），仅用于非商业开源插件场景

## 📄 许可证

MIT
