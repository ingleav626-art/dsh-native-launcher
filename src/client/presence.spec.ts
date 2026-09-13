/**
 * 存在态传感器单测：抓 2026-09-13 真机回归（用户质询"我一直在页面前，还是弹通知"）。
 *
 * 缺陷形态 = **两个半边各自都对，合起来错**：
 *   client 半边只在**状态变化**时上报（focus/blur/切会话/可见性变化）；
 *   host 半边按 `PRESENCE_TTL_MS`(15s) 判"上报是否新鲜"，一过期就当作"页面不在眼前"→ 放行通知。
 * 于是用户坐在页面前超过 15 秒，开关就静默失效——日志里表现为"一会儿挡得住、一会儿挡不住"
 * （挡住的那几次都发生在某个页面事件之后的 15 秒内）。
 *
 * 修复 = 补心跳（状态不变也定期重报）。因此本文件必须能抓到"心跳缺失"这一条。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRESENCE_HEARTBEAT_MS, startPresenceReporter, type PresenceState } from './presence.ts'
import type { ClientContextLike } from './types.ts'
import { PRESENCE_TTL_MS, createPresenceTracker } from '../modules/notification/host/presence.ts'
import { testSettings } from '../modules/notification/shared/fixtures.ts'

interface FakeEnv {
  readonly doc: { hidden: boolean; hasFocus(): boolean }
  readonly state: { current?: string }
  fire(target: 'window' | 'document', type: string): void
}

/** 极简浏览器替身：只提供被测模块真正读的那几项（事件登记 / hidden / hasFocus / 会话列表）。 */
function fakeEnv(): FakeEnv {
  const listeners = new Map<string, Array<() => void>>()
  const register = (target: string) => (type: string, fn: () => void): void => {
    const key = `${target}:${type}`
    listeners.set(key, [...(listeners.get(key) ?? []), fn])
  }
  const doc = { hidden: false, hasFocus: () => true, addEventListener: register('document') }
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', { addEventListener: register('window') })
  return {
    doc,
    state: { current: 's-1' },
    fire: (target, type) => {
      for (const fn of listeners.get(`${target}:${type}`) ?? []) fn()
    },
  }
}

/** 假 ctx：只暴露 sessions.list（`current` = 正在查看的会话）。 */
function fakeCtx(state: { current?: string }, subs: Array<() => void>): ClientContextLike {
  const sessions = {
    list: {
      getSnapshot: () => ({ current: state.current }),
      subscribe: (fn: () => void) => {
        subs.push(fn)
      },
    },
  }
  return { get: (name: string) => (name === 'sessions' ? sessions : undefined) } as unknown as ClientContextLike
}

describe('存在态传感器（backgroundOnly 的输入）', () => {
  let env: FakeEnv
  let sent: PresenceState[]
  let subs: Array<() => void>

  beforeEach(() => {
    vi.useFakeTimers()
    env = fakeEnv()
    sent = []
    subs = []
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const start = (): void => startPresenceReporter(fakeCtx(env.state, subs), state => sent.push(state))

  it('启动即上报一次（页面刚加载，host 据此知道"有人在看某个会话"）', () => {
    start()
    expect(sent).toEqual([{ visible: true, activeSessionId: 's-1' }])
  })

  it('状态不变超过一个心跳周期 → 必须重报（否则 host 的 15s TTL 一到就把人当失联，人在眼前照样弹）', () => {
    start()
    expect(sent).toHaveLength(1)
    vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS)
    expect(sent).toHaveLength(2)
    vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 2)
    expect(sent).toHaveLength(4)
    // 心跳内容仍是当前状态（host 只存最后一次）
    expect(sent[sent.length - 1]).toEqual({ visible: true, activeSessionId: 's-1' })
  })

  it('心跳周期必须显著小于 host 的 TTL（跨半边契约：这条挂了 = 存在态必然周期性过期）', () => {
    expect(PRESENCE_HEARTBEAT_MS * 2).toBeLessThanOrEqual(PRESENCE_TTL_MS)
  })

  it('切会话立即重报；同一状态重复事件不重发（页面事件密集，去重仍是硬要求）', () => {
    start()
    env.state.current = 's-2'
    for (const notify of subs) notify()
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual({ visible: true, activeSessionId: 's-2' })
    for (const notify of subs) notify()
    expect(sent).toHaveLength(2)
  })

  it('切到后台立即重报 visible=false（host 据此恢复通知），且心跳继续带着该状态', () => {
    start()
    env.doc.hidden = true
    env.fire('document', 'visibilitychange')
    expect(sent).toHaveLength(2)
    expect(sent[1]?.visible).toBe(false)
    vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS)
    expect(sent[2]?.visible).toBe(false)
  })

  it('失焦（hasFocus=false）也算不可见——只看 hidden 会漏掉"窗口被别的窗口盖住"', () => {
    start()
    const doc = env.doc as { hasFocus(): boolean }
    doc.hasFocus = () => false
    env.fire('window', 'blur')
    expect(sent).toHaveLength(2)
    expect(sent[1]?.visible).toBe(false)
  })

  it('端到端（两半边合起来）：坐在页面前 60 秒，host 必须始终认为"任务就在眼前"', () => {
    // 用户实测回归的直译：只有边沿上报时，host 的 15s TTL 一过期就放行通知。
    // 采样点故意落在**两次心跳之间**（2.5s 间隔），证明新鲜度不是只在心跳瞬间成立。
    const tracker = createPresenceTracker()
    startPresenceReporter(fakeCtx(env.state, subs), state => tracker.report(state))
    const settings = testSettings({ backgroundOnly: true })
    for (let elapsed = 0; elapsed < 60_000; elapsed += PRESENCE_HEARTBEAT_MS / 2) {
      expect(tracker.suppresses('s-1', settings)).toBe(true)
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS / 2)
    }
  })

  it('端到端：页面切到后台后，同一套心跳必须让 host 恢复通知（不能反过来把通知永久压住）', () => {
    const tracker = createPresenceTracker()
    startPresenceReporter(fakeCtx(env.state, subs), state => tracker.report(state))
    const settings = testSettings({ backgroundOnly: true })
    env.doc.hidden = true
    env.fire('document', 'visibilitychange')
    vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 4)
    expect(tracker.suppresses('s-1', settings)).toBe(false)
  })
})
