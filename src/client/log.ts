/**
 * client 侧日志：**只回传 host**（落 `native-launcher.log` 的 `[ntf]` 域），**不写浏览器 console**。
 *
 * 为什么不写 console（2026-09-11 用户定调，也是原实现的纪律"写 host 日志，不污染浏览器 console"）：
 * - 浏览器 console 没有规范（谁都能打、格式各异、随刷新丢失、多个页面各一份）；
 * - 用户排查时看不到（要开 DevTools，还得复现一次）；
 * - 我们（维护者）事后也拿不到——**host 日志才是唯一带历史的事实源**（轮转归档、可 grep、可归档为证据）。
 * 所以 client 侧一切打点都走 RPC `ntf-log` 端点，与 host 的 `logMsg / logWarn / logFail` 汇进同一份日志、
 * 同一套 `[ts] [LEVEL] [domain]` 行格式。
 *
 * 两条纪律：
 * - **去重**：同一条（kind + message）永久只发一次（刷屏会淹没真异常，no-projection 教训）；
 * - **分层**：发送端由组装根注入（`configureClientLog`），本文件不碰官方 ctx，也不碰任何 DOM/网络 API。
 */

/** 已上报过的事件键（永久去重，不复位：client 生命周期与页面同寿）。 */
const reported = new Set<string>()

/** host 日志回传通道（组装根注入；未注入时事件丢弃——绝无 console 退路）。 */
export type ClientLogSender = (payload: Record<string, unknown>) => void

let sender: ClientLogSender | undefined

/**
 * 注入/清除 host 日志回传通道。
 * @param next - 发送函数（组装根用 `ctx.connection.rpc` 或兜底直连构造）；传 undefined 表示停用。
 */
export function configureClientLog(next: ClientLogSender | undefined): void {
  sender = next
}

/**
 * 记一条 client 侧事件（唯一出口 = host 日志）。
 * @param kind - 事件类型（机器可读标识，如 `pending-report-failed`）。
 * @param data - 附加字段（`message` 兼作人类可读摘要与去重键）。
 */
export function clientLog(kind: string, data: Record<string, unknown> = {}): void {
  const key = kind + '|' + String(data.message ?? JSON.stringify(data))
  if (reported.has(key)) return
  reported.add(key)

  const payload = { kind, t: Date.now(), ...data }
  try {
    sender?.(payload)
  } catch {
    // 回传失败不抛：日志链路绝不能拖累 UI，且此处再记日志会自激（无 console 退路是有意的）
  }
}

/** 信息级事件（人类可读摘要；host 侧落 `[ntf]` 域）。 */
export function clientInfo(message: string): void {
  clientLog('info', { message })
}

/** 告警级事件：原实现里空吞的 catch 一律走这里留痕，但绝不拖累 UI。 */
export function clientWarn(message: string): void {
  clientLog('warn', { message })
}
