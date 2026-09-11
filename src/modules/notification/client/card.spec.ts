/**
 * 通知卡片与设置 schema 的一致性单测。
 *
 * 抓的 bug：「只加 schema 不加 UI」——host 侧 schema 新增一个布尔开关、卡片忘了加，
 * 用户界面上就没有这个开关（等于不存在，且没人会发现）；反之卡片引用了 schema 没有的字段，
 * 开关写不进去（点了没反应）。两边都由测试盯住。
 */
import { describe, expect, it } from 'vitest'
import { defaultNotificationSettings } from '../host/settings.ts'
import type { NotificationSettings } from '../shared/types.ts'
import { CARD_BOOLEAN_FIELDS, notifyPatch } from './card.ts'

describe('卡片开关 ↔ 设置 schema', () => {
  it('schema 的每个布尔字段都有对应开关', () => {
    const defaults = defaultNotificationSettings()
    const booleans = (Object.keys(defaults) as Array<keyof NotificationSettings>)
      .filter(key => typeof defaults[key] === 'boolean')
    // 用例自身的前提：schema 里确实有布尔字段（否则下面的断言会假通过）
    expect(booleans.length).toBeGreaterThan(0)
    for (const field of booleans) expect(CARD_BOOLEAN_FIELDS).toContain(field)
  })

  it('卡片管理的每个字段在 schema 里都是布尔', () => {
    const defaults = defaultNotificationSettings() as unknown as Record<string, unknown>
    for (const field of CARD_BOOLEAN_FIELDS) {
      expect(typeof defaults[field], `字段 ${field} 不在 schema 里（开关写不进去）`).toBe('boolean')
    }
  })
})

describe('notifyPatch', () => {
  it('一次只改一个字段（避免开 A 时把 B 的勾选状态一起写掉）', () => {
    expect(notifyPatch('notifyError', false)).toEqual({ notifyError: false })
    expect(notifyPatch('notifyQuestion', true)).toEqual({ notifyQuestion: true })
  })
})
