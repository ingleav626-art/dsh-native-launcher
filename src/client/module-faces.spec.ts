/**
 * `parseSoundUploadResponse` 单测：音效上传 RPC 响应壳的解析契约。
 *
 * 抓的 bug（2026-09-25 真机实证）：曾误在响应顶层找 path——host 返回的是
 * `{ ok, value: { path } }` 响应壳，host 明明成功（uploaded 日志在案）却被判为拒绝，
 * 连锁跳过 load() 回读 → 设置卡片不显示已选文件名。失败时 error 是
 * `{ code, message, details }` 对象，message 才是用户可读原因。
 */
import { describe, expect, it } from 'vitest'
import { parseSoundUploadResponse } from './module-faces.ts'

describe('parseSoundUploadResponse（音效上传响应壳解析）', () => {
  it('成功壳：{ ok, value: { path, bytes } } → ok:true 且带 path', () => {
    expect(
      parseSoundUploadResponse({ ok: true, value: { path: 'C:\\dir\\notify-sound.wav', bytes: 75014 } }),
    ).toEqual({ ok: true, path: 'C:\\dir\\notify-sound.wav' })
  })

  it('失败壳：error.message 提取为用户可读原因', () => {
    expect(
      parseSoundUploadResponse({ ok: false, error: { code: 'sound', message: 'file too large (max 2 MB)', details: {} } }),
    ).toEqual({ ok: false, error: 'file too large (max 2 MB)' })
  })

  it('error 非对象 / 无 message：给通用兜底文案（不崩、不显示 undefined）', () => {
    for (const bad of [
      { ok: false, error: '字符串错误（旧形状防御）' },
      { ok: false, error: { code: 'sound' } },
      { ok: false },
    ]) {
      const result = parseSoundUploadResponse(bad)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe('host 拒绝了这次上传')
    }
  })

  it('成功壳缺 value.path：按失败处理（形状不可信）', () => {
    const result = parseSoundUploadResponse({ ok: true, value: {} })
    expect(result.ok).toBe(false)
  })

  it('空响应 / 非对象：ok:false 且给空响应文案', () => {
    for (const bad of [undefined, null, 42, 'ok']) {
      const result = parseSoundUploadResponse(bad)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe('host 返回了空响应')
    }
  })
})
