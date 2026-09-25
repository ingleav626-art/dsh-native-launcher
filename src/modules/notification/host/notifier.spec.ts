/**
 * 投递编排单测：标签去重、文案组装、失败隔离、上限淘汰、会话清理。
 * 断言都落在**可观察结果**上（端口收到的载荷 / 记下的失败），不使用 mock 调用计数断言。
 */
import { describe, expect, it } from 'vitest'
import { testSettings } from '../shared/fixtures.ts'
import type { TrayNotification } from '../shared/types.ts'
import { createNotifier, resolveTraySound, type NotifierDeps } from './notifier.ts'

/** 端口替身：记录载荷（外部边界换成记录器，链路上的逻辑全部走真实实现）。 */
function fakeDeps(
  failWith?: string,
  settings = testSettings(),
): { deps: NotifierDeps; delivered: TrayNotification[]; failures: string[] } {
  const delivered: TrayNotification[] = []
  const failures: string[] = []
  return {
    delivered,
    failures,
    deps: {
      notify: {
        notify: (notification) => {
          if (failWith !== undefined) throw new Error(failWith)
          delivered.push(notification)
        },
      },
      settings: () => settings,
      logger: { info: () => {}, warn: () => {}, fail: (message) => { failures.push(message) } },
    },
  }
}

const completion = { reason: 'completed' as const, body: 'done', tag: 'dsh-notification-s1-1' }
const pending = { kind: 'approval' as const, body: 'Deploy', tag: 'dsh-notification-pending-s1-1' }

describe('createNotifier.deliverCompletion', () => {
  it('把计划翻成用户可见载荷并交给投递端口（标题按原因、正文原样）', () => {
    const { deps, delivered } = fakeDeps()
    const notifier = createNotifier(deps)
    expect(notifier.deliverCompletion('s1', completion)).toBe(true)
    expect(delivered).toEqual([{ title: '任务完成', body: 'done', tag: 'dsh-notification-s1-1' }])
  })

  it('空正文回退到占位文案', () => {
    const { deps, delivered } = fakeDeps()
    const notifier = createNotifier(deps)
    notifier.deliverCompletion('s1', { ...completion, body: '   ' })
    expect(delivered[0]?.body).toBe('（无正文）')
  })

  it('同标签重复投递被拦下（系统会吞并同 tag，重复投递无意义）', () => {
    const { deps, delivered } = fakeDeps()
    const notifier = createNotifier(deps)
    expect(notifier.deliverCompletion('s1', completion)).toBe(true)
    expect(notifier.deliverCompletion('s1', completion)).toBe(false)
    expect(delivered).toHaveLength(1)
  })

  it('同会话的下一个 turn 是新标签，照常投递', () => {
    const { deps, delivered } = fakeDeps()
    const notifier = createNotifier(deps)
    notifier.deliverCompletion('s1', completion)
    notifier.deliverCompletion('s1', { ...completion, tag: 'dsh-notification-s1-2' })
    expect(delivered.map(item => item.tag)).toEqual(['dsh-notification-s1-1', 'dsh-notification-s1-2'])
  })
})

describe('createNotifier.deliverPending', () => {
  it('等待交互通知用各自的标题，正文取会话标题', () => {
    const { deps, delivered } = fakeDeps()
    const notifier = createNotifier(deps)
    expect(notifier.deliverPending('s1', pending)).toBe(true)
    expect(delivered).toEqual([{ title: '等待你的批准', body: 'Deploy', tag: 'dsh-notification-pending-s1-1' }])
  })
})

