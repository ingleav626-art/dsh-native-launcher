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
import { registerLauncherSettings } from './host/io/settings.ts';
import { writeOpenScript, writeLauncherFiles } from './host/io/scripts.ts';
import { ensureIcon, extractPngDataUrl } from './host/io/icon.ts';
import { createDesktopShortcut, ensureStartupShortcut, startupLnkPath } from './host/io/shortcut.ts';
import { findInstalledPwaAppId, registerPwaRoutes } from './host/io/pwa.ts';
import { TRAY_SCRIPT_VERSION, writeTrayScript, killExistingTrays, startTrayProcess } from './host/io/tray.ts';
import { setupCloseToExit } from './host/services/closeToExit.ts';
import { setupAutoOpen } from './host/services/autoOpen.ts';
import { registerRpcFallbackBridge } from './host/io/rpcBridge.ts';
import { setupLauncherRpc, type NotificationModuleHandle } from './host/services/launcherRpc.ts';
import { setupModules } from './host/services/modules.ts';
import type { HostCtx, LauncherConfig } from './host/types.ts';

export const name = 'native-launcher';
export const inject = ['webServer', 'connection', 'sessionProjections', 'settings'];

// 一键卸载后置标记（P2-B6-b 归位：uninstall case 经 deps.armExitCleanup 触发）——
// dsh 进程退出瞬间清掉残留的功能性生成文件（日志永久保留作为证据）
let pendingExitCleanup: string | null = null;
function armExitCleanup(dir: string) {
  pendingExitCleanup = dir;
  process.once('exit', () => {
    const target = pendingExitCleanup; pendingExitCleanup = null;
    if (!target) return;
    try {
      for (const name of ['launch.cmd', 'launcher.vbs', 'tray.ps1', 'open-webui.ps1', 'dsh-webui.ico', 'tray-pid.txt', 'tray-version.txt']) {
        const p = join(target, name);
        if (existsSync(p)) { try { unlinkSync(p); } catch { } }
      }
      try { appendFileSync(join(logsDirOf(target), 'uninstall.log'), `[${new Date().toISOString()}] [INFO ] dsh exited - post-exit artifact cleanup ran\r\n`); } catch { }
    } catch { }
  });
}

export function apply(ctx: HostCtx, config: LauncherConfig = {}) {
  try {
    applyInner(ctx, config);
  } catch (error) {
    logFail(`[launcher] apply failed (harness continues): ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
}

function applyInner(ctx: HostCtx, config: LauncherConfig = {}) {
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
  // 启动耗时埋点（v0.4.1 性能优化的数据来源）：各阶段日志带相对 apply 开始的毫秒数
  const applyT0 = Date.now();
  const elapsed = (): string => `+${Date.now() - applyT0}ms`;
  // rc.8 适配：官方 dsh web 默认自动打开浏览器（普通标签页），会与我们插件的
  // PWA 应用窗口打开形成双开——启动命令加 --no-open 让官方让位，由插件
  // （autoOpen → open-webui.ps1，PWA 应用优先）负责打开。
  // 版本门槛：--no-open 参数为 rc.8 起支持，旧版本检测到后日志提醒升级。
  const dshVersion = detectDshVersion();
  if (dshVersion && !dshVersionGte(dshVersion, '0.1.0-rc.8')) {
    logMsg(`WARNING: dsh ${dshVersion} is below 0.1.0-rc.8 — the launch command uses --no-open (rc.8+ only). Please upgrade: npm install -g @deepseek-ai/dsh@0.1.0-rc.8`);
  }
  logMsg(`dsh version: ${dshVersion || '(unknown)'}`);
  // 注册官方设置卡片（rc.7+）：resolved = schema 默认值 → patch base（cordis.patch.yml）→ 用户设置文档。
  // 合并结果作为本次生效配置；用户改设置后需重启 dsh 完全生效（脚本/托盘/快捷方式都在 apply 时生成）。
  // settingsScope 属主 = src/host/io/settings.ts（P2-B1 起收拢；RPC 的 config.get/set 经它读写）
  const { scope: settingsScope, cfg: resolvedCfg } = registerLauncherSettings(ctx, config, logMsg);
  logMsg(`timing: settings registered ${elapsed()}`);
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
  logEnvDiagnostics(launcherDir, config, logMsg);
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
    logMsg(`timing: pwa scan done ${elapsed()}`);
    writeOpenScript(launcherDir, port, openMode, shortcutName, pwaAppId);
    writeLauncherFiles(launcherDir, launchCommand, port, trayPath, openScriptPath);
    if (trayEnabled) writeTrayScript(launcherDir, port, join(launcherDir, 'dsh-webui.ico'), join(launcherDir, 'open-webui.ps1'), pwaAppId);
    logMsg(`timing: launcher scripts written ${elapsed()}`);
  } catch (error) {
    logMsg(`launcher script failed: ${error}`);
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
          writeFileSync(join(launcherDir, 'webui-url.txt'), `${authUrl}\n`);
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
      killExistingTrays, startTrayProcess, ensureStartupShortcut, startupLnkPath,
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
        const versionFile = join(launcherDir, 'tray-version.txt');
        let runningVersion = 0;
        try {
          runningVersion = parseInt(readFileSync(versionFile, 'utf-8').trim(), 10) || 0;
        } catch {
          // 无版本文件 = 旧托盘（未写版本）或未运行
        }
        // 先验证托盘进程是否真的在跑（version 文件可能是残留：进程已死但文件还在）
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
