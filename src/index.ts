// dsh-native-launcher 组装根（P2-B7b 起：lib/index.js 由本文件构建生成，不再手写）。
// 产物头部说明经 build.mjs 的 INDEX_BANNER 保留。
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

// 插件版本（构建时由 tools/build.mjs 的 define 注入 package.json version——
// 环境快照与诊断日志用它对齐"哪个版本在跑"，不依赖用户描述）
declare const PLUGIN_VERSION: string;
// 模块系统（dev-notes 一·七）：本体之外的功能全部走 lib/modules/<id>，统一 gating
import { CORE_API_VERSION, BUILTIN_MODULES } from './host/core/moduleRegistry.ts';
// 端口适配层（P1 通知 v2）：把官方 ctx / 本体状态翻成模块的窄接口（唯一触碰官方形状的地方）
import { createNotificationPorts } from './host/io/ports.ts';
// P2 拆分批次（源码 src/host/**，产物 lib/host/*.js——build.mjs ENTRIES 维护）：
import { logMsg, logWarn, logFail, beginApplyLog, nextSaveSeq } from './host/io/logger.ts';
import { logsDirOf, resolveDesktopPath } from './host/core/paths.ts';
import { dshVersionGte } from './host/core/version.ts';
import { detectDshVersion, logEnvDiagnostics } from './host/io/diagnostics.ts';
import z from '@deepseek-ai/schemastery';
import { LAUNCHER_FIELDS, registerLauncherSettings } from './host/io/settings.ts';
import { NOTIFICATION_SETTINGS_SCHEMA } from './modules/notification/host/settings.ts';
import { writeOpenScript, writeLauncherFiles } from './host/io/scripts.ts';
import { ensureIcon, extractPngDataUrl } from './host/io/icon.ts';
import { createDesktopShortcut, ensureStartupShortcut, startupLnkPath } from './host/io/shortcut.ts';
import { readTrayState, writeWebuiUrl, readShortcutRegistry, migrateLegacyStateFiles } from './host/io/state.ts';
import { findInstalledPwaAppId, registerPwaRoutes } from './host/io/pwa.ts';
import { TRAY_SCRIPT_VERSION, writeTrayScript, killExistingTrays, startTrayProcess } from './host/io/tray.ts';
import { setupCloseToExit } from './host/services/closeToExit.ts';
import { setupAutoOpen } from './host/services/autoOpen.ts';
import { registerRpcFallbackBridge } from './host/io/rpcBridge.ts';
import { setupLauncherRpc, type NotificationModuleHandle } from './host/services/launcherRpc.ts';
import { setupModules } from './host/services/modules.ts';
import { raiseOwnPriority, priorityName } from './host/io/priority.ts';
import type { HostCtx, LauncherConfig } from './host/types.ts';

// ── 进程优先级：本文件被 import 的那一刻就执行（插件最早能跑代码的时刻）──
// Windows 对无可见窗口的进程在创建后约 3s 施加节流（2026-09-13 实测：交付算力 1/3、
// 文件 IO 1/5、原生 SHA256 1/2，而进程 CPU 时间仍 1:1 记账）。父进程的优先级类不会被
// 子进程继承，官方也没有 API 让启动器替我们设——所以在自己的进程里自提。
// 为什么不在 launch.ps1 里做：脚本里「隐藏起子进程」会被 360 判成 PS.NetLoader 并删掉脚本本体。
const priorityRaise = raiseOwnPriority();

export const name = 'native-launcher';
/**
 * inject = 插件**必需**的官方服务（cordis 保证注入；缺任一即环境异常）。
 *
 * `settings` **刻意不在其中**（2026-09-24 用户拍板）：它对本插件是**可选**能力——缺失时只是设置页
 * 不可用、配置回落 cordis.patch.yml，本体照跑。按项目规范「可选服务一律 ctx.get + 降级，别塞
 * inject」，移出可避免官方将来移除/改名 settings 服务时**整个插件拒载**（0.1.7 把 settings 重构成
 * SettingsForms、直接删掉 register 正是这类风险的实证）。取用与降级见 applyInner 里的窄面收口。
 */
export const inject = ['webServer', 'connection', 'sessionProjections'];

