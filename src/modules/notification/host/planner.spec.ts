/**
 * 计划生成单测：会话事实 + 投影值 + 设置 → 待投递通知。
 * 用例逐条迁移自上游 `tests/runner.spec.ts` 的 `notificationFor` / `pendingNotificationFor`。
 * 转场判定（projectionAdvance / pendingAdvance）的用例在 signals.spec.ts。
 */
import { describe, expect, it } from 'vitest'
import { testRule, testSettings } from '../shared/fixtures.ts'
import { notificationFor, pendingNotificationFor } from './planner.ts'

describe('notificationFor', () => {
  it('跳过 subagent 会话', () => {
    const plan = notificationFor('s1', 'subagent', 'title', { turn: 1, reason: 'completed', body: 'done', tools: [] }, testSettings())
    expect(plan).toBeNull()
  })

  it('投影存在时使用其 reason 与正文', () => {
    const plan = notificationFor('s1', undefined, 'Deploy', { turn: 3, reason: 'error', body: 'boom', tools: ['bash'] }, testSettings())
    expect(plan).toEqual({ reason: 'error', body: 'boom', tag: 'dsh-notification-s1-3' })
  })

  it('投影尚未落定时退回通用完成（正文用标题）', () => {
    const plan = notificationFor('s1', undefined, 'Deploy the app', undefined, testSettings())
    expect(plan).toEqual({ reason: 'completed', body: 'Deploy the app', tag: 'dsh-notification-s1-0' })
  })

  it('跳过未知投影原因', () => {
    const plan = notificationFor('s1', undefined, 'title', { turn: 1, reason: 'interrupted', body: '', tools: [] }, testSettings())
    expect(plan).toBeNull()
  })

  it('遵守该原因对应的开关', () => {
    const plan = notificationFor('s1', undefined, 'title', { turn: 1, reason: 'error', body: 'boom', tools: [] }, testSettings({ notifyError: false }))
    expect(plan).toBeNull()
  })

  it('规则作用于标题、正文与工具名', () => {
    const projection = { turn: 1, reason: 'completed' as const, body: 'preview build', tools: [] }
    const exclude = testSettings({ rules: [testRule({ mode: 'exclude', pattern: 'preview' })] })
    expect(notificationFor('s1', undefined, 'Deploy', projection, exclude)).toBeNull()
    const include = testSettings({ rules: [testRule({ mode: 'include', pattern: 'Deploy' })] })
    expect(notificationFor('s1', undefined, 'Deploy', projection, include)).not.toBeNull()
  })

  it('遵守总开关', () => {
    const plan = notificationFor('s1', undefined, 'title', { turn: 1, reason: 'completed', body: 'done', tools: [] }, testSettings({ enabled: false }))
    expect(plan).toBeNull()
  })
})

describe('pendingNotificationFor', () => {
  it('用会话内序号生成唯一 tag，正文用标题', () => {
    expect(pendingNotificationFor('s1', undefined, 'Deploy', 'approval', 2, testSettings()))
      .toEqual({ kind: 'approval', body: 'Deploy', tag: 'dsh-notification-pending-s1-2' })
  })

  it('跳过 subagent、关闭的种类与不匹配的规则', () => {
    expect(pendingNotificationFor('s1', 'subagent', 'Deploy', 'approval', 1, testSettings())).toBeNull()
    expect(pendingNotificationFor('s1', undefined, 'Deploy', 'plan-review', 1, testSettings())).toBeNull()
    expect(pendingNotificationFor('s1', undefined, 'Deploy', 'approval', 1, testSettings({
      rules: [testRule({ mode: 'include', pattern: 'review' })],
    }))).toBeNull()
  })

  it('遵守总开关', () => {
    expect(pendingNotificationFor('s1', undefined, 'Deploy', 'question', 1, testSettings({ enabled: false }))).toBeNull()
  })
})
