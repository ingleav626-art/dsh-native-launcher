/**
 * pending 传感器单测：抓"首见播种缺失"这个真实回归（旧实现让每个会话的第一次等待通知不弹）。
 *
 * 设计：feed 是外部边界（官方 store）→ 用替身喂快照；被测链路（去重状态机 → 上报）走真实实现。
 * 每例写明预期与理由。
 */
import { describe, expect, it } from 'vitest'
import { createPendingReporter } from './pendingReporter.ts'
import type { PendingObservation } from './ports.ts'

/** 观测源替身：记录订阅者，测试用 push 推快照（对应官方 store 的订阅回调）。 */
function fakeFeed(): { feed: { subscribe: (listener: (items: readonly PendingObservation[]) => void) => void }; push: (items: readonly PendingObservation[]) => void } {
  let listener: ((items: readonly PendingObservation[]) => void) | undefined
  return {
    feed: { subscribe: next => { listener = next } },
    push: items => { listener?.(items) },
  }
}

/** 组装：返回上报记录（跨进程边界只记录，不 mock 链路内部）。 */
function setup(): { feed: ReturnType<typeof fakeFeed>; reported: PendingObservation[]; start: () => () => void } {
  const feed = fakeFeed()
  const reported: PendingObservation[] = []
  const reporter = createPendingReporter({
    feed: feed.feed,
    report: { report: observation => { reported.push(observation) } },
    logger: { info: () => {}, warn: () => {} },
  })
  return { feed, reported, start: () => reporter.start() }
}

describe('pending 传感器', () => {
  it('首见即上报（即使无等待）——host 靠这次上报完成播种', () => {
    const { feed, reported, start } = setup()
    start()
    // 页面打开时已存在的会话：kind 为 undefined 也要上报，否则 host 把此后的首次等待当首见吞掉
    feed.push([{ sessionId: 's1', title: '会话一' }])
    expect(reported).toEqual([{ sessionId: 's1', title: '会话一' }])
  })

  it('等待出现时上报一次，重复快照不重复上报（省 RPC）', () => {
    const { feed, reported, start } = setup()
    start()
    feed.push([{ sessionId: 's1' }])
    feed.push([{ sessionId: 's1', kind: 'approval', title: '部署' }])
    feed.push([{ sessionId: 's1', kind: 'approval', title: '部署' }])
    expect(reported).toHaveLength(2)
    expect(reported[1]).toEqual({ sessionId: 's1', kind: 'approval', title: '部署' })
  })

  it('等待解除后再次出现：两次都上报（host 据此重新通知）', () => {
    const { feed, reported, start } = setup()
    start()
    feed.push([{ sessionId: 's1', kind: 'question' }])
    feed.push([{ sessionId: 's1' }])
    feed.push([{ sessionId: 's1', kind: 'question' }])
    expect(reported.map(item => item.kind)).toEqual(['question', undefined, 'question'])
  })

  it('等待种类变化（审批 → 提问）也上报', () => {
    const { feed, reported, start } = setup()
    start()
    feed.push([{ sessionId: 's1', kind: 'approval' }])
    feed.push([{ sessionId: 's1', kind: 'plan-review' }])
    expect(reported.map(item => item.kind)).toEqual(['approval', 'plan-review'])
  })

  it('会话消失即清状态：同 kind 再现仍要上报（不因陈旧记录漏报）', () => {
    const { feed, reported, start } = setup()
    start()
    feed.push([{ sessionId: 's1', kind: 'approval' }])
    feed.push([])                                     // 会话消失：上报不了任何东西（退出循环）
    feed.push([{ sessionId: 's1', kind: 'approval' }]) // 同 kind 再现 → 必须再报一次
    expect(reported.map(item => item.kind)).toEqual(['approval', 'approval'])
  })

  it('退订后不再上报（dispose 生效，宿主回收模块时不残留回调）', () => {
    const { feed, reported, start } = setup()
    const stop = start()
    feed.push([{ sessionId: 's1' }])
    stop()
    feed.push([{ sessionId: 's2' }])
    expect(reported.map(item => item.sessionId)).toEqual(['s1'])
  })

  it('订阅抛错只记日志，不向上抛（传感器失败不得拖累设置页）', () => {
    const warnings: string[] = []
    const reporter = createPendingReporter({
      feed: { subscribe: () => { throw new Error('sessions 不可用') } },
      report: { report: () => {} },
      logger: { info: () => {}, warn: message => { warnings.push(message) } },
    })
    expect(() => reporter.start()).not.toThrow()
    expect(warnings[0]).toContain('等待态订阅失败')
  })
})
