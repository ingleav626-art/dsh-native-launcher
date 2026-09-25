/**
 * 投递端口单测：tray-notify.json 载荷契约（音效指令透传 + 形状过滤 + 抑制开关）。
 *
 * 抓的 bug 面：投递端是托盘音效链路的形状边界——上游（模块/host RPC）给的 sound
 * 形状不可信，白名单外的形状必须被滤掉（托盘端只认 'none' / {path} 两种）；
 * 同时默认载荷不得多出 sound 键（旧托盘脚本读不到该键，行为必须不变）。
 * 文件写入走真实临时目录（被测对象就是 fs 写入，mock fs 等于没测）。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createNotifyPort } from './ports.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 建独立临时目录并返回写入的载荷解析结果。 */
function deliverAndRead(notification: unknown, isSuppressed?: () => boolean): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notify-port-'))
  dirs.push(dir)
  const port = createNotifyPort(dir, () => {}, isSuppressed)
  port.notify(notification as never)
  return JSON.parse(readFileSync(join(dir, 'tray-notify.json'), 'utf8')) as Record<string, unknown>
}

describe('createNotifyPort 的 sound 透传', () => {
  it('默认载荷不带 sound 键（旧托盘脚本读不到该键行为不变——兼容闸）', () => {
    const payload = deliverAndRead({ title: 'T', body: 'B', tag: 't1' })
    expect(payload.persistent).toBe(false)
    expect('sound' in payload).toBe(false)
  })

  it("'none' → 载荷 sound='none'（托盘静音 Toast 与兜底音）", () => {
    const payload = deliverAndRead({ title: 'T', body: 'B', tag: 't1', sound: 'none' })
    expect(payload.sound).toBe('none')
  })

  it("sound:{path} → 载荷 sound={path}（托盘静音 + 播放该文件）", () => {
    const payload = deliverAndRead({ title: 'T', body: 'B', tag: 't1', sound: { path: 'C:\\Media\\ding.wav' } })
    expect(payload.sound).toEqual({ path: 'C:\\Media\\ding.wav' })
  })

  it('白名单外的形状被滤掉（渲染进程/上游形状不可信）：空 path 对象、字符串、无 path 对象', () => {
    for (const bad of [{ path: '   ' }, {}, 'custom', 42]) {
      const payload = deliverAndRead({ title: 'T', body: 'B', tag: 't1', sound: bad })
      expect('sound' in payload, `形状 ${JSON.stringify(bad)} 不应透传`).toBe(false)
    }
  })
})
