/**
 * pending 通道单测：首见播种、种类切换触发、序号递增、设置抑制、上报形状校验。
 * 断言落在可观察结果（端口收到的载荷）上。
 */
import { describe, expect, it } from 'vitest'
import { testSettings } from '../shared/fixtures.ts'
import type { TrayNotification } from '../shared/types.ts'
import { createNotifier } from './notifier.ts'
import type { LoggerPort } from './ports.ts'
import { createPendingChannel, isPendingReport, type PendingChannelDeps } from './pending.ts'

const silentLogger: LoggerPort = { info: () => {}, warn: () => {}, fail: () => {} }

/** 链路走真实的 notifier + pending 通道，只把最外的投递端口换成记录器。 */
function fakeDeps(settings = testSettings()): { deps: PendingChannelDeps; delivered: TrayNotification[] } {
  const delivered: TrayNotification[] = []
  return {
    delivered,
    deps: {
      settings: () => settings,
      notifier: createNotifier({ notify: { notify: notification => { delivered.push(notification) } }, logger: silentLogger }),
      logger: silentLogger,
    },
  }
}

describe('createPendingChannel', () => {
  it('首见某会话只播种，不投递（页面刚打开时已存在的等待不补历史通知）', () => {
    const { deps, delivered } = fakeDeps()
    const channel = createPendingChannel(deps)
    channel.report({ sessionId: 's1', kind: 'question', title: 'Deploy' })
    expect(delivered).toHaveLength(0)
  })

  it('等待从无到有（或种类变化）时投递一条', () => {
    const { deps, delivered } = fakeDeps()
    const channel = createPendingChannel(deps)
    channel.report({ sessionId: 's1', kind: undefined, title: 'Deploy' })
    channel.report({ sessionId: 's1', kind: 'approval', title: 'Deploy' })
    expect(delivered).toEqual([{ title: '等待你的批准', body: 'Deploy', tag: 'dsh-notification-pending-s1-1' }])
  })

  it('同一等待持续上报不重复投递，解除后再等待是新的序号', () => {
    const { deps, delivered } = fakeDeps()
    const channel = createPendingChannel(deps)
    channel.report({ sessionId: 's1', kind: undefined })
    channel.report({ sessionId: 's1', kind: 'question' })
    channel.report({ sessionId: 's1', kind: 'question' })
    channel.report({ sessionId: 's1', kind: undefined })
    channel.report({ sessionId: 's1', kind: 'question' })
    expect(delivered.map(item => item.tag)).toEqual([
      'dsh-notification-pending-s1-1',
      'dsh-notification-pending-s1-2',
    ])
  })

  it('被设置关掉的种类不投递', () => {
    const { deps, delivered } = fakeDeps(testSettings({ notifyQuestion: false }))
    const channel = createPendingChannel(deps)
    channel.report({ sessionId: 's1', kind: undefined })
    channel.report({ sessionId: 's1', kind: 'question' })
    expect(delivered).toHaveLength(0)
  })

  it('subagent 会话不投递', () => {
    const { deps, delivered } = fakeDeps()
    const channel = createPendingChannel(deps)
    channel.report({ sessionId: 's1', kind: undefined })
    channel.report({ sessionId: 's1', kind: 'approval', origin: 'subagent' })
    expect(delivered).toHaveLength(0)
  })

  it('会话消失后清状态，重建会话从播种重新开始', () => {
    const { deps, delivered } = fakeDeps()
    const channel = createPendingChannel(deps)
    channel.report({ sessionId: 's1', kind: undefined })
    channel.report({ sessionId: 's1', kind: 'approval' })
    channel.forgetSession('s1')
    channel.report({ sessionId: 's1', kind: 'approval' })
    expect(delivered).toHaveLength(1)
  })
})

describe('isPendingReport', () => {
  it('接受合法上报，拒绝缺 id 或类型不符的值', () => {
    expect(isPendingReport({ sessionId: 's1' })).toBe(true)
    expect(isPendingReport({ sessionId: 's1', kind: 'approval' })).toBe(true)
    expect(isPendingReport({ sessionId: '' })).toBe(false)
    expect(isPendingReport({ kind: 'approval' })).toBe(false)
    expect(isPendingReport({ sessionId: 's1', kind: 42 })).toBe(false)
    expect(isPendingReport(null)).toBe(false)
    expect(isPendingReport('s1')).toBe(false)
  })
})
