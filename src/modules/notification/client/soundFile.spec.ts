/**
 * 音效上传预检（client 侧纯函数）单测：扩展名预检 / 大小上限 / base64 分块编码正确性。
 *
 * 抓的 bug 面：分块编码是手写的（零依赖红线）——块边界（32KB 整倍数处）切错一个字节
 * 都会产生错位 base64；大文件一次性 fromCharCode 会栈溢出，必须走分块路径才有意义。
 * File 与 btoa 在 Node 20+ 均为全局（测试环境与浏览器同构），无需 polyfill。
 */
import { describe, expect, it } from 'vitest'
import { MAX_SOUND_BYTES, fileToSoundUpload, isAllowedSoundName } from './soundFile.ts'

describe('isAllowedSoundName（扩展名预检）', () => {
  it('白名单内通过（大小写不敏感）', () => {
    expect(isAllowedSoundName('ding.wav')).toBe(true)
    expect(isAllowedSoundName('DING.WAV')).toBe(true)
    expect(isAllowedSoundName('ringtone.Mp3')).toBe(true)
    expect(isAllowedSoundName('bell.wma')).toBe(true)
  })

  it('白名单外 / 无扩展名 / 尾点，一律 false', () => {
    expect(isAllowedSoundName('tune.ogg')).toBe(false)
    expect(isAllowedSoundName('tune.wav.exe')).toBe(false)
    expect(isAllowedSoundName('novolume')).toBe(false)
    expect(isAllowedSoundName('tune.')).toBe(false)
  })
})

describe('fileToSoundUpload（预检 + 编码）', () => {
  it('非法类型 / 空文件 / 超限：ok:false 且给出用户可读原因', async () => {
    const badType = new File([new Uint8Array([1])], 'tune.ogg')
    const empty = new File([new Uint8Array(0)], 'ding.wav')
    const tooBig = new File([new Uint8Array(MAX_SOUND_BYTES + 1)], 'ding.wav')
    for (const file of [badType, empty, tooBig]) {
      const payload = await fileToSoundUpload(file)
      expect(payload.ok, `${file.name} 不应通过预检`).toBe(false)
      if (!payload.ok) expect(payload.error.length).toBeGreaterThan(0)
    }
  })

  it('合法小文件：ok:true，base64 与 Buffer 参照一致', async () => {
    const bytes = new Uint8Array([0x64, 0x69, 0x6e, 0x67]) // 'ding'
    const payload = await fileToSoundUpload(new File([bytes], 'ding.wav'))
    expect(payload).toEqual({ ok: true, name: 'ding.wav', dataBase64: Buffer.from(bytes).toString('base64') })
  })

  it('大文件走分块路径（>32KB）：跨块边界无错位', async () => {
    // 40000 字节 = 32768 + 7232：正好跨一个块边界；内容带规律便于暴露错位
    const bytes = new Uint8Array(40000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
    const payload = await fileToSoundUpload(new File([bytes], 'long.wav'))
    expect(payload).toEqual({ ok: true, name: 'long.wav', dataBase64: Buffer.from(bytes).toString('base64') })
  })

  it('恰好 32KB（单块整）：边界值不重不漏', async () => {
    const bytes = new Uint8Array(0x8000).fill(0x61)
    const payload = await fileToSoundUpload(new File([bytes], 'edge.wav'))
    expect(payload).toEqual({ ok: true, name: 'edge.wav', dataBase64: Buffer.from(bytes).toString('base64') })
  })

  it('上限边界：恰好 2MB 通过，2MB+1 被拒（预检用 file.size，不必真编码大数组两遍）', async () => {
    const max = new Uint8Array(MAX_SOUND_BYTES).fill(0x7f)
    const atLimit = await fileToSoundUpload(new File([max], 'max.wav'))
    expect(atLimit.ok).toBe(true)

    // 超限分支在编码前就被 size 拦下，用一个假 size 的 File 对象免分配 2MB+1
    const fake = Object.create(File.prototype)
    Object.defineProperty(fake, 'name', { value: 'over.wav' })
    Object.defineProperty(fake, 'size', { value: MAX_SOUND_BYTES + 1 })
    const over = await fileToSoundUpload(fake as File)
    expect(over.ok).toBe(false)
  })
})
