/**
 * 启动器设置页 RPC（L3 行为编排）：native-launcher 通道的全部 11 个端点。
 * 从 index.js 的 nativeLauncherRpcHandler 段原样搬入（P2-B6-b）——
 * 值防线/热应用逻辑/卸载五步/审计日志逐字保留，勿"顺手优化"。
 * 注册：主通道 connection.rpc.handle；官方 0.1.5-rc.x 回归（webServer without inject）时
 * 自动切兜底桥（registerBridge = io/rpcBridge 注入），官方修复后自动恢复。
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { LauncherConfig, LogFn, SettingsScopeLike } from '../types.ts'
import type { RpcHandler } from '../io/rpcBridge.ts';
import { logsDirOf } from '../core/paths.ts';

/** 通知模块句柄（4.5 装配后由组装根提供；RPC 端点经它转发）。 */
export interface NotificationModuleHandle {
  reportPending(raw: unknown): boolean
  reportPresence(raw: unknown): boolean
  testNotify(): boolean
  getSettings(): unknown
  updateSettings(patch: unknown): Promise<boolean>
}

/** 官方 connection 的主通道注册窄面。 */
export interface RpcConnectionFace {
  handle(channel: string, handler: RpcHandler, opts?: { authority: string }): void
}

export interface LauncherIo {
  nextSaveSeq(): number
  findInstalledPwaAppId(port: number, launcherDir: string): string | null
  writeOpenScript(launcherDir: string, port: number, openMode: string, shortcutName: string, pwaAppId: string | null): void
  writeLauncherFiles(launcherDir: string, launchCommand: string, port: number, trayPath: string | null, openScriptPath: string): void
  writeTrayScript(launcherDir: string, port: number, iconPath: string, openScriptPath: string | null, appId: string | null): void
  ensureIcon(launcherDir: string, logMsg: LogFn): string | null
  createDesktopShortcut(shortcutName: string, vbsPath: string, iconPath: string | null, force: boolean, launcherDir: string, logMsg: LogFn): void
  extractPngDataUrl(iconPath: string | null): string | null
  resolveDesktopPath(): string | null
  logsDirOf(launcherDir: string): string
  killExistingTrays(launcherDir: string, logMsg: LogFn): string
  startTrayProcess(launcherDir: string, trayPath: string, preferPersistent: boolean, logMsg: LogFn, logWarn: LogFn, logFail: LogFn): void
}

export interface LauncherRpcDeps {
  /** 主通道注册（官方 connection；缺省/抛错时走 registerBridge 兜底）。 */
  connection: RpcConnectionFace | undefined
  /** 兜底桥注入（io/rpcBridge 实例）。 */
  registerBridge: (channel: string, handler: RpcHandler) => void
  /** 官方服务取用窄面（uninstall 的 appExit）。 */
  getService: (name: string) => unknown
  settingsScope: SettingsScopeLike<LauncherConfig> | null
  /** apply 入参快照（patch base）。 */
  config: LauncherConfig
  launcherDir: string
  vbsPath: string
  iconPath: string | null
  shortcutName: string
  port: number
  launchCommand: string
  openMode: string
  /** 通知模块 getter——4.5 装配晚于 RPC 注册，必须经 getter 取最新句柄。 */
  getNotificationModule: () => NotificationModuleHandle | null
  /** 卸载 exit hook（pendingExitCleanup 属主在本体组装侧）。 */
  armExitCleanup: (dir: string) => void
  io: LauncherIo
  logMsg: LogFn
  logWarn: LogFn
  logFail: LogFn
}