describe('createNotifier 的健壮性', () => {
  it('requireInteraction=true → 载荷带 persistent（托盘据此常驻呈现，上游语义补回）', () => {
    const { deps, delivered } = fakeDeps(undefined, testSettings({ requireInteraction: true }))
    const notifier = createNotifier(deps)
    notifier.deliverCompletion('s1', completion)
    notifier.deliverPending('s1', pending)
    expect(delivered.map(item => item.persistent)).toEqual([true, true])
  })

  it('requireInteraction=false（默认）→ 载荷不带 persistent（与上游逐字一致，无噪声字段）', () => {
    const { deps, delivered } = fakeDeps()
    const notifier = createNotifier(deps)
    notifier.deliverCompletion('s1', completion)
    expect(delivered[0]).toEqual({ title: '任务完成', body: 'done', tag: 'dsh-notification-s1-1' })
    expect('persistent' in (delivered[0] ?? {})).toBe(false)
  })

  it('投递端口抛错时被隔离（不向决策链抛出，且记下失败）', () => {
    const { deps, failures } = fakeDeps('托盘不可用')
    const notifier = createNotifier(deps)
    expect(() => notifier.deliverCompletion('s1', completion)).not.toThrow()
    expect(failures.some(message => message.includes('托盘不可用'))).toBe(true)
  })

  it('去重表超上限时按插入序淘汰最旧标签', () => {
    const { deps, delivered } = fakeDeps()
    const notifier = createNotifier(deps, { maxRemembered: 2 })
    notifier.deliverCompletion('s1', { ...completion, tag: 't1' })
    notifier.deliverCompletion('s1', { ...completion, tag: 't2' })
    notifier.deliverCompletion('s1', { ...completion, tag: 't3' })
    expect(notifier.rememberedCount()).toBe(2)
    // t1 已被淘汰 → 可以再投（否则长跑进程会永久吞掉老标签）
    expect(notifier.deliverCompletion('s1', { ...completion, tag: 't1' })).toBe(true)
    expect(delivered.map(item => item.tag)).toEqual(['t1', 't2', 't3', 't1'])
  })

  it('会话消失后清掉其记录', () => {
    const { deps } = fakeDeps()
    const notifier = createNotifier(deps)
    notifier.deliverCompletion('s1', completion)
    notifier.deliverCompletion('s2', { ...completion, tag: 'dsh-notification-s2-1' })
    notifier.forgetSession('s1')
    expect(notifier.rememberedCount()).toBe(1)
    expect(notifier.deliverCompletion('s1', completion)).toBe(true)
  })
})

describe('resolveTraySound（设置面 → 托盘音效指令）', () => {
  it('表驱动：四种设置形态到指令的映射', () => {
    // default → undefined（载荷不带 sound 字段，托盘按系统默认音，旧托盘兼容）
    expect(resolveTraySound(testSettings({ sound: 'default' }))).toBeUndefined()
    // none → 'none'（托盘 Toast 静音，也不播任何音）
    expect(resolveTraySound(testSettings({ sound: 'none' }))).toBe('none')
    // custom + 非空路径 → { path }（托盘静音 Toast + 播放文件）
    expect(resolveTraySound(testSettings({ sound: 'custom', soundPath: ' C:\\Media\\ding.wav ' })))
      .toEqual({ path: 'C:\\Media\\ding.wav' })
    // custom + 空白路径 → 按系统默认（路径是 custom 的生效条件，设置面已写明）
    expect(resolveTraySound(testSettings({ sound: 'custom', soundPath: '   ' }))).toBeUndefined()
  })

  it('载荷集成：sound 仅在非默认时出现（默认载荷无噪声字段，与 persistent 同口径）', () => {
    // none → 载荷带 sound:'none'
    const noneCase = fakeDeps(undefined, testSettings({ sound: 'none' }))
    createNotifier(noneCase.deps).deliverCompletion('s1', completion)
    expect(noneCase.delivered[0]).toEqual({ title: '任务完成', body: 'done', tag: 'dsh-notification-s1-1', sound: 'none' })

    // custom → 载荷带 sound:{path}
    const customCase = fakeDeps(undefined, testSettings({ sound: 'custom', soundPath: 'C:\\Media\\ding.wav' }))
    createNotifier(customCase.deps).deliverCompletion('s1', completion)
    expect(customCase.delivered[0]?.sound).toEqual({ path: 'C:\\Media\\ding.wav' })

    // default → 无 sound 键
    const defCase = fakeDeps()
    createNotifier(defCase.deps).deliverCompletion('s1', completion)
    expect('sound' in (defCase.delivered[0] ?? {})).toBe(false)
  })

  it('读设置抛错 → 按系统默认音投递（与 persistent 同口径：投递不因设置异常挂掉）', () => {
    const delivered: TrayNotification[] = []
    const notifier = createNotifier({
      notify: { notify: (notification) => { delivered.push(notification) } },
      settings: () => { throw new Error('settings unavailable') },
      logger: { info: () => {}, warn: () => {}, fail: () => {} },
    })
    expect(notifier.deliverCompletion('s1', completion)).toBe(true)
    expect('sound' in (delivered[0] ?? {})).toBe(false)
  })
})
