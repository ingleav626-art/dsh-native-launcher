# 开发工具（tools/）

本目录是**开发/排障工具**，不随 npm 包发布（`package.json` 的 `files` 只含 `lib` / `assets` /
`cordis.patch.yml` / `README.md` / `THIRD-PARTY-NOTICES`）——用户装的是 npm 上的正式版本，
这里的东西只有改代码或排查问题时才用得上。

## 工具索引

| 工具 | 用途 | 什么时候用 |
|---|---|---|
| `build.mjs` | `src/` → `lib/` 构建（`npm run build`） | 改完 TS 源码 |
| `compare.cjs` | 重构期的**函数级对账**（matched/differed/missing + 注释保留） | 迁移代码时每批必跑；本机 typescript 是 tsgo 预览版，**不能加 `--strip-types`**（两侧复制成 `.js` 再比） |
| `log-inventory.mjs` | **日志点对账**（按打点文本比基线/目标，缺失即退出码 1） | 每次迁移 / 重构，与 compare 一起跑 |
| `launch-timing.mjs` | 双击等价链路（vbs → launch.ps1 → dsh）启动耗时计时，终点 = socket ready | 验证启动优化；**会先停掉端口上的现有 dsh** |
| `regen-launcher.mjs` | 按当前 `lib/` 产物重写真机启动脚本（launch.cmd / launch.ps1 / launcher*.vbs …） | 改了启动脚本模板但要立即真机验证，不想重启 dsh |
| `verify-alpha-compat.mjs` | 在**物理隔离沙箱**（DSH_HOME/USERPROFILE 全指向临时目录）里验证插件对指定 dsh 版本的适配 | 跟进官方新版本前 |
| `scan-sessions.mjs` | **只读**扫描 dsh 会话日志完整性（复刻官方持久化层的启动校验：zstd 帧 → 解压 → 头部断言） | 怀疑会话文件损坏导致启动校验失败 |
| `test-tray-regression.ps1` | 托盘 E2E 回归（UIA 自动化，**会重启 dsh**） | 改托盘/启动链路/close-to-exit 后 |
| `make-ico.mjs` | 生成 `assets/dsh-webui.ico` | 换图标 |
| `probe/` | **启动性能探针套件**（见下） | 排查"启动慢 / 被系统节流"类问题 |
| `compare-result-*.txt` | 对账报告（本地产物，已 gitignore、不进包） | 只看，不必提交 |

## 启动性能探针（probe/）

2026-09-13 查"快捷方式 40 秒 vs 命令行 8 秒"时建的仪器，之后同类问题直接复用：

| 文件 | 作用 |
|---|---|
| `boot-series.mjs` | 从真机日志还原**启动耗时序列**（launch.log 的 `launching:` → native-launcher.log 首条 `[diag] node=`），一眼看出双峰/劣化——**不改动任何东西，先跑它** |
| `run-contexts.mjs` | 同一份探针跑在四种启动上下文（explorer/直接 × 隐藏/显示/最小化），定位"是不是无窗口被系统限速" |
| `loadprobe.mjs` | 合成负载分片测量：JS 自旋 / 原生 SHA256 / 文件读 的每片吞吐 + CPU 比 + 上下文切换；支持中途提权对照 |
| `envprobe.mjs` | 落盘 explorer 启动与终端启动的 env / cwd / 进程创建延迟（先排除最廉价的一类病根） |
| `counter-sample.ps1` | 每核 `% Processor Performance` / `% Processor Utility` / 频率采样（判"降频"还是"换核型"） |
| `out/` | 探针原始数据（已 gitignore） |

**注意**：探针会起隐藏的 wscript/explorer 子进程做对照实验——**这台机器上不要写"隐藏起子进程"的
PowerShell 脚本**（会被 360 判 `HEUR:TrojanDownloader/PS.NetLoader.ae` 并删除脚本本体，2026-09-13 实锤）。

---

# 托盘回归测试工具（test-tray-regression.ps1）

端到端验证 Windows 托盘（tray.ps1）生命周期的自动化脚本。**任何改动涉及
托盘拉起、launch.cmd、close-to-exit、tray.ps1 生成逻辑后，跑一次即可确认没回归。**

## 什么时候用

- PR 改动涉及：`lib/index.js` 里 apply 的托盘 spawn、`writeLauncherFiles`（launch.cmd）、
  `writeTrayScript`（tray.ps1）、close-to-exit 逻辑
