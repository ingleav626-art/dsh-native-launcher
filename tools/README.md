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
