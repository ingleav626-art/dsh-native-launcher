/**
 * 通知的外在呈现标签与文案：分组 tag、标题、正文回退。
 *
 * 移植自上游 dsh-notification `src/client/notifier.ts` 的纯字符串部分
 * （`notificationTag` / `pendingNotificationTag` / `titleKey` / `pendingTitleKey` / `bodyText`）。
 * 上游的半区（`shouldShow` / `notificationsApi` / `createBrowserNotification`）是浏览器语义——本项目砍掉。
 *
 * 放 shared 是因为 host 与将来的独立 client 半区都要用同一套标识。
 */
import type { NotificationReason, PendingKind } from './types.ts'

/**
 * turn 级通知标签：每个会话每个 turn 一个槽位。
 * 必须 turn 级（而非会话级）——系统会替换同 tag 通知，而通知中心里的同 tag 残留会静默吞掉后续通知
 * （上游 notifier.ts 注释的血泪教训）。
 */
export function notificationTag(sessionId: string, turn: number): string {
  return `dsh-notification-${sessionId}-${turn}`
}

/** 等待交互通知的标签：一个会话内每次等待一个唯一序号。 */
export function pendingNotificationTag(sessionId: string, sequence: number): string {
  return `dsh-notification-pending-${sessionId}-${sequence}`
}

/** turn 结束原因 → 通知标题（托盘通道使用中文，与官方界面语言一致）。 */
export function titleFor(reason: NotificationReason): string {
  switch (reason) {
    case 'completed': return '任务完成'
    case 'error': return '任务出错'
    case 'aborted': return '任务已中止'
    case 'blocked': return '任务被阻塞'
    case 'max-tokens': return '达到 token 上限'
  }
}

/** 等待交互种类 → 通知标题。 */
export function pendingTitleFor(kind: PendingKind): string {
  switch (kind) {
    case 'approval': return '等待你的批准'
    case 'question': return '等待你的回答'
    case 'plan-review': return '等待计划评审'
  }
}

/** 通知正文：回复片段，或空正文回退文案。 */
export function bodyText(body: string, emptyBody: string): string {
  const trimmed = body.trim()
  return trimmed === '' ? emptyBody : trimmed
}