/**
 * 插件 Config —— 0.1.7+ 官方设置面**只认这里导出的 schema**（`runtime.Config = plugin.Config`，
 * 见 cordis 源码；官方 `isNativeConfigSchema` 认的正是 schemastery 图）。
 *
 * 两段合一：启动器字段（LAUNCHER_FIELDS）+ 通知模块子段（notification）。
 * 后者存在的理由：官方 `describe()` **只遍历 profile entries**，而通知模块的 ns
 * （`dsh-native-notification`）不是 entry —— 新机制下它必须落在主 entry 的子段里
 * （读写映射见 io/settingsScope.ts 的 SETTINGS_SUBPATH）。旧机制（≤0.1.6）不受影响，
 * 通知模块仍用自有 ns 注册。
 *
 * 必须 `.volatile()`：官方设置面只收 volatile 字段，未标记时 update 直接报
 * `Plugin entry "x" has no volatile fields`（2026-09-24 沙箱实测原文）。
 * volatile 语义 = 改了不重载插件实例，由插件自己处理变更 —— 与本项目
 * "设置改动需重启 dsh 生效（脚本/托盘在 apply 时生成）"的口径一致。
 */
export const Config = z.object({
  ...LAUNCHER_FIELDS,
  notification: NOTIFICATION_SETTINGS_SCHEMA,
}).volatile();

// 一键卸载后置标记（P2-B6-b 归位：uninstall case 经 deps.armExitCleanup 触发）——
// dsh 进程退出瞬间清掉残留的功能性生成文件（日志永久保留作为证据）
let pendingExitCleanup: string | null = null;
function armExitCleanup(dir: string) {
  pendingExitCleanup = dir;
  process.once('exit', () => {
    const target = pendingExitCleanup; pendingExitCleanup = null;
    if (!target) return;
    try {
      for (const name of ['launch.cmd', 'launcher.vbs', 'tray.ps1', 'open-webui.ps1', 'dsh-webui.ico', 'tray-pid.txt', 'tray-version.txt', 'tray-state.json']) {
        const p = join(target, name);
        if (existsSync(p)) { try { unlinkSync(p); } catch { } }
      }
      try { appendFileSync(join(logsDirOf(target), 'uninstall.log'), `[${new Date().toISOString()}] [INFO ] dsh exited - post-exit artifact cleanup ran\r\n`); } catch { }
    } catch { }
  });
}

/**
 * 插件入口。
 *
 * **刻意不 await applyInner**（2026-09-24 沙箱实测教训，日志实锤）：
 * 官方 `describe()` 只返回 **fiber 已 active** 的条目，而 fiber 要等 `apply` **返回**才激活——
 * 若这里 await，applyInner 内部等配置就等于"等自己"，必然死锁：ready() 只能超时放行，
 * apply 拿到空配置（日志 `resolved: port=undefined, launchCommand=undefined`）且启动被拖慢
 * （实测 +2.4s / +3.2s，正好是 ready 超时值）。
 *
 * 故：**同步返回**让 fiber 立即激活，applyInner 作为续体继续跑（其内部 ready() 轮询随即命中，
 * 预期 ~100ms）。错误仍被捕获并落盘（不拖垮本体，铁律 1）。
 */
