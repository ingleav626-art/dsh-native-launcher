/**
 * 规则纯函数：写入前校验 + 编辑助手——host 与 client 半区的**同一份实现**。
 *
 * 逐字移植自上游 dsh-notification `src/client/rules.ts`（6 个函数，含注释语义）。
 * 上游这段只跑在 client（保存按钮的禁用逻辑）；本项目规则由 host 持久化，于是同一实现
 * 被两侧使用：client 用它拦下"填了空 pattern 就点保存"，host 用它拦下非法落库——
 * 一份口径两处把关，杜绝"UI 放行、host 拒绝"的漂移。
 *
 * 位置记账（P1 曾放 host/rules.ts，本次随 client 卡片落地**上移到 shared/**）：
 * 校验与编辑助手都被两半区消费，按"能否一句话说清职责"的分层规则，它属于 shared 而非 host。
 */
import type { NotificationRule } from './types.ts'

/** 校验失败的提示键（与上游字符串逐字一致，UI 侧映射中文）。 */
export type RuleErrorKey = 'settings.rules.invalid' | 'settings.rules.invalidRegex'

/** 铸造一条新规则的稳定 id（client 与 Node 均提供 `crypto`）。 */
export function mintRuleId(): string {
  return crypto.randomUUID()
}

/** 一条可编辑的空 include 规则。 */
export function emptyRule(): NotificationRule {
  return { id: mintRuleId(), enabled: true, mode: 'include', pattern: '', isRegex: false, caseSensitive: false }
}

/**
 * 校验一条草稿规则：返回阻塞原因，或 undefined 表示合法。
 * @param rule - 待校验规则。
 * @returns 错误键，或合法时的 undefined。
 */
export function ruleError(rule: NotificationRule): RuleErrorKey | undefined {
  if (rule.pattern.trim() === '') return 'settings.rules.invalid'
  if (rule.isRegex) {
    try {
      new RegExp(rule.pattern)
    } catch {
      return 'settings.rules.invalidRegex'
    }
  }
  return undefined
}

/** 列表中第一条非法规则（含下标），全部合法时 undefined。 */
export function firstRuleError(
  rules: readonly NotificationRule[],
): { index: number; key: RuleErrorKey } | undefined {
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index]
    if (rule === undefined) continue
    const key = ruleError(rule)
    if (key !== undefined) return { index, key }
  }
  return undefined
}

/**
 * 按 id 替换一条规则，返回新数组（不可变更新）。
 * @param rules - 草稿列表。
 * @param id - 被替换的规则 id。
 * @param patch - 合并到该规则上的字段。
 * @returns 更新后的列表。
 */
export function patchRule(
  rules: readonly NotificationRule[],
  id: string,
  patch: Partial<NotificationRule>,
): NotificationRule[] {
  return rules.map(rule => (rule.id === id ? { ...rule, ...patch } : rule))
}

/** 按 id 删除一条规则，返回新数组。 */
export function removeRule(rules: readonly NotificationRule[], id: string): NotificationRule[] {
  return rules.filter(rule => rule.id !== id)
}
