/**
 * 规则纯函数单测：校验（host 写入把关 + client 保存按钮共用）与编辑助手。
 *
 * 用例逐条迁移自上游 `tests/rules.spec.ts` 的 `ruleError` / `firstRuleError`，
 * 编辑助手（mintRuleId / emptyRule / patchRule / removeRule）的用例为本项目新增
 * ——它们此前只在编译产物的 bundle 里，没有测试覆盖。
 *
 * 每个用例写明预期与理由；纯函数表驱动（AGENTS.md 测试原则五）。
 */
import { describe, expect, it } from 'vitest'
import { testRule } from './fixtures.ts'
import { emptyRule, firstRuleError, mintRuleId, patchRule, removeRule, ruleError } from './rules.ts'

describe('ruleError', () => {
  it('空 pattern 报无效（含纯空白——保存按钮据此禁用）', () => {
    expect(ruleError(testRule({ pattern: '  ' }))).toBe('settings.rules.invalid')
    expect(ruleError(testRule({ pattern: '' }))).toBe('settings.rules.invalid')
  })

  it('非法正则报无效正则', () => {
    expect(ruleError(testRule({ pattern: '(', isRegex: true }))).toBe('settings.rules.invalidRegex')
  })

  it('合法规则通过', () => {
    expect(ruleError(testRule({ pattern: 'deploy' }))).toBeUndefined()
  })

  it('非正则模式下不校验正则（`(` 是合法字面量）', () => {
    expect(ruleError(testRule({ pattern: '(', isRegex: false }))).toBeUndefined()
  })
})

describe('firstRuleError', () => {
  it('返回第一条非法规则的下标与原因（决定错误提示挂在哪一行）', () => {
    const rules = [testRule({ pattern: '' }), testRule({ id: 'r2', pattern: 'ok' })]
    expect(firstRuleError(rules)).toEqual({ index: 0, key: 'settings.rules.invalid' })
  })

  it('只报第一条：两行都错时下标为 0', () => {
    const rules = [testRule({ pattern: '' }), testRule({ id: 'r2', pattern: '(' , isRegex: true })]
    expect(firstRuleError(rules)?.index).toBe(0)
  })

  it('全部合法时返回 undefined', () => {
    expect(firstRuleError([testRule({ pattern: 'ok' })])).toBeUndefined()
    expect(firstRuleError([])).toBeUndefined()
  })
})

describe('编辑助手', () => {
  it('mintRuleId 每次给出不同 id（规则行以 id 为 key，重复会串行）', () => {
    const ids = new Set([mintRuleId(), mintRuleId(), mintRuleId()])
    expect(ids.size).toBe(3)
  })

  it('emptyRule 是可直接编辑的 include 规则（上游出厂形状，含 enabled=true）', () => {
    const rule = emptyRule()
    expect(rule).toMatchObject({ enabled: true, mode: 'include', pattern: '', isRegex: false, caseSensitive: false })
    // 新规则立马非法（pattern 空）——保存按钮据此保持禁用，直到用户填写
    expect(ruleError(rule)).toBe('settings.rules.invalid')
  })

  it('patchRule 只改目标行、返回新数组（原数组不被修改：React 状态依赖引用变化）', () => {
    const rules = [testRule({ id: 'a', pattern: 'x' }), testRule({ id: 'b', pattern: 'y' })]
    const next = patchRule(rules, 'b', { pattern: 'z', isRegex: true })
    expect(next).not.toBe(rules)
    expect(next[0]).toBe(rules[0])
    expect(next[1]).toMatchObject({ id: 'b', pattern: 'z', isRegex: true })
    expect(rules[1]?.pattern).toBe('y')
  })

  it('patchRule 目标 id 不存在时列表内容不变', () => {
    const rules = [testRule({ id: 'a', pattern: 'x' })]
    expect(patchRule(rules, 'missing', { pattern: 'z' })[0]?.pattern).toBe('x')
  })

  it('removeRule 按 id 删除且不动其他行', () => {
    const rules = [testRule({ id: 'a' }), testRule({ id: 'b' }), testRule({ id: 'c' })]
    expect(removeRule(rules, 'b').map(rule => rule.id)).toEqual(['a', 'c'])
    expect(removeRule(rules, 'missing')).toHaveLength(3)
  })
})