- 发布新版本前（配合手动点一遍托盘菜单）
- 排查"托盘不出现 / 托盘闪退 / 黑窗"类问题后验证修复

## 怎么运行

```powershell
# 默认参数直接跑（端口 3080，launcherDir = %USERPROFILE%\.dsh-webui-launcher）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\test-tray-regression.ps1

# 指定结果日志路径
powershell ... -File tools\test-tray-regression.ps1 -ResultLog D:\tmp\tray-test.log

# 测完不自动重启 dsh（留给手动跟进）
powershell ... -File tools\test-tray-regression.ps1 -SkipHeal
```

参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `-LauncherDir` | `%USERPROFILE%\.dsh-webui-launcher` | 启动器工作目录（launch.cmd / tray.ps1 所在） |
| `-Port` | `3080` | WebUI 端口 |
| `-AppId` | 自动探测 | 已安装 PWA 的 app id（自动从 tray.ps1 / pwa-scan.log 读取） |
| `-ResultLog` | `<LauncherDir>\test-results.log` | 结果日志路径 |
| `-SkipHeal` | 关 | 测试结束后不自动重启 dsh |

## 测什么（三个场景）

| 场景 | 验证内容 | 判定证据 |
|---|---|---|
| **S1** 托盘拉起 | dsh 启动后 apply 能拉起托盘：进程存在、无可见窗口、launch.cmd 不再自带托盘行 | tray mutex 被占 + CIM 进程扫描命中 + `MainWindowTitle` 为空 + `[tray started` 新日志 |
| **S2** 存活 | 关掉 WebUI 窗口 → close-to-exit 让 dsh 退出 → **托盘必须还活着**（不随 dsh 死） | 指定 dsh PID 消失 + 托盘 mutex 仍被占 + 无 `message loop ended` |
| **S3** 退出 | UIA 自动点托盘"退出 WebUI"→ 确认框 → 浏览器应用窗口 + dsh + 托盘全部清理 | 托盘进程消失 + mutex 释放 + tray-exit.log 出现 `dsh stopped` / `message loop ended` |

测试结束会自动重启 dsh（自愈），WebUI 恢复可用。

## 注意事项

1. **会中断 WebUI**：脚本会杀掉当前 dsh 并关闭本站 PWA 应用窗口（普通浏览器标签页和主浏览器窗口不受影响），全程约 3-4 分钟，结束自动重启。启动后有 **30 秒宽限期**，足够关掉正在进行的会话。
2. **前置条件**：被测的 dsh 必须已经用新代码启动过一次——脚本预检 `launch.cmd`，如果里面还残留托盘拉起行（旧代码产物），会直接中止并提示先重启 dsh。
3. **建议独立启动**：脚本设计为脱离 dsh 运行（`Start-Process` 或计划任务都行），因为测试中途 dsh 会死。从 dsh 内部（agent 工具）直接前台跑也能用，但会观察到会话中断。
4. **UIA（S3）依赖交互桌面**：托盘菜单点击需要当前用户的桌面会话，从服务/计划任务（非交互）运行会失败并标记 S3 PARTIAL。
5. **沙箱/受限环境的结果要复核**：进程创建行为可能被沙箱影响（历史上 detached spawn 即退、无 detached 随父死都在沙箱里复现过）。**合并决策以真实环境（双击快捷方式链路）的日志为准。**

## 结果怎么看

- 退出码：`0` = 三场景全 PASS；`1` = 有失败/中止
- 结果日志末尾的 `=== SUMMARY ===` 给出每场景 PASS / FAIL / PARTIAL / SKIP
- 证据交叉核对：`<LauncherDir>\launch.log` / `tray-exit.log` / `native-launcher.log` / `open-webui.log`

## 设计要点（改脚本前先看）

- 存活判定：**tray mutex（`Local\DshNativeLauncherTray`）占用探测 + CIM 进程扫描**
  （cmdline 含 tray.ps1），双保险
- S2 等待**指定 dsh PID 消失**而不是端口空——用户/autoOpen 可能提前拉起新 dsh，
  只看端口会误判（历史上因此强杀过用户的 dsh）
- Phase 0 杀完旧托盘后**轮询确认 mutex 释放**（最多 10s），未释放直接中止——
  否则新托盘 spawn 会 `mutex not acquired` 三连败
- 托盘按钮/菜单/确认框的中文名称用 `[char]` 码构造，脚本保持纯 ASCII 源文件，
  避免 PowerShell 5.1 无 BOM 编码问题
