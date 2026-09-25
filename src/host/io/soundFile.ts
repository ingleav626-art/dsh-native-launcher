/**
 * 通知音效副本文件（L2 副作用边界）：设置页「选择音效文件」上传内容的落盘属主。
 *
 * 浏览器拿不到本机绝对路径（`<input type="file">` 只给内容），而托盘播放需要路径——
 * 故产品形态 = 上传副本：client 读文件内容 → RPC 传 base64 → 本模块校验落盘为
 * `launcherDir/notify-sound.<ext>` 固定名 → 托盘播副本。附带收益：原文件移动/删除不影响音效。
 *
 * 单写者：本文件是副本文件唯一的写入/删除点（RPC 端点是唯一调用方）。
 * 形状不可信（上传来自渲染进程）：扩展名白名单、base64 严格校验、大小上限，全部在此把关。
 */
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 副本文件固定名（不含扩展名）。 */
export const NOTIFY_SOUND_BASENAME = 'notify-sound';
/** 允许的音效扩展名（与托盘 Play-NotifySound 的分流能力一致：wav=SoundPlayer，其余=MediaPlayer）。 */
export const NOTIFY_SOUND_EXTENSIONS = ['.wav', '.mp3', '.wma'] as const;
/** 原始大小上限：通知音效是短音频，2MB 绰绰有余；限制也是 RPC 大消息的自我保护（base64 再膨胀 4/3）。 */
export const MAX_SOUND_BYTES = 2 * 1024 * 1024;

/** 上传落盘结果（可区分联合：调用方按 ok 分流）。 */
export type SaveNotifySoundResult =
  | { readonly ok: true; readonly path: string; readonly bytes: number }
  | { readonly ok: false; readonly error: string }

/** 从用户文件名提取白名单扩展名；不在白名单返回 null（name 整体不可信，只取扩展名）。 */
export function notifySoundExtOf(name: string): (typeof NOTIFY_SOUND_EXTENSIONS)[number] | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot).toLowerCase();
  return (NOTIFY_SOUND_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as (typeof NOTIFY_SOUND_EXTENSIONS)[number])
    : null;
}

/** base64 严格校验（Buffer.from 对非法字符是宽松跳过——先显式拒绝再解码）。 */
function isStrictBase64(data: string): boolean {
  if (data.length === 0 || data.length % 4 !== 0) return false;
  const body = data.endsWith('==') ? data.slice(0, -2) : data.endsWith('=') ? data.slice(0, -1) : data;
  return /^[A-Za-z0-9+/]+$/.test(body);
}

/** base64 解码后的原始字节数（按 padding 修正；用于大小上限判断）。 */
export function base64ByteLength(data: string): number {
  if (!isStrictBase64(data)) return -1;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor(data.length / 4) * 3 - padding;
}

/**
 * 校验并把上传内容落盘为启动器目录下的音效副本。
 *
 * 写入前先清掉所有候选扩展名的旧副本（跨扩展名换音效不残留死文件）；
 * 清理失败不阻塞写入（旧副本被新副本顶掉是常态，残留只在跨扩展名 + 删除失败同现时发生）。
 */
export function saveNotifySound(launcherDir: string, name: string, dataBase64: string): SaveNotifySoundResult {
  const ext = notifySoundExtOf(name);
  if (ext === null) {
    return { ok: false, error: 'unsupported file type (only wav / mp3 / wma)' };
  }
  const bytes = base64ByteLength(dataBase64);
  if (bytes < 0) {
    return { ok: false, error: 'malformed base64 payload' };
  }
  if (bytes === 0) {
    return { ok: false, error: 'empty file' };
  }
  if (bytes > MAX_SOUND_BYTES) {
    return { ok: false, error: `file too large (max ${Math.floor(MAX_SOUND_BYTES / 1024 / 1024)} MB)` };
  }
  const target = join(launcherDir, NOTIFY_SOUND_BASENAME + ext);
  try {
    for (const candidate of NOTIFY_SOUND_EXTENSIONS) {
      try { unlinkSync(join(launcherDir, NOTIFY_SOUND_BASENAME + candidate)); } catch { /* 不存在即目标状态 */ }
    }
    writeFileSync(target, Buffer.from(dataBase64, 'base64'));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, path: target, bytes };
}
