/**
 * 存在态判定的表驱动测试：抓"人在页面前也被弹通知"这个真实回归
 * （`backgroundOnly` 在 P3-0 一度形同虚设，设置项承诺与实际行为不符）。
 *
 * 每个用例写明预期与理由；时间由注入的时钟控制，不依赖真实等待。
 */
import { describe, expect, it } from 'vitest'
import { testSettings } from '../shared/fixtures.ts'
import { createPresenceTracker, isPresenceReport, PRESENCE_TTL_MS } from './presence.ts'

/** 可控时钟 + 追踪器。 */
function setup(): { tracker: ReturnType<typeof createPresenceTracker>; advance: (ms: number) => void } {
  let clock = 1_000_000
  const tracker = createPresenceTracker(() => clock)
  return { tracker, advance: (ms: number) => { clock += ms } }
}

const on = (backgroundOnly = true) => testSettings({ backgroundOnly })
const off = () => testSettings({ backgroundOnly: false })

describe('isPresenceReport', () => {
  it('visible 必填且必须是布尔；activeSessionId 可缺省但必须是字符串', () => {
    expect(isPresenceReport({ visible: true })).toBe(true)
    expect(isPresenceReport({ visible: false, activeSessionId: 's1' })).toBe(true)
    expect(isPresenceReport({ visible: 'yes' })).toBe(false)
    expect(isPresenceReport({})).toBe(false)
    expect(isPresenceReport(null)).toBe(false)
    expect(isPresenceReport('x')).toBe(false)
    expect(isPresenceReport({ visible: true, activeSessionId: 42 })).toBe(false)
  })
})

describe('suppresses（backgroundOnly 语义）', () => {
  it('前台 + 正在看这个会话 → 抑制（这是"人在页面前不该弹"的核心）', () => {
    const { tracker } = setup()
    tracker.report({ visible: true, activeSessionId: 's1' })
    expect(tracker.suppresses('s1', on())).toBe(true)
  })

  it('前台但看的是别的会话 → 照常通知（多任务并行时另一个会话完成要提醒）', () => {
    const { tracker } = setup()
    tracker.report({ visible: true, activeSessionId: 'other' })
    expect(tracker.suppresses('s1', on())).toBe(false)
  })

  it('页面在后台 → 照常通知（哪怕正在看的"当前会话"就是它）', () => {
    const { tracker } = setup()
    tracker.report({ visible: false, activeSessionId: 's1' })
    expect(tracker.suppresses('s1', on())).toBe(false)
  })

  it('从未收到上报 → 按"不在眼前"处理（页面全关场景必须照常通知）', () => {
    const { tracker } = setup()
    expect(tracker.suppresses('s1', on())).toBe(false)
  })

  it('上报过期（页面已关/失联）→ 恢复通知，不会因为最后一次"在前台"而永久静音', () => {
    const { tracker, advance } = setup()
    tracker.report({ visible: true, activeSessionId: 's1' })
    advance(PRESENCE_TTL_MS + 1)
    expect(tracker.suppresses('s1', on())).toBe(false)
  })

  it('开关关闭（backgroundOnly=false）→ 一律通知，与存在态无关', () => {
    const { tracker } = setup()
    tracker.report({ visible: true, activeSessionId: 's1' })
    expect(tracker.suppresses('s1', off())).toBe(false)
  })

  it('形状非法的上报被忽略且不覆盖已有状态（跨进程输入不可信）', () => {
    const { tracker } = setup()
    tracker.report({ visible: true, activeSessionId: 's1' })
    expect(tracker.report({ visible: 'yes' })).toBe(false)
    expect(tracker.suppresses('s1', on())).toBe(true)
  })
})
