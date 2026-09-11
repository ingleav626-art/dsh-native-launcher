/**
 * 决策引擎单测：reason 映射、规则匹配、include/exclude 语义、shouldNotify 总闸。
 * 用例逐条迁移自上游 `tests/decision.spec.ts`。
 */
import { describe, expect, it } from 'vitest'
import { testRule, testSettings } from '../shared/fixtures.ts'
import { asReason, reasonEnabled, ruleMatches, ruleSubject, rulesAllow, shouldNotify } from './filter.ts'

describe('asReason', () => {
  it('映射五种已知原因，拒绝未知', () => {
    expect(asReason('completed')).toBe('completed')
    expect(asReason('max-tokens')).toBe('max-tokens')
    expect(asReason('interrupted')).toBeUndefined()
    expect(asReason(undefined)).toBeUndefined()
  })
})

describe('reasonEnabled', () => {
  it('每种原因映射到各自的开关', () => {
    const s = testSettings({ notifyAborted: true, notifyMaxTokens: true, notifyError: false })
    expect(reasonEnabled(s, 'completed')).toBe(true)
    expect(reasonEnabled(s, 'aborted')).toBe(true)
    expect(reasonEnabled(s, 'max-tokens')).toBe(true)
    expect(reasonEnabled(s, 'error')).toBe(false)
    expect(reasonEnabled(s, 'blocked')).toBe(false)
  })
})

describe('ruleSubject', () => {
  it('拼接标题、正文与工具名', () => {
    expect(ruleSubject('Deploy the app', 'deploy done', ['bash', 'edit'])).toBe(['Deploy the app', 'deploy done', 'bash edit'].join('\n'))
  })

  it('省略缺席的标题与空正文', () => {
    expect(ruleSubject(undefined, '', [])).toBe('')
    expect(ruleSubject('Only title', '', [])).toBe('Only title')
  })
})

describe('ruleMatches', () => {
  it('默认按字面子串、不区分大小写匹配', () => {
    expect(ruleMatches(testRule({ pattern: 'Deploy' }), 'the deploy succeeded')).toBe(true)
  })

  it('要求区分大小写时严格匹配', () => {
    expect(ruleMatches(testRule({ pattern: 'Deploy', caseSensitive: true }), 'the deploy succeeded')).toBe(false)
    expect(ruleMatches(testRule({ pattern: 'Deploy', caseSensitive: true }), 'Deploy succeeded')).toBe(true)
  })

  it('按正则匹配并尊重大小写设置', () => {
    expect(ruleMatches(testRule({ pattern: 'deploy(ed|ing)', isRegex: true }), 'it is deploying')).toBe(true)
    expect(ruleMatches(testRule({ pattern: '^ERROR', isRegex: true, caseSensitive: true }), 'error happened')).toBe(false)
  })
})

describe('rulesAllow', () => {
  it('无规则时放行', () => {
    expect(rulesAllow(testSettings(), 'anything')).toBe(true)
  })

  it('任一 exclude 命中即抑制', () => {
    const s = testSettings({ rules: [testRule({ mode: 'exclude', pattern: 'preview' })] })
    expect(rulesAllow(s, 'running a preview build')).toBe(false)
    expect(rulesAllow(s, 'running a real build')).toBe(true)
  })

  it('存在 include 规则时必须至少一条命中', () => {
    const s = testSettings({ rules: [testRule({ mode: 'include', pattern: 'deploy' })] })
    expect(rulesAllow(s, 'deploy finished')).toBe(true)
    expect(rulesAllow(s, 'tests finished')).toBe(false)
  })

  it('禁用的规则不参与判定', () => {
    const s = testSettings({ rules: [testRule({ mode: 'exclude', pattern: 'preview', enabled: false })] })
    expect(rulesAllow(s, 'running a preview build')).toBe(true)
  })
})

describe('shouldNotify', () => {
  it('依次受总开关、原因开关、规则约束', () => {
    expect(shouldNotify(testSettings({ enabled: false }), 'completed', 'done')).toBe(false)
    expect(shouldNotify(testSettings(), 'blocked', 'waiting')).toBe(false)
    expect(shouldNotify(testSettings({ rules: [testRule({ mode: 'exclude', pattern: 'preview' })] }), 'completed', 'preview done')).toBe(false)
    expect(shouldNotify(testSettings(), 'completed', 'done')).toBe(true)
  })
})
