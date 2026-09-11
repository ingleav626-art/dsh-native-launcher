/**
 * 测试夹具（**仅供 spec 使用**，不进生产包）。
 *
 * 事件形状取自 0.1.5-rc.2 官方 `dsh-session/lib/types/types.d.ts`（沙箱探针合成事件已实证），
 * 设置默认值对齐上游 `src/client/store.ts` 的 `defaultNotificationSettings`。
 */
import type { NotificationRule, NotificationSettings, SessionEventLike } from './types.ts'

/** 出厂设置（逐字对齐上游 defaultNotificationSettings）。 */
export function defaultNotificationSettings(): NotificationSettings {
  return {
    enabled: true,
    notifyCompleted: true,
    notifyError: true,
    notifyAborted: false,
    notifyBlocked: false,
    notifyMaxTokens: false,
    notifyApproval: true,
    notifyQuestion: true,
    notifyPlanReview: false,
    rules: [],
    requireInteraction: false,
    backgroundOnly: true,
  }
}

/** 设置夹具。 */
export function testSettings(overrides: Partial<NotificationSettings> = {}): NotificationSettings {
  return { ...defaultNotificationSettings(), ...overrides }
}

/** 规则夹具（默认一条启用的 include 子串规则）。 */
export function testRule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return { id: 'r1', enabled: true, mode: 'include', pattern: 'deploy', isRegex: false, caseSensitive: false, ...overrides }
}

/** 构造 `turn/start` 事件。 */
export function turnStartEvent(turn: number): SessionEventLike {
  return { type: 'turn/start', data: { turn } }
}

/** 构造 `assistant/message` 事件（单个 text 块）。 */
export function assistantEvent(turn: number, text: string): SessionEventLike {
  return {
    type: 'assistant/message',
    data: { turn, step: 1, message: { content: [{ type: 'text', text }], source: { provider: 'test', model: 'test' } } },
  }
}

/** 构造 `tool/call` 事件。 */
export function toolCallEvent(turn: number, name: string): SessionEventLike {
  return { type: 'tool/call', data: { turn, step: 1, callId: `call-${name}`, name, arguments: '{}' } }
}

/** 构造 `turn/end` 事件。 */
export function turnEndEvent(turn: number, kind: string): SessionEventLike {
  return { type: 'turn/end', data: { turn, reason: { kind } } }
}
