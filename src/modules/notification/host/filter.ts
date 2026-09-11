/**
 * 通知决策引擎：reason 映射、include/exclude 规则语义、通知门槛判定。
 *
 * 移植自上游 dsh-notification `src/client/decision.ts`（逐字核对语义）。纯函数、零 IO——
 * 上游把这段放在 client，本项目收归 host（决策权在 host，client 只做传感器）。
 */
import type { NotificationReason, NotificationRule, NotificationSettings, PendingKind } from '../shared/types.ts'

/** 把原始投影 reason 映射为可通知 reason；未知种类返回 undefined。 */
export function asReason(reason: string | undefined): NotificationReason | undefined {
  switch (reason) {
    case 'completed':
    case 'error':
    case 'aborted':
    case 'blocked':
    case 'max-tokens':
      return reason
    default:
      return undefined
  }
}

/** 某个 turn 结束原因对应的开关是否打开。 */
export function reasonEnabled(settings: NotificationSettings, reason: NotificationReason): boolean {
  switch (reason) {
    case 'completed': return settings.notifyCompleted
    case 'error': return settings.notifyError
    case 'aborted': return settings.notifyAborted
    case 'blocked': return settings.notifyBlocked
    case 'max-tokens': return settings.notifyMaxTokens
  }
}

/** 某类等待交互对应的开关是否打开。 */
export function pendingReasonEnabled(settings: NotificationSettings, kind: PendingKind): boolean {
  switch (kind) {
    case 'approval': return settings.notifyApproval
    case 'question': return settings.notifyQuestion
    case 'plan-review': return settings.notifyPlanReview
  }
}

/** 规则匹配的文本主体：会话标题、回复正文、工具名。 */
export function ruleSubject(title: string | undefined, body: string, tools: readonly string[]): string {
  const parts: string[] = []
  if (title !== undefined && title.trim() !== '') parts.push(title)
  if (body.trim() !== '') parts.push(body)
  if (tools.length > 0) parts.push(tools.join(' '))
  return parts.join('\n')
}

/** 单条规则是否命中主体。 */
export function ruleMatches(rule: NotificationRule, subject: string): boolean {
  if (rule.isRegex) {
    const flags = rule.caseSensitive ? '' : 'i'
    return new RegExp(rule.pattern, flags).test(subject)
  }
  const haystack = rule.caseSensitive ? subject : subject.toLowerCase()
  const needle = rule.caseSensitive ? rule.pattern : rule.pattern.toLowerCase()
  return haystack.includes(needle)
}

/**
 * 对主体求值 include/exclude 规则：任一 exclude 命中即抑制；
 * 存在 include 规则时至少一条须命中；无规则则放行。
 */
export function rulesAllow(settings: NotificationSettings, subject: string): boolean {
  const active = settings.rules.filter(rule => rule.enabled)
  const includes = active.filter(rule => rule.mode === 'include')
  const excludes = active.filter(rule => rule.mode === 'exclude')
  if (excludes.some(rule => ruleMatches(rule, subject))) return false
  if (includes.length > 0 && !includes.some(rule => ruleMatches(rule, subject))) return false
  return true
}

/** 一次任务完成通知的完整判定（不含任何浏览器/宿主读取）。 */
export function shouldNotify(
  settings: NotificationSettings,
  reason: NotificationReason,
  subject: string,
): boolean {
  if (!settings.enabled) return false
  if (!reasonEnabled(settings, reason)) return false
  return rulesAllow(settings, subject)
}
