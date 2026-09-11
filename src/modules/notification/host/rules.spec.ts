/**
 * 规则校验单测：空 pattern、非法正则、首条错误定位。
 * 用例逐条迁移自上游 `tests/rules.spec.ts` 的 `ruleError` / `firstRuleError`。
 */
import { describe, expect, it } from 'vitest'
import { testRule } from '../shared/fixtures.ts'
import { firstRuleError, ruleError } from './rules.ts'

describe('ruleError', () => {
  it('空 pattern 报无效', () => {
    expect(ruleError(testRule({ pattern: '  ' }))).toBe('settings.rules.invalid')
  })

  it('非法正则报无效正则', () => {
    expect(ruleError(testRule({ pattern: '(', isRegex: true }))).toBe('settings.rules.invalidRegex')
  })

  it('合法规则通过', () => {
    expect(ruleError(testRule({ pattern: 'deploy' }))).toBeUndefined()
  })

  it('非正则模式下不校验正则', () => {
    expect(ruleError(testRule({ pattern: '(', isRegex: false }))).toBeUndefined()
  })
})

describe('firstRuleError', () => {
  it('返回第一条非法规则的下标与原因', () => {
    const rules = [testRule({ pattern: '' }), testRule({ id: 'r2', pattern: 'ok' })]
    expect(firstRuleError(rules)).toEqual({ index: 0, key: 'settings.rules.invalid' })
  })

  it('全部合法时返回 undefined', () => {
    expect(firstRuleError([testRule({ pattern: 'ok' })])).toBeUndefined()
    expect(firstRuleError([])).toBeUndefined()
  })
})
