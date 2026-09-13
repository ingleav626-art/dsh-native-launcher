/**
 * 启动器日志（L2 副作用边界，全项目日志唯一汇点——AGENTS.md「日志唯一汇点=落盘文件」）。
 *
 * 文件：`<launcherDir>/logs/native-launcher.log`（目录布局单一派生点 logsDirOf）。
 * 格式：[本地时间] [级别5] [域] 消息——域从消息前缀 [tag] 自动提取；
 * apply 启动打分隔线分块（beginApplyLog）；config.set 保存链带 save#N 序号串联因果（nextSaveSeq）。
 * 示例：[2026-08-26 14:32:28.101 +08:00] [INFO ] [settings] save#3 begin ...
 *
 * echo 进程 console 只为终端开发便利（launcher 流程里 dsh 的 stdout 被丢弃，不产生第二份文件）。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { logsDirOf } from '../core/paths.ts';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/** 日志文件路径（apply 时经 beginApplyLog 设置；未设置前只 echo 不落盘）。 */
let logPath: string | null = null;
/** apply 序号（分隔线分块用）。 */
let applySeq = 0;
/** config.set 保存链序号。 */
let saveSeq = 0;

/** 主日志上限（超过即归档为 .prev.log，保留两代）。 */
export const MAIN_LOG_MAX_BYTES = 1024 * 1024;
/**
 * 其余组件日志上限：比主日志更小——8 个日志各留两代时整包也只有几 MB，
 * 用户排错时把 `logs\` 整个发过来才现实（2026-09-13 用户质询"会不会无限堆积"）。
 */
export const COMPONENT_LOG_MAX_BYTES = 256 * 1024;

/**
 * 单个文件超限即归档为 `<name>.prev.log`（覆盖上一代，故单文件最多两代）。
 * 失败静默：运行中的托盘/脚本可能正占着文件，下次 apply 再试（同 migrateLegacyLogs 的策略）。
 */
function rotateIfTooLarge(file: string, maxBytes: number): boolean {
  try {
    if (!existsSync(file) || statSync(file).size <= maxBytes) return false;
    renameSync(file, file.replace(/\.log$/i, '.prev.log'));
    return true;
  } catch {
    return false;
  }
}

/**
 * 轮转 `logs/` 下所有组件日志（apply 时调用一次）。
 *
 * 为什么需要：主日志在 `logWrite` 里自带上限，但 `tray-exit.log` / `open-webui.log` /
 * `pwa-scan.log` / `dsh-boot.log` / `launch.log` / `uninstall.log` / `tray-notify.log`
 * 由各自进程按行 append，**谁都不管上限**（2026-09-13 实测：重度排查日一天 869 KB，无上限）。
 * 只认 `*.log`：`tray-notify.json` 与 `*.txt` 是状态文件且都在生成物根目录，不在此列。
 * @returns 本次被轮转的文件名（供调用方留痕）。
 */
export function rotateComponentLogs(logsDir: string): string[] {
  const rotated: string[] = [];
  try {
    for (const name of readdirSync(logsDir)) {
      if (!/\.log$/i.test(name) || /\.prev\.log$/i.test(name)) continue;
      const limit = name.toLowerCase() === 'native-launcher.log' ? MAIN_LOG_MAX_BYTES : COMPONENT_LOG_MAX_BYTES;
      if (rotateIfTooLarge(join(logsDir, name), limit)) rotated.push(name);
    }
  } catch {
    /* 读不到目录就算了：日志轮转不该拖累启动 */
  }
  return rotated;
}

function logWrite(level: LogLevel, msg: string): void {
  try {
    const d = new Date();
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    const tz = -d.getTimezoneOffset();
    const tzStr = `${tz >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(tz) / 60))}:${p(Math.abs(tz) % 60)}`;
    const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)} ${tzStr}`;
    const dm = /^\[([a-z0-9_-]+)\]\s?(.*)$/is.exec(msg);
    const domain = (dm ? dm[1] : 'launcher').padEnd(10);
    const text = dm ? dm[2] : msg;
    const line = `[${ts}] [${level.padEnd(5)}] [${domain}] ${text}`;
    // eslint-disable-next-line no-console
    console.error(line);
    if (logPath) {
      // 长会话自保：apply 之外（进程连续跑几天）主日志也可能涨过上限，写前顺手判一次
      rotateIfTooLarge(logPath, MAIN_LOG_MAX_BYTES);
      appendFileSync(logPath, line + '\r\n');
    }
  } catch {}
}

export function logMsg(msg: string): void { logWrite('INFO', msg); }
export function logWarn(msg: string): void { logWrite('WARN', msg); }
export function logFail(msg: string): void { logWrite('ERROR', msg); }

/**
 * 一次性迁移：把历史上写在生成物根目录的 `*.log` 挪进 `logs/`。
 * 为什么静默容错：运行中的托盘可能正占着 `tray-exit.log`，搬不动不能影响启动——
 * 失败就跳过，下次 apply 再试（托盘会因脚本版本变化重启，随即改写到新路径）。
 * 只搬 `*.log`：`tray-notify.json`（投递交接）与 `*.txt`（pid/版本/URL）是状态文件，留在根目录。
 */
export function migrateLegacyLogs(launcherDir: string, logsDir: string): void {
  try {
    for (const name of readdirSync(launcherDir)) {
      if (!/\.log$/i.test(name)) continue;
      const from = join(launcherDir, name);
      const to = join(logsDir, name);
      try {
        if (existsSync(to)) { unlinkSync(from); continue; }
        renameSync(from, to);
      } catch { /* 被占用：下次 apply 再试 */ }
    }
  } catch { /* 读不到目录就算了，日志系统不该拖累启动 */ }
}

/**
 * apply 启动时的日志初始化：建 logs 目录、迁移遗留日志、设置落盘路径、推进 apply 序号。
 * 返回 applySeq 供组装根打分隔线（文本与历史版本逐字一致）。
 */
export function beginApplyLog(launcherDir: string): { logsDir: string; applySeq: number } {
  const logsDir = logsDirOf(launcherDir);
  mkdirSync(logsDir, { recursive: true });
  migrateLegacyLogs(launcherDir, logsDir);
  logPath = join(logsDir, 'native-launcher.log');
  applySeq += 1;
  // 组件日志轮转：主日志自带上限，其余由各自进程 append 的日志没人管（见 rotateComponentLogs）。
  // 放在设置 logPath 之后：轮转留痕本身要写进（轮转后的）主日志。
  const rotated = rotateComponentLogs(logsDir);
  if (rotated.length > 0) logWrite('INFO', `[log] 轮转超限日志（各自归档为 .prev.log）：${rotated.join('、')}`);
  return { logsDir, applySeq };
}

/** 保存链序号（config.set 每次保存递增，日志里 save#N 串联因果）。 */
export function nextSaveSeq(): number {
  saveSeq += 1;
  return saveSeq;
}
