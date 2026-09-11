/**
 * settings 单测：schema 默认值与出厂值一致（两处默认值的防漂移闸），
 * 以及作用域工厂的调用契约（namespace / schema / base 三件套）。
 */
import { describe, expect, it } from 'vitest'
import type { NotificationSettings } from '../shared/types.ts'
import type { SettingsScopeLike } from './ports.ts'
import {
  createNotificationSettings,
  defaultNotificationSettings,
  NOTIFICATION_SETTINGS_SCHEMA,
  SETTINGS_NAMESPACE,
} from './settings.ts'

describe('schema 与出厂值', () => {
  it('schema 解析空对象得到的默认值等于 defaultNotificationSettings（防默认值漂移）', () => {
    const resolved = NOTIFICATION_SETTINGS_SCHEMA({}) as unknown as NotificationSettings
    expect(resolved).toEqual(defaultNotificationSettings())
  })

  it('schema 接受对象数组规则（沙箱探针已实证的形态）', () => {
    const resolved = NOTIFICATION_SETTINGS_SCHEMA({
      rules: [{ id: 'r1', enabled: true, mode: 'exclude', pattern: 'preview', isRegex: false, caseSensitive: false }],
    }) as unknown as NotificationSettings
    expect(resolved.rules).toEqual([
      { id: 'r1', enabled: true, mode: 'exclude', pattern: 'preview', isRegex: false, caseSensitive: false },
    ])
  })

  it('schema 拒绝非法 mode', () => {
    // 故意构造非法输入验证运行时校验——类型层已拦住，此处显式绕过（测试的关注点是运行时行为）
    const illegal = { rules: [{ id: 'r', mode: 'bogus' }] } as never
    expect(() => NOTIFICATION_SETTINGS_SCHEMA(illegal)).toThrow()
  })
})

describe('createNotificationSettings', () => {
  it('以本模块 namespace + schema + 出厂 base 调用注入的工厂', () => {
    const calls: Array<{ namespace: string; base: unknown; schema: unknown }> = []
    const factory = <T>(namespace: string, schema: unknown, base: Partial<T>): SettingsScopeLike<T> => {
      calls.push({ namespace, schema, base })
      const value = { ...(base as T) }
      return { get: () => value, update: async () => {}, watch: () => () => {} }
    }
    createNotificationSettings(factory, { enabled: false })
    expect(calls[0]?.namespace).toBe(SETTINGS_NAMESPACE)
    expect(calls[0]?.schema).toBe(NOTIFICATION_SETTINGS_SCHEMA)
    // base 覆盖出厂值，其余字段保持出厂默认
    expect(calls[0]?.base).toMatchObject({ enabled: false, notifyCompleted: true, backgroundOnly: true })
  })
})
