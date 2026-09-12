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
      // 简单轮转：超过 1MB 归档为 .prev.log（覆盖上一代），防止 append 无限膨胀
      try {
        if (existsSync(logPath) && statSync(logPath).size > 1024 * 1024) {
          renameSync(logPath, logPath.replace(/\.log$/, '.prev.log'));
        }
      } catch {}
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
  return { logsDir, applySeq };
}

/** 保存链序号（config.set 每次保存递增，日志里 save#N 串联因果）。 */
export function nextSaveSeq(): number {
  saveSeq += 1;
  return saveSeq;
}
