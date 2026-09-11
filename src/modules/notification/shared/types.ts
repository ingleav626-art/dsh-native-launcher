/**
 * 通知模块自有类型：决策词汇表 + 投影 wire 形状 + 会话事件窄形状。
 *
 * 移植自上游 dsh-notification `src/contract.ts`（本地克隆 `D:\web\demo\test\dsh-notification-src`
 * 逐字核对）。与上游的差异（有意，记账）：
 * - 持久化位置：上游存 client localStorage，本项目存 host settings namespace——字段集合不变
 * - 事件类型：上游 `import type { SessionEvent } from '@deepseek-ai/dsh-session'`；
 *   本项目模块不依赖官方包（`link:` 安装下解析不到），改用**窄形状**（字段取自 0.1.5-rc.2 官方 .d.ts）
 */

/** turn 结束原因——五种可通知；未知种类忽略（对齐上游 decision.ts `asReason`）。 */
export type NotificationReason = 'completed' | 'error' | 'aborted' | 'blocked' | 'max-tokens'

/** 会话阻塞等待用户交互的种类。 */
export type PendingKind = 'approval' | 'question' | 'plan-review'

/** 一条 include/exclude 规则；匹配对象是「标题 + 回复正文 + 工具名」拼接。 */
export interface NotificationRule {
  /** 创建时铸造的稳定 id，编辑期间不变。 */
  readonly id: string
  /** false = 保留但忽略。 */
  readonly enabled: boolean
  /** include = 命中才通知；exclude = 命中即抑制。 */
  readonly mode: 'include' | 'exclude'
  /** 字面子串或正则表达式。 */
  readonly pattern: string
  /** true = pattern 按正则解释。 */
  readonly isRegex: boolean
  /** true = 区分大小写。 */
  readonly caseSensitive: boolean
}

/** 通知偏好设置（字段全集对齐上游 `defaultNotificationSettings`）。 */
export interface NotificationSettings {
  /** 总开关；false 全部禁用。 */
  readonly enabled: boolean
  readonly notifyCompleted: boolean
  readonly notifyError: boolean
  readonly notifyAborted: boolean
  readonly notifyBlocked: boolean
  readonly notifyMaxTokens: boolean
  /** 等待批准时通知。 */
  readonly notifyApproval: boolean
  /** 等待回答时通知。 */
  readonly notifyQuestion: boolean
  /** 等待计划评审时通知。 */
  readonly notifyPlanReview: boolean
  /** 有序 include/exclude 规则。 */
  readonly rules: NotificationRule[]
  /** 上游为浏览器通知语义（通知常驻直到用户处理）；本项目托盘通道保留字段以对齐上游设置面。 */
  readonly requireInteraction: boolean
  /** 仅在目标不在前台时通知（托盘通道下由 presence 判定）。 */
  readonly backgroundOnly: boolean
}

/**
 * 投影 wire 载荷：某会话「最近一次已完成 turn」的有界摘要。
 * 形状对齐上游 `NotificationProjectionValue`（0.1.5-rc.2 沙箱合成事件实证）。
 */
export interface NotificationProjectionValue {
  /** 最后一次结束的 turn 序号（首个 turn 完成前为 0）。 */
  readonly turn: number
  /** 原始 `TurnEndReason.kind`；未知种类由 filter 忽略。 */
  readonly reason: string
  /** 该 turn 的最终回复正文，host 侧已按预算截断。 */
  readonly body: string
  /** 该 turn 调用的工具名，首次出现序去重。 */
  readonly tools: readonly string[]
}

/** 投影的持久化 fold 状态。 */
export interface NotificationProjectionState {
  /** 进行中 turn 的正文与工具名；turn 之外为 null。 */
  readonly openTurn: { readonly turn: number; readonly text: string; readonly tools: string[] } | null
  /** 最近一次已完成 turn 的摘要；首次完成前为 null。 */
  readonly last: NotificationProjectionValue | null
}

/** 一条已决策、待投递的任务完成通知（对齐上游 runner.ts `NotificationPlan`）。 */
export interface NotificationPlan {
  readonly reason: NotificationReason
  readonly body: string
  readonly tag: string
}

/** 一条已决策、待投递的等待交互通知（对齐上游 runner.ts `PendingNotificationPlan`）。 */
export interface PendingNotificationPlan {
  readonly kind: PendingKind
  readonly body: string
  readonly tag: string
}

/** 投递给托盘的载荷（启动器投递端的入参契约）。 */
export interface TrayNotification {
  readonly title: string
  readonly body: string
  /** 通知分组标签：同一 tag 的系统通知会被替换，故必须 turn/pending 级唯一（上游 notifier.ts 注释）。 */
  readonly tag: string
  /**
   * 常驻直到用户手动处理（上游 `requireInteraction` 语义）：托盘用 `scenario="reminder"` 呈现，
   * 通知停在屏幕上不自动消失。缺省 false = 系统默认时长。
   */
  readonly persistent?: boolean
}

/**
 * 会话事件的窄形状：只声明 fold 触及的字段。
 * 字段取自 0.1.5-rc.2 官方 `dsh-session/lib/types/types.d.ts`（已实证）。
 */
export interface SessionEventLike {
  readonly type: string
  readonly data?: unknown
}

/** fold 关心的四种事件的数据形状。 */
export interface SessionEventDataMap {
  'turn/start': { readonly turn: number }
  'assistant/message': {
    readonly turn: number
    readonly message: { readonly content: readonly MessageContentBlock[] }
  }
  'tool/call': { readonly turn: number; readonly name: string }
  'turn/end': { readonly turn: number; readonly reason: { readonly kind: string } }
}

/** assistant 消息内容块：fold 只累加 `text` 块。 */
export interface MessageContentBlock {
  readonly type: string
  readonly text?: string
}
