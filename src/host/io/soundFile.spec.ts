/**
 * 音效副本落盘（host 侧 L2）单测：扩展名白名单 / base64 严格校验 / 大小上限 / 落盘与残留清理。
 *
 * 抓的 bug 面：上传来自渲染进程，形状不可信——Buffer.from 对非法 base64 是宽松跳过
 * （静默产出坏文件），必须先显式拒绝；跨扩展名换音效时旧副本必须被清掉
 * （设置指向新扩展名，旧文件残留只会让用户在目录里看到莫名其妙的死文件）。
 * 文件写入走真实临时目录（被测对象就是 fs 写入，mock fs 等于没测）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NOTIFY_SOUND_BASENAME, base64ByteLength, notifySoundExtOf, saveNotifySound } from './soundFile.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sound-file-'))
  dirs.push(dir)
  return dir
}

describe('notifySoundExtOf（扩展名白名单）', () => {
  it('白名单内通过（大小写不敏感）', () => {
    expect(notifySoundExtOf('ding.wav')).toBe('.wav')
    expect(notifySoundExtOf('DING.WAV')).toBe('.wav')
    expect(notifySoundExtOf('ringtone.MP3')).toBe('.mp3')
    expect(notifySoundExtOf('bell.WMA')).toBe('.wma')
  })

  it('白名单外 / 无扩展名 / 尾点 / 隐藏文件，一律 null', () => {
    expect(notifySoundExtOf('tune.ogg')).toBeNull()
    expect(notifySoundExtOf('tune.exe')).toBeNull()
    expect(notifySoundExtOf('novolume')).toBeNull()
    expect(notifySoundExtOf('tune.')).toBeNull()
    // '.wav' 整体是扩展名形态：lastIndexOf('.') === 0，slice(0) 全中——判定通过属预期行为
    expect(notifySoundExtOf('.wav')).toBe('.wav')
  })
})

describe('base64ByteLength（严格形态 + padding 修正）', () => {
  it('合法输入按 padding 还原字节数', () => {
    expect(base64ByteLength(Buffer.from('ding').toString('base64'))).toBe(4) // 'ZGluZw=='
    expect(base64ByteLength(Buffer.from('din').toString('base64'))).toBe(3) // 'ZGlu'
    expect(base64ByteLength(Buffer.from('di').toString('base64'))).toBe(2) // 'ZGk='
    expect(base64ByteLength(Buffer.from('a').toString('base64'))).toBe(1) // 'YQ=='
  })

  it('非法形态一律 -1（Buffer.from 会宽松跳过，必须先显式拒绝）', () => {
    expect(base64ByteLength('')).toBe(-1) // 空
    expect(base64ByteLength('abcde')).toBe(-1) // 长度非 4 的倍数
    expect(base64ByteLength('ZGl@Zw==')).toBe(-1) // 非法字符
    expect(base64ByteLength('ZGluZw=*=')).toBe(-1) // padding 位混入非法字符
  })
})

describe('saveNotifySound（落盘矩阵，真实临时目录）', () => {
  const WAV_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04]) // 'RIFF'+4 字节

  it('合法输入：ok:true，文件落盘且字节一致', () => {
    const dir = newDir()
    const result = saveNotifySound(dir, 'ding.wav', WAV_BYTES.toString('base64'))
    expect(result).toMatchObject({ ok: true, bytes: WAV_BYTES.length })
    if (!result.ok) return
    expect(result.path).toBe(join(dir, 'notify-sound.wav'))
    expect(readFileSync(result.path).equals(WAV_BYTES)).toBe(true)
  })

  it('校验失败矩阵：扩展名 / base64 形态 / 空文件 / 超限，全部 ok:false 且不落盘', () => {
    const dir = newDir()
    const tooBigBase64 = Buffer.alloc(2 * 1024 * 1024 + 1, 7).toString('base64')
    for (const [name, data] of [
      ['tune.ogg', WAV_BYTES.toString('base64')], // 扩展名白名单外
      ['ding.wav', 'not-base64!!'], // base64 非法形态
      ['ding.wav', ''], // 空文件
      ['ding.wav', tooBigBase64], // 超过 2MB
    ] as const) {
      const result = saveNotifySound(dir, name, data)
      expect(result.ok, `${name} / ${data.slice(0, 12)}… 不应通过`).toBe(false)
    }
    expect(existsSync(join(dir, 'notify-sound.wav'))).toBe(false)
  })

  it('跨扩展名换音效：旧副本被清掉（不残留死文件）', () => {
    const dir = newDir()
    const first = saveNotifySound(dir, 'ding.wav', WAV_BYTES.toString('base64'))
    expect(first.ok).toBe(true)
    const mp3Bytes = Buffer.from([0x49, 0x44, 0x33, 0x04]) // 'ID3'+1
    const second = saveNotifySound(dir, 'ringtone.mp3', mp3Bytes.toString('base64'))
    expect(second.ok).toBe(true)
    expect(existsSync(join(dir, `${NOTIFY_SOUND_BASENAME}.wav`))).toBe(false)
    expect(existsSync(join(dir, `${NOTIFY_SOUND_BASENAME}.mp3`))).toBe(true)
  })

  it('同扩展名覆盖写入：旧内容被顶掉', () => {
    const dir = newDir()
    expect(saveNotifySound(dir, 'a.wav', 'AAAA').ok).toBe(true)
    const next = Buffer.from([0x09, 0x08, 0x07])
    expect(saveNotifySound(dir, 'b.wav', next.toString('base64')).ok).toBe(true)
    expect(readFileSync(join(dir, 'notify-sound.wav')).equals(next)).toBe(true)
  })

  it('launchDir 不存在时：写入报错以 ok:false 返回（不抛异常炸调用方）', () => {
    const missing = join(newDir(), 'not-created')
    const result = saveNotifySound(missing, 'ding.wav', WAV_BYTES.toString('base64'))
    expect(result.ok).toBe(false)
  })
})

describe('saveNotifySound 的预清理对预置文件的兼容', () => {
  it('目录里预置的旧副本（手工放的）也会在下次写入时被清掉', () => {
    const dir = newDir()
    writeFileSync(join(dir, 'notify-sound.wma'), Buffer.from([0x01]))
    const result = saveNotifySound(dir, 'ding.wav', Buffer.from([0x02]).toString('base64'))
    expect(result.ok).toBe(true)
    expect(existsSync(join(dir, 'notify-sound.wma'))).toBe(false)
  })
})
