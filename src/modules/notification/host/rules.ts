/**
 * 规则写入前的校验（host 侧把关）。
 *
 * 移植自上游 dsh-notification `src/client/rules.ts` 的 `ruleError` / `firstRuleError`
 * （逐字核对语义）。上游这段在 client（保存按钮禁用逻辑），本项目规则由 host 持久化，
 * 故校验权收归 host：非法规则不得落进 settings namespace。
 * 上游同文件的 UI 编辑助手（mintRuleId / emptyRule / patchRule / removeRule）留在 client 侧（P3）。
 */
import type { NotificationRule } from '../shared/types.ts'

/** 校验失败的提示键（与上游字符串逐字一致，UI 可直接复用字典）。 */
export type RuleErrorKey = 'settings.rules.invalid' | 'settings.rules.invalidRegex'

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
export function firstRuleError(rules: readonly NotificationRule[]): { index: number; key: RuleErrorKey } | undefined {
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index]
    if (rule === undefined) continue
    const key = ruleError(rule)
    if (key !== undefined) return { index, key }
  }
  return undefined
}