export function apply(ctx: HostCtx, config: LauncherConfig = {}): void {
  const running = applyInner(ctx, config);
  running.catch((error) => {
    logFail(`[launcher] apply failed (harness continues): ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  });
}

async function applyInner(ctx: HostCtx, config: LauncherConfig = {}) {
  // 日志初始化最前置（P2-B2 修正：此前 dsh version / [settings] registered 等 apply 前段
  // 日志在 LOG_PATH 就绪前只 echo 不落盘——dsh 的 stdout 被丢弃，用户永远看不到 = 黑箱）。
  const home = process.env.USERPROFILE;
  if (!home) {
    logMsg('USERPROFILE missing; launcher cannot be installed');
    return;
  }
  const launcherDir = join(home, '.dsh-webui-launcher');
  const { logsDir, applySeq } = beginApplyLog(launcherDir);
  logMsg(`──────────────── apply #${applySeq} start (dsh pid=${process.pid}) ────────────────`);
  // settings 不在 inject 里（见文件头 inject 注释）——**属性访问会抛**（cordis 4 守卫），因此
  // 所有 settings 取用一律走 `ctx.get('settings')`（io/settings.ts 与 io/ports.ts 内部收口），
  // 缺失时降级为 patch 配置。**真 ctx 保持原样传给下游**——官方 API 必须拿到真 cordis ctx：
  // 传包装对象会让官方内部的 inject 检查失败（实测 `cannot get property "webServer" without
  // inject` → RPC 被迫走降级桥），原型链/Object.create 方案也会触发 cordis 的跨 fiber 守卫。
  // 启动耗时埋点（v0.4.1 性能优化的数据来源）：各阶段日志带相对 apply 开始的毫秒数
  const applyT0 = Date.now();
  const elapsed = (): string => `+${Date.now() - applyT0}ms`;
  // rc.8 适配：官方 dsh web 默认自动打开浏览器（普通标签页），会与我们插件的
  // PWA 应用窗口打开形成双开——启动命令加 --no-open 让官方让位，由插件
  // （autoOpen → open-webui.ps1，PWA 应用优先）负责打开。
  // 版本门槛（2026-09-13 用户定调）：适配与验证基准统一到官方最新版 0.1.5-rc.2，
  // 不再针对更低版本做适配与验证——README「版本要求」与本行文案必须同步，
  // 需要旧版本 dsh 的用户请使用对应的历史插件版本。
  const dshVersion = detectDshVersion();
  if (dshVersion && !dshVersionGte(dshVersion, '0.1.5-rc.2')) {
    logMsg(`WARNING: dsh ${dshVersion} is below 0.1.5-rc.2 — this plugin is adapted and verified against 0.1.5-rc.2 (task notifications rely on its projections/services). Please upgrade: npm install -g @deepseek-ai/dsh@0.1.5-rc.2`);
  }
  logMsg(`dsh version: ${dshVersion || '(unknown)'}`);
  // 注册官方设置卡片（rc.7+）：resolved = schema 默认值 → patch base（cordis.patch.yml）→ 用户设置文档。
  // 合并结果作为本次生效配置；用户改设置后需重启 dsh 完全生效（脚本/托盘/快捷方式都在 apply 时生成）。
  // settingsScope 属主 = src/host/io/settings.ts（P2-B1 起收拢；RPC 的 config.get/set 经它读写）
  const { scope: settingsScope, cfg: resolvedCfg } = await registerLauncherSettings(ctx, config, logMsg);
  logMsg(`timing: settings registered ${elapsed()}`);
  // 0.1.7+：官方会为每个带 schema 的插件自动生成设置页；本项目有自绘卡片（含"测试通知"/"一键卸载"
  // 这些官方表单表达不了的操作），故关掉自动页，避免同一插件出现两份设置入口。
  // 旧机制（≤0.1.6）无 configure 方法，自动跳过。
  if (typeof ctx.settings?.configure === 'function') {
    try {
      ctx.settings.configure({ auto: false });
      logMsg('[settings] configure({auto:false}) — 使用插件自带设置卡片');
    } catch (error) {
      logMsg(`[settings] configure 失败（继续）：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  let cfg = resolvedCfg;
  const launchCommand = cfg.launchCommand ?? 'dsh --profile web --no-open';
  const shortcutName = cfg.shortcutName ?? 'DSH WebUI';
  const autoOpen = cfg.autoOpen !== false;
  const force = cfg.force === true;
  const port = cfg.port ?? 3080;
  // 在线客户端计数已收归 close-to-exit 服务（P2-B5，autoOpen 经 getClientsOnline 读取）
  const trayEnabled = cfg.tray !== false;
  const openMode = cfg.openMode ?? 'app';
  // 关闭语义参数（设置页可调，含下限保护：防抖至少 5s、确认窗口至少 1s）
  const debounceSeconds = Math.max(5, Number(cfg.closeToExitDebounceSeconds ?? 20) || 20);
  const debounceMs = debounceSeconds * 1000;
  const finalConfirmSeconds = Math.max(1, Number(cfg.closeToExitFinalConfirmSeconds ?? 2) || 2);
  const finalConfirmMs = finalConfirmSeconds * 1000;
  // 通知模块实例（4.5 装配；RPC 桥转发 client 的 pending 上报时用）——声明提前避免 TDZ
  let notificationModule: NotificationModuleHandle | null = null;

  // 1. 生成静默启动脚本（launch.cmd 端口探测 + launcher.vbs 隐藏窗口）
  // 传 cfg（settings + patch 合并后的解析值）而非 patch 原始 config——否则用户改过
  // launchCommand/shortcutName 后，[diag] 永远打印旧值与实际执行链路自相矛盾（issue #3）
  logEnvDiagnostics(launcherDir, cfg, logMsg);
  const vbsPath = join(launcherDir, 'launcher.vbs');
  // agent 运行计数已收归 close-to-exit 服务（P2-B5，原 applyInner 级声明删除）
  try {
    // 必须先建目录：writeOpenScript 在 writeLauncherFiles 之前执行，
    // 若目录不存在会抛 ENOENT 并中断整个写入链（launcher.vbs 等全部缺失）。
    mkdirSync(launcherDir, { recursive: true });
    const trayPath = trayEnabled ? join(launcherDir, 'tray.ps1') : null;
    const openScriptPath = join(launcherDir, 'open-webui.ps1');
    // 环境快照（用户报障定位第一屏）：OS/Node/插件版本/PWA 检测结果——环境类问题
    // （老系统/旧 Node/浏览器未装 PWA）不靠用户描述，靠这里一次落盘。
    const pwaAppId = findInstalledPwaAppId(port, launcherDir);
    logMsg(`environment: plugin=${PLUGIN_VERSION} node=${process.version} os=${os.type()} ${os.release()} (${os.arch()})`);
    logMsg(`environment: launcherDir=${launcherDir} pwaAppId=${pwaAppId ?? '(not installed — toast click will do nothing)'}`);
    // 自提时刻要留痕：系统节流点在 node 启动后约 3s（实测），早于它 → 整段本体装载都不受影响。
    // 用户日后报"启动又慢了"，先看这行：若优先级变回 Normal 或时刻晚于 3s，结论立刻有据。
    logMsg(
      `priority: ${priorityName(priorityRaise.before)} -> ${priorityName(priorityRaise.after)}` +
        `（模块导入于 node 启动后 ${priorityRaise.atUptimeMs}ms，系统节流点约 3000ms）`,
    );
    logMsg(`timing: pwa scan done ${elapsed()}`);
    writeOpenScript(launcherDir, port, openMode, shortcutName, pwaAppId);
    writeLauncherFiles(launcherDir, launchCommand, port, trayPath, openScriptPath);
    if (trayEnabled) writeTrayScript(launcherDir, port, join(launcherDir, 'dsh-webui.ico'), join(launcherDir, 'open-webui.ps1'), pwaAppId);
    logMsg(`timing: launcher scripts written ${elapsed()}`);
  } catch (error) {
    logMsg(`launcher script failed: ${error}`);
  }

  // 遗留状态文件迁移（v0.4.2）：历史裸 txt（tray-pid/tray-version/webui-url/shortcut-registry）
  // → JSON 后清理。此前各路径只在"顺手"时迁移（创建快捷方式/托盘 kill 分支），实测会长期残留
  // （2026-09-15 沙箱验证：4 个 txt 全部残留）——此处集中执行，幂等，无旧文件时零操作。
  try {
    const migrated = migrateLegacyStateFiles(launcherDir);
    if (migrated.length) logMsg(`legacy state files handled: ${migrated.join('; ')}`);
  } catch (error) {
    logMsg(`legacy state migration failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // alpha.2+ 的 Web UI 用一次性进程 token 鉴权（无 token 访问 UI/API 返回 401）。
  // 把带 token 的 URL 落盘给 open-webui.ps1 使用；rc.2 的 connection 服务没有
  // authenticatedUrl，探测失败静默跳过，脚本自动回退固定 URL，两端版本都兼容。
  let authUrlCaptured = false;
  const captureAuthUrl = () => {
    if (authUrlCaptured) return;
    try {
      const conn = ctx.connection;
      if (conn && typeof conn.authenticatedUrl === 'function') {
        const authUrl = conn.authenticatedUrl(`http://127.0.0.1:${String(port)}`);
        if (typeof authUrl === 'string' && authUrl.startsWith('http')) {
          // 双写：json 主格式（结构化）+ txt 兼容（launch.cmd 回退形态只认 txt，0.4.2 移除）
          writeWebuiUrl(launcherDir, authUrl, port, new Date().toISOString());
          authUrlCaptured = true;
          logMsg('webui token url captured for open-webui.ps1');
        }
      }
    } catch (error) {
      logMsg(`webui token url capture deferred: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  captureAuthUrl();
  if (!authUrlCaptured) {
    try {
      const loader = ctx.get('loader') as { await?: () => unknown } | undefined;
      Promise.resolve(loader?.await?.()).then(captureAuthUrl, () => {});
    } catch { }
  }

  // 2. 图标 + 桌面快捷方式 + 开机自启（默认关；设置页 autoStartBoot 开关控制，热应用在 config.set）
  const iconPath = ensureIcon(launcherDir, logMsg);
  createDesktopShortcut(shortcutName, vbsPath, iconPath, force, launcherDir, logMsg);
  ensureStartupShortcut(shortcutName, vbsPath, iconPath, cfg.autoStartBoot === true, logMsg);

  // 3. 注册设置页 RPC（P2-B6-b 迁入 src/host/services/launcherRpc.ts，此处仅组装接线）：
  //    主通道 connection.rpc.handle（0.1.5-rc.x 起官方 connection fiber 未注入 webServer，
  //    此调用注册即抛错）；失败时自动切 webServer 兜底桥，client 端与 wire 协议完全不变。
  const connection = ctx.connection;
  setupLauncherRpc({
    // 官方形状是 connection.rpc.handle——适配为窄面（connection 缺省时 undefined → 走兜底桥）
    connection: connection ? { handle: (channel, handler, opts) => connection.rpc.handle(channel, handler, opts) } : undefined,
    registerBridge: (channel, handler) => registerRpcFallbackBridge(ctx, channel, handler, logMsg, logFail),
    getService: (name) => ctx.get(name),
    settingsScope,
    config,
    launcherDir,
    vbsPath,
    iconPath,
    shortcutName,
    port,
    launchCommand,
    openMode,
    getNotificationModule: () => notificationModule,
    armExitCleanup,
    io: {
      nextSaveSeq, findInstalledPwaAppId, writeOpenScript, writeLauncherFiles, writeTrayScript,
      ensureIcon, createDesktopShortcut, extractPngDataUrl, resolveDesktopPath, logsDirOf,
      killExistingTrays, startTrayProcess, ensureStartupShortcut, startupLnkPath, readShortcutRegistry,
    },
    logMsg, logWarn, logFail,
  });

  // 3.5 注册 PWA 静态路由（真实 URL manifest + PNG 图标 → 让 Chromium 判定可安装）
  registerPwaRoutes(ctx.webServer, launcherDir, iconPath, logMsg);

  // 4. 拉起系统托盘：无论用户从快捷方式还是终端直接启动 dsh，托盘都会出现
  //    （tray.ps1 内部 Mutex 单实例保护，重复拉起自动退出；失败只记日志）
  //    版本自更新：tray.ps1 启动时写 tray-version.txt（TRAY_SCRIPT_VERSION），
  //    若运行中的托盘版本旧（重启 dsh 不会重启托盘），先结束旧托盘进程再拉起新的——
  //    根治"重启后托盘还是旧逻辑"的反复问题。
  if (trayEnabled) {
    try {
      const trayPath = join(launcherDir, 'tray.ps1');
      if (existsSync(trayPath)) {
        // 托盘状态读取收口 io/state.ts（v22 起为 tray-state.json，自动回退旧 txt）
        const trayState = readTrayState(launcherDir);
        const runningVersion = trayState?.scriptVersion ?? 0;
        // 先验证托盘进程是否真的在跑（状态文件可能是残留：进程已死但文件还在）
        // 注意：进程名可能是 powershell.exe 或 pwsh.exe（用户可能用 PowerShell 7 手动启动过托盘）
        const probeCmd = [
          "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe' or Name='pwsh.exe'\" -ErrorAction SilentlyContinue |",
          `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('tray.ps1') -and $_.CommandLine.Contains('${launcherDir.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } |`,
          'Measure-Object | Select-Object -ExpandProperty Count',
        ].join(' ');
        const probe = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', probeCmd], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          timeout: 10000,
        });
        const trayRunning = parseInt(String(probe.stdout ?? '').trim(), 10) > 0;
        logMsg(`tray process running: ${trayRunning} (versionFile=${runningVersion}, want=${TRAY_SCRIPT_VERSION})`);

        if (trayRunning && runningVersion !== TRAY_SCRIPT_VERSION) {
          logMsg(`tray version mismatch (running=${runningVersion}, want=${TRAY_SCRIPT_VERSION}), killing old tray`);
          try {
            // 必须排除 $PID（kill 命令自身命令行也含 tray.ps1，不排除会自杀导致旧托盘未被清理）
            const killCmd = [
              "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe' or Name='pwsh.exe'\" -ErrorAction SilentlyContinue |",
              `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('tray.ps1') -and $_.CommandLine.Contains('${launcherDir.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } |`,
              "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; 'killed:' + $_.ProcessId }",
            ].join(' ');
            const killResult = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', killCmd], {
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
              timeout: 10000,
            });
            logMsg(`old tray kill result: ${String(killResult.stdout ?? '').trim() || '(none)'} exit=${killResult.status}`);
          } catch (error) {
            logMsg(`old tray kill failed: ${error}`);
          }
          // 同步等待旧托盘进程退出（避免 Mutex 冲突）
          try {
            spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Milliseconds 1000'], {
              stdio: 'ignore',
              windowsHide: true,
            });
          } catch {
            // ignore
          }
            // kill 后验证（异步，不阻塞 apply）：确认旧托盘真的没了
            // （若还有残留 = Stop-Process 失败/权限/其他会话）
            const afterKill = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', probeCmd], {
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
            });
            let afterOut = '';
            afterKill.stdout?.on('data', (chunk) => {
              afterOut = String(afterOut + chunk).slice(-2000);
            });
            afterKill.on('close', () => {
              logMsg(`after-kill probe: ${afterOut.trim() || '(empty)'} tray process(es) remain`);
            });
        } else if (trayRunning) {
          logMsg('tray already running (current version), skip spawn');
        } else {
          logMsg('no tray process, spawning fresh');
        }
        // 托盘进程不存在（或刚被换新）→ 拉起；进程已在且版本相符 → 跳过
        // 双机制互备 + 存活验证逻辑抽为模块级 startTrayProcess（设置页保存后的热更新也用它）。
        // 存活模式：traySurvivesDsh !== false = persistent（WScript 首选，托盘独立存活）；
        //           false = with-dsh（直 spawn 首选，托盘随 dsh 退出）——设置页可调。
        if (!trayRunning || runningVersion !== TRAY_SCRIPT_VERSION) {
          startTrayProcess(launcherDir, trayPath, cfg.traySurvivesDsh !== false, logMsg, logWarn, logFail);
        }
        logMsg(`timing: tray ensured ${elapsed()}`);
      }
    } catch (error) {
      logMsg(`tray spawn failed: ${error}`);
    }
  }

  // 4.5 模块加载（容器协议 v2，dev-notes 一·七）——P2-B7a 迁入 src/host/services/modules.ts，
  //   此处仅组装接线：官方 ctx 只在组装根被触摸（端口工厂闭包 ctx），模块只见窄接口。
  setupModules({
    createPorts: () => createNotificationPorts(ctx, {
      launcherDir, log: logMsg, logWarn, logFail,
      // 托盘自身开关（modules.notifications 由容器 gating：模块不加载即无投递）
      isNotifySuppressed: () => cfg.trayNotify === false,
    }),
    cfg,
    builtinModules: BUILTIN_MODULES,
    coreApiVersion: CORE_API_VERSION,
    onNotificationModule: (instance) => { notificationModule = instance as unknown as NotificationModuleHandle; },
    logMsg, logWarn, logFail,
  });
  logMsg(`timing: modules loaded ${elapsed()}`);

  // 4.7 关闭语义 + 5. 自动开页面（P2-B5 迁入 src/host/services/，此处仅组装接线）：
  const closeToExitHandle = setupCloseToExit({
    getService: (name) => ctx.get(name),
    webServer: ctx.webServer,
    enabled: config.closeToExit !== false && process.env.DSH_LAUNCHER === '1',
    cfg,
    launcherDir,
    debounceSeconds, debounceMs, finalConfirmSeconds, finalConfirmMs,
    killExistingTrays,
    logMsg, logWarn,
  });
  if (!autoOpen || process.env.DSH_LAUNCHER !== '1') return;
  setupAutoOpen({
    getService: (name) => ctx.get(name),
    launcherDir,
    configPort: port,
    getClientsOnline: closeToExitHandle.getClientsOnline,
    logMsg,
  });
}
