/**
 * 通知 v2 共享类型：决策引擎词汇表（reason / 规则 / 设置 / 通知计划）。
 *
 * 移植自上游 dsh-notification src/contract.ts 与 src/client/runner.ts 的纯类型
 * （上游仓库本地克隆已实证，可读源码逐字核对）。按 v2 决策裁剪：
 * - 投影 wire 类型（NotificationProjectionValue / State）不移植——v2 弃投影
 * - 信号侧类型（SummaryShape）待 P1 summary 字段普查后冻结，另立文件
 * - settings 持久化位置变更：上游存 client localStorage，v2 存 host settings
 *   namespace（字段集合以 P1 schemastery schema 定稿为准，此处先保上游全集）
 */

/** turn 结束原因——已知五种可通知；未知种类忽略（上游 decision.ts asReason 对齐）。 */
export type NotificationReason = 'completed' | 'error' | 'aborted' | 'blocked' | 'max-tokens'

/** 会话阻塞等待用户交互的种类（0.1.5 summary.pendingInteraction 实证存活）。 */
export type PendingKind = 'approval' | 'question' | 'plan-review'

/** 一条 include/exclude 关键字规则；匹配对象为会话标题、回复正文与工具名拼接。 */
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

/** 通知偏好设置（字段全集对齐上游 defaultNotificationSettings；P1 定稿时可裁剪）。 */
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
  /** 上游为浏览器通知语义；v2 托盘通道是否沿用待 P1 定，先保留字段。 */
  readonly requireInteraction: boolean
  /** 仅在目标不在前台时通知（语义随通道在 P1 细化）。 */
  readonly backgroundOnly: boolean
}

/** 一条已决策、待投递的任务完成通知（上游 runner.ts NotificationPlan）。 */
export interface NotificationPlan {
  readonly reason: NotificationReason
  readonly body: string
  readonly tag: string
}

/** 一条已决策、待投递的等待交互通知（上游 runner.ts PendingNotificationPlan）。 */
export interface PendingNotificationPlan {
  readonly kind: PendingKind
  readonly body: string
  readonly tag: string
}
