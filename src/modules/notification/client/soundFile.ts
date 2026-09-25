/**
 * 音效文件上传的 client 侧纯函数：File → 上传载荷（base64）。
 *
 * 浏览器安全模型拿不到文件绝对路径（托盘播放需要路径），故走「上传副本」：
 * 本文件只做**发送前的预检与编码**——扩展名白名单与大小上限在此给用户即时反馈，
 * host 侧（io/soundFile.ts）会再校验一遍（两端校验，渲染进程输入不可信）。
 *
 * 零依赖红线：base64 编码手写（btoa 只吃 binary string，大文件必须分块——
 * 一次性 String.fromCharCode(...bytes) 在数 MB 时会栈溢出）。
 */
import type { SoundUploadResult } from './ports.ts'

/** 与 host 侧 MAX_SOUND_BYTES 一致（原始字节上限；预检用 file.size，免去白读大文件）。 */
export const MAX_SOUND_BYTES = 2 * 1024 * 1024

/** 允许的扩展名（与 host 白名单一致）。 */
const SOUND_EXTENSIONS = ['.wav', '.mp3', '.wma'] as const

/** 预检+编码结果：ok=true 时必带 name 与 dataBase64（可区分联合，调用方分流无歧义）。 */
export type SoundUploadPayload =
  | { readonly ok: true; readonly name: string; readonly dataBase64: string }
  | { readonly ok: false; readonly error: string }

/** 文件扩展名白名单判定（大小写不敏感；无扩展名拒绝）。 */
export function isAllowedSoundName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return false
  return (SOUND_EXTENSIONS as readonly string[]).includes(name.slice(dot).toLowerCase())
}

/**
 * 把用户选择的 File 编码成上传载荷。
 * @returns ok:true = 载荷；ok:false = 预检失败的用户可读原因。
 */
export async function fileToSoundUpload(file: File): Promise<SoundUploadPayload> {
  if (!isAllowedSoundName(file.name)) {
    return { ok: false, error: '仅支持 wav / mp3 / wma 音频文件' }
  }
  if (file.size > MAX_SOUND_BYTES) {
    return { ok: false, error: `文件超过 ${Math.floor(MAX_SOUND_BYTES / 1024 / 1024)} MB 上限` }
  }
  if (file.size === 0) {
    return { ok: false, error: '文件是空的' }
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  // 每 32KB 一块：Function.prototype.apply 的参数上限约 65535，32K 留足余量
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return { ok: true, name: file.name, dataBase64: btoa(binary) }
}
