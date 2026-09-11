/**
 * 呈现标签单测：通知分组 tag 的唯一性与原子性、标题映射、正文回退。
 *
 * 上游 `tests/notifier.spec.ts` 覆盖同一批函数（`notificationTag` / `pendingNotificationTag` /
 * `titleKey` / `bodyText`）；本项目返回中文标题而非字典键，故用例按返回值重写。
 */
import { describe, expect, it } from 'vitest'
import { bodyText, notificationTag, pendingTitleFor, titleFor } from './labels.ts'

describe('notificationTag', () => {
  it('按会话 + turn 生成原子标签（同会话不同 turn 不同 tag）', () => {
    expect(notificationTag('s1', 3)).toBe('dsh-notification-s1-3')
    expect(notificationTag('s1', 4)).not.toBe(notificationTag('s1', 3))
    expect(notificationTag('s2', 3)).not.toBe(notificationTag('s1', 3))
  })
})

describe('titleFor / pendingTitleFor', () => {
  it('五种结束原因各有标题', () => {
    expect(titleFor('completed')).toBe('任务完成')
    expect(titleFor('error')).toBe('任务出错')
    expect(titleFor('aborted')).toBe('任务已中止')
    expect(titleFor('blocked')).toBe('任务被阻塞')
    expect(titleFor('max-tokens')).toBe('达到 token 上限')
  })

  it('三种等待交互各有标题', () => {
    expect(pendingTitleFor('approval')).toBe('等待你的批准')
    expect(pendingTitleFor('question')).toBe('等待你的回答')
    expect(pendingTitleFor('plan-review')).toBe('等待计划评审')
  })
})

describe('bodyText', () => {
  it('空正文回退到占位文案', () => {
    expect(bodyText('   ', '（无正文）')).toBe('（无正文）')
    expect(bodyText('done', '（无正文）')).toBe('done')
  })
})