export function setupLauncherRpc(deps: LauncherRpcDeps): void {
  const { launcherDir, logMsg, logWarn, logFail, io } = deps;
  const nativeLauncherRpcHandler = async (endpoint: string, _payload: unknown) => {
        switch (endpoint) {
          case 'config.get': {
            // 实时读官方设置文档（而非 apply 时快照）：否则保存多次后配置页回显旧值，
            // 下次点保存还会把新配置覆盖回旧值（数据回退）
            const live = deps.settingsScope ? { ...deps.config, ...deps.settingsScope.get() } : deps.config;
            return {
              ok: true,
              value: {
                launchCommand: live.launchCommand ?? 'dsh --profile web --no-open',
                shortcutName: live.shortcutName ?? 'DSH WebUI',
                autoOpen: live.autoOpen !== false,
                force: live.force === true,
                port: live.port ?? 3080,
                tray: live.tray !== false,
                trayNotify: live.trayNotify !== false,
                traySurvivesDsh: live.traySurvivesDsh !== false,
                openMode: live.openMode ?? 'app',
                closeToExit: live.closeToExit !== false,
                closeToExitDebounceSeconds: Math.max(5, Number(live.closeToExitDebounceSeconds ?? 20) || 20),
                closeToExitFinalConfirmSeconds: Math.max(1, Number(live.closeToExitFinalConfirmSeconds ?? 2) || 2),
                modules: live.modules ?? {},
                settingsAvailable: !!deps.settingsScope,
                launcherDir,
                vbsPath: deps.vbsPath,
                iconPath: deps.iconPath,
                shortcutExists: existsSync(join(io.resolveDesktopPath() ?? '', `${live.shortcutName ?? deps.shortcutName}.lnk`)),
              },
            };
          }
          case 'config.set': {
            // 设置页表单保存：写入官方 settings 用户文档（持久化），重启后完全生效
            if (!deps.settingsScope) { logFail('[settings] config.set rejected: settings service unavailable'); return { ok: false, error: { code: 'config', message: 'settings service unavailable', details: {} } }; };
            try {
              const seq = `save#${io.nextSaveSeq()}`;
              const payload = _payload as { values?: Record<string, unknown> } | null;
              const values = (payload && payload.values) ?? {};
              logMsg(`[settings] ${seq} begin, raw values: ${JSON.stringify(values)}`);
              const patch: Record<string, unknown> = {};
              // 值防线：所有字段钳制/过滤后再入库——非法值绝不能动摇 apply（根基）。
              // 空串一律不写 patch（保留原值），避免 undefined 混进 settings 文档。
              if (values.launchCommand !== undefined) {
                const lc = String(values.launchCommand).trim();
                if (lc) patch.launchCommand = lc;
              }
              if (values.shortcutName !== undefined) {
                // 过滤 Windows 文件名非法字符（快捷方式是 .lnk 文件）
                const sn = String(values.shortcutName).trim().replace(/[\\/:*?"<>|]/g, '_');
                if (sn) patch.shortcutName = sn.slice(0, 80);
              }
              if (values.port !== undefined) patch.port = Math.min(65535, Math.max(1, Math.floor(Number(values.port) || 3080)));
              if (values.autoOpen !== undefined) patch.autoOpen = !!values.autoOpen;
              if (values.tray !== undefined) patch.tray = !!values.tray;
              if (values.trayNotify !== undefined) patch.trayNotify = !!values.trayNotify;
              if (values.closeToExit !== undefined) patch.closeToExit = !!values.closeToExit;
              // 上限 3600s：setTimeout delay 超 2^31-1 ms 会立即触发（等于关窗秒退），必须封顶
              if (values.closeToExitDebounceSeconds !== undefined) patch.closeToExitDebounceSeconds = Math.min(3600, Math.max(5, Math.floor(Number(values.closeToExitDebounceSeconds) || 20)));
              if (values.closeToExitFinalConfirmSeconds !== undefined) patch.closeToExitFinalConfirmSeconds = Math.min(60, Math.max(1, Math.floor(Number(values.closeToExitFinalConfirmSeconds) || 2)));
              if (values.openMode !== undefined) patch.openMode = ['app', 'new-window', 'default'].includes(values.openMode as string) ? values.openMode : 'app';
              if (values.force !== undefined) patch.force = !!values.force;
              if (values.traySurvivesDsh !== undefined) patch.traySurvivesDsh = !!values.traySurvivesDsh;
              if (values.modules && typeof values.modules === 'object') {
                patch.modules = { notifications: (values.modules as { notifications?: unknown }).notifications !== false };
              }
              deps.settingsScope.update(patch as Partial<LauncherConfig>);
              // 只对「值真正变化」的字段做后续动作——表单是全量提交，未改动的键不能触发托盘重启等副作用
              const prevValues = deps.settingsScope.get() ?? {};
              const changedKeys = Object.keys(patch).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify((prevValues as Record<string, unknown>)[k]));
              if (changedKeys.length === 0) {
                logMsg(`[settings] ${seq} no actual change, nothing to apply`);
                return { ok: true, value: { message: '配置无变化，无需保存' } };
              }
              logMsg(`[settings] ${seq} validated patch (changed: [${changedKeys.join(', ')}]): ${JSON.stringify(patch)}`);
              // 即时生效（生成物类）：用合并后的新配置重建 launch.cmd/vbs/tray.ps1/open-webui.ps1/快捷方式；
              // 若托盘相关字段变更，顺带热重启托盘进程（新机制/新端口立即生效）。
              let restartHint = '已保存 — 重启 dsh（双击桌面快捷方式）后完全生效';
              try {
                // 注意：scope.update() 是异步提交（write queue），立刻 get() 会拿到旧 resolved——
                // 必须把刚校验过的 patch 显式盖在最顶层，保证本次热应用用的一定是新值。
                const fresh = { ...deps.config, ...deps.settingsScope.get(), ...patch };
                const fPort = fresh.port ?? deps.port;
                const fShortcutName = fresh.shortcutName ?? deps.shortcutName;
                const fOpenMode = fresh.openMode ?? deps.openMode;
                const fTrayEnabled = fresh.tray !== false;
                const fSurvives = fresh.traySurvivesDsh !== false;
                logMsg(`[settings] ${seq} hot-apply with merged config (port=${fPort}, shortcutName=${JSON.stringify(fShortcutName)}, openMode=${fOpenMode}, tray=${fTrayEnabled}, traySurvivesDsh=${fSurvives})`);
                const pwaId = io.findInstalledPwaAppId(fPort, launcherDir);
                mkdirSync(launcherDir, { recursive: true });
                io.writeOpenScript(launcherDir, fPort, String(fOpenMode), fShortcutName, pwaId);
                io.writeLauncherFiles(launcherDir, fresh.launchCommand ?? deps.launchCommand, fPort, fTrayEnabled ? join(launcherDir, 'tray.ps1') : null, join(launcherDir, 'open-webui.ps1'));
                if (fTrayEnabled) io.writeTrayScript(launcherDir, fPort, join(launcherDir, 'dsh-webui.ico'), join(launcherDir, 'open-webui.ps1'), pwaId);
                // 改名场景：快捷方式按文件名存在，必须删掉旧名 .lnk，否则桌面双图标残留
                // 旧名以 settings 文档里的上一个值为准（不是 apply 快照——两者可能不一致）
                if (changedKeys.includes('shortcutName')) {
                  const oldName = String((prevValues as Record<string, unknown>).shortcutName ?? '').trim();
                  if (oldName && oldName !== fShortcutName) {
                    const oldLnk = join(io.resolveDesktopPath() ?? '', `${oldName}.lnk`);
                    if (existsSync(oldLnk)) {
                      try { unlinkSync(oldLnk); logMsg(`[settings] ${seq} removed renamed-away shortcut: ${oldLnk}`); } catch (e) { logWarn(`[settings] ${seq} failed to remove old shortcut ${oldLnk}: ${e}`); }
                    }
                  }
                }
                io.createDesktopShortcut(fShortcutName, deps.vbsPath, io.ensureIcon(launcherDir, logMsg), false, launcherDir, logMsg);
                logMsg(`[settings] ${seq} hot-apply: artifacts regenerated ok`);
                const TRAY_RELATED = ['tray', 'traySurvivesDsh', 'port', 'openMode'];
                const trayChanged = changedKeys.filter(k => TRAY_RELATED.includes(k));
                if (trayChanged.length > 0) {
                  logMsg(`[settings] ${seq} tray-affecting fields changed [${trayChanged.join(', ')}] -> restarting tray (survives=${fSurvives})`);
                  io.killExistingTrays(launcherDir, logMsg);
                  if (fTrayEnabled) io.startTrayProcess(launcherDir, join(launcherDir, 'tray.ps1'), fSurvives, logMsg, logWarn, logFail);
                  else logMsg('[settings] tray disabled by config, not respawning');
                  restartHint = '已保存并即时应用（托盘已按新配置重启）— 关闭语义等运行参数仍建议重启一次';
                } else {
                  logMsg(`[settings] ${seq} no tray-affecting change, skip tray restart`);
                }
              } catch (error) {
                logFail(`[settings] ${seq} hot-apply FAILED after save (config persisted, restart dsh to recover): ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
                restartHint = '已保存，但自动应用失败——重启 dsh 即可恢复一致';
              }
              return { ok: true, value: { message: restartHint } };
            } catch (error) {
              logFail(`[settings] config.set failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
              return { ok: false, error: { code: 'config', message: String((error as { message?: string }).message ?? error), details: {} } };
            }
          }
          case 'shortcut.recreate': {
            // 用实时配置（非 apply 时快照）：改名/改端口保存后立即点此按钮，行为应与最新配置一致
            const liveName = deps.settingsScope ? (deps.settingsScope.get().shortcutName ?? deps.shortcutName) : deps.shortcutName;
            io.createDesktopShortcut(liveName, deps.vbsPath, deps.iconPath, true, launcherDir, logMsg);
            const lnk = join(io.resolveDesktopPath() ?? '', `${liveName}.lnk`);
            return { ok: true, value: { message: `shortcut recreated: ${lnk}`, shortcutExists: existsSync(lnk) } };
          }
          case 'icon.get': {
            const dataUrl = io.extractPngDataUrl(deps.iconPath);
            return dataUrl
              ? { ok: true, value: { dataUrl } }
              : { ok: false, error: { code: 'icon', message: 'icon extract failed', details: {} } };
          }
          case 'ntf-log':
            // 通知诊断上报（client 决策链）：写 native-launcher.log，不污染浏览器 console
            logMsg(`[ntf] ${JSON.stringify(_payload ?? {})}`);
            return { ok: true };
          case 'diagnostics.openLogs': {
            // 排错入口：在资源管理器里打开**日志目录**（`logs/`）——所有日志都在这里，
            // 用户把整个文件夹拖给维护者即可，不必判断该看哪个文件（根目录只留脚本与状态文件）。
            const logDir = io.logsDirOf(launcherDir);
            try {
              mkdirSync(logDir, { recursive: true });
              spawn('explorer.exe', [logDir], { detached: true, stdio: 'ignore' }).unref();
              logMsg(`[diagnostics] 已打开日志目录：${logDir}`);
              return { ok: true, value: { path: logDir } };
            } catch (error) {
              logFail(`[diagnostics] 打开日志目录失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
              return { ok: false, error: { code: 'diagnostics', message: String(error), details: {} } };
            }
          }
          case 'presence-report': {
            // UI 存在态上报（client 薄传感器）：页面是否在前台 + 正在看哪个会话。
            // 这是 `backgroundOnly`（"任务不在眼前才通知"）的判定输入——只有浏览器知道，host 看不到。
            const mod = deps.getNotificationModule();
            if (!mod) return { ok: false, error: { code: 'presence', message: 'notification module not loaded', details: {} } };
            const presenceAccepted = mod.reportPresence(_payload ?? {});
            return presenceAccepted
              ? { ok: true }
              : { ok: false, error: { code: 'presence', message: 'report rejected (invalid shape)', details: {} } };
          }
          case 'notification.test': {
            // 测试通知（设置卡片「发送测试通知」按钮）：走模块的真实投递端，
            // 一次点击验证「模块 → 投递端 → tray-notify.json → 托盘进程 → 系统 Toast」整条链
            const mod = deps.getNotificationModule();
            if (!mod) return { ok: false, error: { code: 'notification', message: 'notification module not loaded', details: {} } };
            return mod.testNotify()
              ? { ok: true }
              : { ok: false, error: { code: 'notification', message: 'test notify delivery failed', details: {} } };
          }
          case 'launcher.uninstall': {
            // 一键卸载（dev-notes 一·七 阶段 3）：停托盘 → 删快捷方式 → 清生成物 → 删 AUMID 注册表
            //   → profile 自移除（改 package.json：dependencies + dsh.profile.bundles）。
            // 运行时自杀是安全的：JS 已加载进内存，删条目/目录不影响当前进程；重启后彻底干净。
            // link: 开发安装绝不删除目标目录（那是维护者的 git 工作区），只断开 profile 链接。
            // 独立审计日志：uninstall.log 不在任何清理清单里——卸载失败时它就是唯一的完整证据。
            const ULOG = join(io.logsDirOf(launcherDir), 'uninstall.log');
            const logU = (level: string, msg: string) => {
              try {
                const d = new Date();
                const p = (n: number, w = 2) => String(n).padStart(w, '0');
                const line = `[${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}] [${level.padEnd(5)}] ${msg}`;
                appendFileSync(ULOG, line + '\r\n');
                logMsg(`[uninstall] ${msg}`);
              } catch { }
            };
            const steps: string[] = [];
            const manual: string[] = [];
            const addStep = (msg: string) => { steps.push(msg); logU('INFO', msg); };
            const addFail = (msg: string) => { steps.push(msg); logU('ERROR', msg); };
            const manualAdd = (msg: string) => { manual.push(msg); logU('MANUAL', msg); };
            const payload = _payload as { clearSettings?: unknown; stopAfter?: unknown } | null;
            const clearSettings = !!(payload && payload.clearSettings);
            // 卸载语义包含停止服务：默认 true（6s 后官方优雅退出）；stopAfter=false 仅供特殊调试
            const stopAfter = !(payload && payload.stopAfter === false);
            logU('INFO', `════ uninstall session start (dsh pid=${process.pid}, launcherDir=${launcherDir}, clearSettings=${clearSettings}, stopAfter=${stopAfter}) ════`);
            // STEP 0（可选）：彻底重置——清空本 ns 的用户设置段，配置回落 base+默认。
            // 官方定义的重置路径：scope.replace({})（"removal/reset path a merge-only
            // patch cannot express"）。默认不勾选；勾选后重装=全新默认配置。
            if (clearSettings && deps.settingsScope?.replace) {
              try {
                await deps.settingsScope.replace({});
                addStep('已清除本插件的全部个性化配置（settings.yaml 中 native-launcher 段已重置）');
                logU('INFO', 'STEP 0/5 settings-reset: user section replaced with {} - reverts to base/defaults');
              } catch (error) {
                addFail(`清除配置失败（不影响卸载本身）: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
                manualAdd('个性化配置自动清除失败——如需重置，手动编辑 E:\\dsh\\settings.yaml 删除 native-launcher 段');
              }
            } else if (!deps.settingsScope) {
              logWarn('[uninstall] settingsScope unavailable, cannot honor clearSettings');
            }
            logU('INFO', 'STEP 1/5 tray-kill: begin');
            try {
              // 1) 停托盘进程（含其子进程）
              const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
                "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'tray\\.ps1' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F 2>$null | Out-Null; $_.ProcessId }"],
                { encoding: 'utf8', windowsHide: true });
              const killed = String(ps.stdout ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
              addStep(killed.length ? `已停止托盘进程: PID ${killed.join(', ')}` : '没有运行中的托盘进程');
              logU('INFO', `STEP 1/5 tray-kill: taskkill exit=${ps.status}, pids=[${killed.join(',')}]${ps.stderr ? `, stderr=${String(ps.stderr).trim().slice(0, 200)}` : ''}`);
            } catch (error) {
              addFail(`停止托盘失败（继续）: ${error}`);
            }
            try {
              // 2) 删除桌面快捷方式——定点清除：只删「登记文件里记录的」+「当前配置名对应的」lnk。
              //    绝不全盘扫描桌面（误删比不删恐怖）；登记文件由 createDesktopShortcut 成功时写入。
              const desktop = io.resolveDesktopPath() ?? '';
              const targets = new Set<string>();
              const regFile = join(launcherDir, 'shortcut-registry.txt');
              try {
                if (existsSync(regFile)) {
                  for (const line of readFileSync(regFile, 'utf-8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)) targets.add(line);
                }
              } catch { }
              // 实时权威名（settings 文档）优先，启动快照名兜底——两者都纳入定点清除
              const liveCfgU = deps.settingsScope ? (deps.settingsScope.get() ?? {}) : {};
              const liveShortcutName = String((liveCfgU as LauncherConfig).shortcutName || '').trim() || deps.shortcutName;
              if (desktop) targets.add(join(desktop, `${liveShortcutName}.lnk`));
              let removedLnk = 0;
              const failedLnks: string[] = [];
              for (const t of targets) {
                if (!t || !existsSync(t)) continue;
                try { unlinkSync(t); removedLnk++; logU('INFO', `STEP 2/5 removed: ${t}`); } catch (e) {
                  failedLnks.push(t);
                  const code = (e as { code?: string }).code ?? '?';
                  const busy = code === 'EBUSY';
                  logU('ERROR', `STEP 2/5 shortcut delete FAILED: ${t} code=${code} :: ${(e as Error)?.message ?? e}${busy ? ' (hint: file locked - retry after restarting explorer)' : ''}`);
                }
              }
              addStep(removedLnk > 0 ? `已删除 ${removedLnk} 个桌面快捷方式${failedLnks.length ? `（${failedLnks.length} 个失败，详见 uninstall.log）` : ''}` : '桌面无本插件快捷方式（跳过）');
              logU('INFO', `STEP 2/5 shortcut removal summary: removed=${removedLnk}, failed=${failedLnks.length}, candidates=[${Array.from(targets).join(' ; ')}]`);
            } catch (error) {
              addFail(`删除快捷方式失败（继续）: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            }
            try {
              // 3) 清理生成物与日志（目录保留：插件仍在运行，避免日志写入报错）
              logU('INFO', 'STEP 3/5 artifacts: begin (uninstall.log is exempt from this list)');
              // 日志统一在 logs/ 子目录（用户排错时整包发这一个文件夹），脚本与状态文件在根目录
              const artifacts = ['launch.cmd', 'launcher.vbs', 'tray.ps1', 'open-webui.ps1', 'dsh-webui.ico',
                join('logs', 'native-launcher.log'), join('logs', 'native-launcher.prev.log'),
                join('logs', 'launch.log'), join('logs', 'tray-exit.log'), join('logs', 'tray-notify.log'),
                join('logs', 'pwa-scan.log'), join('logs', 'open-webui.log'), join('logs', 'test-results.log'),
                'tray-notify.json', 'tray-version.txt'];
              let removed = 0;
              const failedFiles: string[] = [];
              for (const name of artifacts) {
                const p = join(launcherDir, name);
                if (!existsSync(p)) continue;
                try { unlinkSync(p); removed++; } catch (e) {
                  failedFiles.push(name);
                  // 失败原因分级：EBUSY/EPERM = 被占用/权限，附可行动提示
                  const code = (e as { code?: string }).code ?? '?';
                  const hint = code === 'EBUSY' ? 'file locked by a running process - will be removable after dsh restarts'
                    : code === 'EPERM' || code === 'EACCES' ? 'permission denied - check file attributes/ACL'
                    : code === 'ENOENT' ? 'already gone'
                    : 'unexpected error';
                  logU('ERROR', `STEP 3/5 artifact delete FAILED: ${name} code=${code} syscall=${(e as { syscall?: string }).syscall ?? '-'} :: ${(e as Error)?.message ?? e} (hint: ${hint})`);
                }
              }
              addStep(failedFiles.length ? `已清理生成物 ${removed} 个文件，${failedFiles.length} 个失败（${failedFiles.join(', ')}，详见 uninstall.log）` : `已清理生成物 ${removed} 个文件`);
              logU('INFO', `STEP 3/5 artifacts summary: removed=${removed}, failed=[${failedFiles.join(', ') || 'none'}]`);
            } catch (error) {
              addFail(`清理生成物失败（继续）: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            }
            try {
              // 4) 删除 AUMID 注册表键（Toast 通知身份）
              logU('INFO', 'STEP 4/5 registry: reg delete HKCU\\...\\AppUserModelId\\DshNativeLauncher');
              const reg = spawnSync('reg.exe', ['delete', 'HKCU\\Software\\Classes\\AppUserModelId\\DshNativeLauncher', '/f'], { encoding: 'utf8', windowsHide: true });
              const regOut = String((reg.stdout ?? '') + ' ' + (reg.stderr ?? '')).trim();
              if (reg.status === 0) {
                addStep('已删除通知标识注册表项 (AUMID DshNativeLauncher)');
                logU('INFO', `STEP 4/5 registry: deleted${regOut ? ' :: ' + regOut.slice(0, 200) : ''}`);
              } else if (/unable to find/i.test(regOut)) {
                addStep('通知注册表项不存在（跳过）');
                logU('INFO', `STEP 4/5 registry: key absent, skip`);
              } else {
                addStep(`注册表删除退出码 ${reg.status}（详见 uninstall.log）`);
                logU('ERROR', `STEP 4/5 registry FAILED: exit=${reg.status} output=${regOut.slice(0, 300)} (hint: access denied means run dsh as the same user that created the key)`);
              }
            } catch (error) {
              addFail(`清理注册表失败（继续）: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            }
            try {
              // 5) profile 自移除：扫描 $DSH_HOME/profiles/*/package.json，摘除 dependencies 条目
              //    与 dsh.profile.bundles 数组项（先备份原文件）。link 安装保留目标目录。
              logU('INFO', 'STEP 5/5 profile-edit: scanning profiles for dsh-native-launcher entries');
              const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh');
              const profilesRoot = join(home, 'profiles');
              let touched = false;
              if (existsSync(profilesRoot)) {
                for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
                  if (!entry.isDirectory()) continue;
                  const pkgPath = join(profilesRoot, entry.name, 'package.json');
                  if (!existsSync(pkgPath)) continue;
                  let pkg: { dependencies?: Record<string, string>; dsh?: { profile?: { bundles?: string[] } } };
                  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { continue; }
                  const depsMap = pkg.dependencies ?? {};
                  const spec = depsMap['dsh-native-launcher'];
                  if (!spec) continue;
                  // 备份后改写：dependencies 摘除 + bundles 过滤
                  copyFileSync(pkgPath, `${pkgPath}.before-uninstall`);
                  logU('INFO', `STEP 5/5 profile-edit: backup written to ${pkgPath}.before-uninstall`);
                  delete depsMap['dsh-native-launcher'];
                  if (Array.isArray(pkg.dsh?.profile?.bundles)) {
                    pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter(b => b !== 'dsh-native-launcher');
                  }
                  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
                  touched = true;
                  logU('INFO', `STEP 5/5 profile-edit: "${entry.name}" package.json rewritten (deps entry + bundles filtered)`);
                  addStep(`已从 profile "${entry.name}" 移除插件条目（备份: package.json.before-uninstall）`);
                  if (String(spec).startsWith('link:')) {
                    addStep('检测到开发链接安装（link:），插件源码目录已保留未删除');
                    logU('INFO', 'link-install detected: source directory preserved (never deleted)');
                  }
                  // 断开 node_modules 链接（pnpm/link symlink 只删链接本身）
                  const linkPath = join(profilesRoot, entry.name, 'node_modules', 'dsh-native-launcher');
                  if (existsSync(linkPath)) {
                    try { unlinkSync(linkPath); steps.push('已断开 node_modules 插件链接'); } catch (e) {
                      manual.push(`未能移除 ${linkPath}（可手动删除或在该 profile 目录执行包管理器安装命令清理）: ${e}`);
                    }
                  }
                }
              }
              if (!touched) manual.push('未在 $DSH_HOME/profiles 找到本插件的安装条目——若装在其他 profile，请手动从其 package.json 移除 "dsh-native-launcher"');
            } catch (error) {
              manual.push('自动移除 profile 条目失败，请手动编辑 profiles/<name>/package.json 删除 "dsh-native-launcher"（dependencies 与 dsh.profile.bundles 两处）: ' + error);
            }
            // lockfile 一致性：只检测+报告，绝不自动跑包管理器——
            // 其他机器的 pnpm/npm/corepack/网络/workspace 配置千差万别，自动 install 风险大于收益
            try {
              const home2 = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh');
              const profilesRoot2 = join(home2, 'profiles');
              if (existsSync(profilesRoot2)) {
                for (const entry of readdirSync(profilesRoot2, { withFileTypes: true })) {
                  if (!entry.isDirectory()) continue;
                  const dir = join(profilesRoot2, entry.name);
                  const pkgPath = join(dir, 'package.json');
                  try {
                    if (!existsSync(pkgPath)) continue;
                    const rawPkg = readFileSync(pkgPath, 'utf-8');
                    if (!rawPkg.includes('"dsh-native-launcher"') && !existsSync(join(dir, 'node_modules', 'dsh-native-launcher'))) continue;
                    for (const lf of ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']) {
                      if (existsSync(join(dir, lf))) {
                        manual.push(`profile "${entry.name}" 的 ${lf} 仍含本插件条目（我们绝不自动改动你的包管理文件）——重启若报依赖错误，请在该目录自行执行一次安装命令即可修正`);
                        break;
                      }
                    }
                  } catch { /* 单个 profile 异常不影响整体 */ }
                }
              }
            } catch { /* 检测失败不阻塞卸载 */ }
            manualAdd('如安装过 PWA 应用：浏览器 edge://apps 中手动卸载"DSH WebUI"');
            manualAdd('范围说明：本次卸载仅移除桌面化增强组件，dsh 服务本身与数据不受影响。如需连 dsh 一起移除：npm uninstall -g @deepseek-ai/dsh（会话与设置等个人数据请先自行备份）');
            // 进程退出时的收尾：只删「已知的功能性生成物」，日志全部保留作为证据——
            // 运行期间写不掉的文件（native-launcher.log / tray-pid.txt / tray-version.txt）此刻已无主，可安全清除
            deps.armExitCleanup(launcherDir);
            manual.push('重启 dsh 后卸载完全生效（启动器不会再生成任何内容）；诊断日志保留在 .dsh-webui-launcher\\logs\\uninstall.log 供排查，确认无误后可手动删除整个目录');
            logU('INFO', 'exit hook armed: functional artifacts will be removed when dsh stops; uninstall.log preserved');
            // 卸载语义包含停止服务：延迟 6s 执行官方优雅退出——给前端渲染报告的时间；
            // exit hook（清残留生成物）会在进程退出时自动衔接，无需用户再找工具强杀
            if (stopAfter) {
              setTimeout(() => {
                try {
                  logU('INFO', 'auto-stop: calling appExit(0)');
                  const appExit = deps.getService('appExit');
                  if (typeof appExit === 'function') { (appExit as (c: number) => void)(0); logU('INFO', 'auto-stop: appExit(0) issued'); }
                  else logFail('[uninstall] auto-stop failed: appExit service unavailable');
                } catch (e) {
                  logFail(`[uninstall] auto-stop failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
                }
              }, 6000);
              addStep('dsh 服务将在约 6 秒后自动停止（托盘已先行停止）');
            }
            logU('INFO', `════ uninstall session end — steps=${steps.length}, manual=${manual.length} ════`);
            logMsg(`[uninstall] done: ${steps.join(' | ')}`);
            return { ok: true, value: { steps, manual } };
          }
          case 'pending-report': {
            // client 传感器上报「会话正在等待什么」：question / plan-review 是 Host waterfall
            // 派给 client 的活内存态，host 侧不可观测（REFACTOR_PLAN P1·X 实验 3 实证）——
            // 故保留薄 client 传感器（方案 2）：client 只上报，决策与投递全在 host。
            const mod = deps.getNotificationModule();
            if (!mod) return { ok: false, error: { code: 'pending', message: 'notification module not loaded', details: {} } };
            const accepted = mod.reportPending(_payload ?? {});
            return accepted
              ? { ok: true }
              : { ok: false, error: { code: 'pending', message: 'report rejected (invalid shape)', details: {} } };
          }
          case 'notification.get': {
            // 通知设置回显（设置卡片用）：读模块自有 namespace（dsh-native-notification）
            const mod = deps.getNotificationModule();
            if (!mod) return { ok: false, error: { code: 'notification', message: 'notification module not loaded', details: {} } };
            const notificationSettings = mod.getSettings();
            return notificationSettings === undefined
              ? { ok: false, error: { code: 'notification', message: 'settings not ready', details: {} } }
              : { ok: true, value: notificationSettings };
          }
          case 'notification.set': {
            // 通知设置写入：规则校验在模块内（host 侧把关），非法规则拒绝落库
            const mod = deps.getNotificationModule();
            if (!mod) return { ok: false, error: { code: 'notification', message: 'notification module not loaded', details: {} } };
            const notificationPatch = ((_payload as { patch?: unknown } | null) && (_payload as { patch?: unknown }).patch) || {};
            const notificationApplied = await mod.updateSettings(notificationPatch);
            return notificationApplied
              ? { ok: true }
              : { ok: false, error: { code: 'notification', message: 'update rejected (invalid rules or settings unavailable)', details: {} } };
          }
          default:
            return { ok: false, error: { code: 'unknown', message: `unknown endpoint: ${endpoint}`, details: {} } };
        }
  };
  try {
    // connection 缺失时 .handle 取属性即抛 → 下方 catch 切兜底桥（与原 JS 行为一致）
    deps.connection!.handle('/native-launcher', nativeLauncherRpcHandler, { authority: 'trusted-host' });
    logMsg('[rpc] /native-launcher registered via connection.rpc.handle');
  } catch (error) {
    // 插值不含嵌套花括号（log-inventory 归一化按第一个 } 截断）——error 提取放 catch 首行
    const rpcErr = error as { message?: string };
    logMsg(`[rpc] connection.rpc.handle failed: ${rpcErr?.message ?? error} — activating webServer bridge fallback`);
    deps.registerBridge('/native-launcher', nativeLauncherRpcHandler);
  }
}
