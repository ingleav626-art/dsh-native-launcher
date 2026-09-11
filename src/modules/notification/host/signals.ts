/**
 * 转场状态机：把「上一条观察」与「当前观察」折成一次转场判定。
 *
 * 移植自上游 dsh-notification `src/client/runner.ts` 的 `projectionAdvance` / `pendingAdvance`
 * （逐字核对语义）。纯函数、零 IO。**pending 的首见播种语义与上游一致**（传感器可能
 * 在等待开始后才上线，历史等待不补通知）；**projection 的首见语义与上游有意不同**
 * （见 projectionAdvance 注释——观察通道不同：列表轮询 vs 事件流）。
 * 观察表（Map）的持有归 L3 的 watch 服务，本文件不持状态。
 */
import type { NotificationProjectionValue, PendingKind } from '../shared/types.ts'

/**
 * 折一条会话的投影 turn 观察：之后任何推进都意味着宿主投影落定了一个**新的已完成
 * turn**——即要通知的新鲜值。用投影推进（而非 running 边沿）触发，消除了状态帧与
 * 投影帧的竞态，保证正文永远对应"刚完成的那一轮"。
 *
 * `prevTurn === undefined` 的语义与上游**有意不同**（记账）：上游靠列表轮询，新会话
 * 总能在 turn 0 就被看到，首见播种正确；我们的观察通道是 change feed 事件流，既有
 * 会话在启动播种时已全部入表，**订阅后首见 = 会话诞生于订阅之后**，首次见到就是它
 * 首个 turn/end——必须通知，否则主场景「页面开着跑第一个任务」静默丢失
 * （伪造官方 API 端到端测试抓到的回归，2026-09-11）。
 * @param prevTurn - 该会话上次观察到的 turn（undefined = 订阅后首见）。
 * @param projection - 当前宿主投影值（缺席 = turn 0）。
 * @returns 下一个观察 turn 及其是否越过上一条。
 */
export function projectionAdvance(
  prevTurn: number | undefined,
  projection: NotificationProjectionValue | undefined,
): { nextTurn: number; fresh: boolean } {
  const turn = projection?.turn ?? 0
  if (prevTurn === undefined) return { nextTurn: turn, fresh: turn >= 1 }
  return { nextTurn: turn, fresh: turn > prevTurn }
}

/** 折一条会话的等待交互状态并检出**新的**等待。 */
export function pendingAdvance(
  prev: { kind: PendingKind | undefined } | undefined,
  kind: PendingKind | undefined,
): { kind: PendingKind | undefined; fresh: boolean } {
  if (prev === undefined) return { kind, fresh: false }
  return { kind, fresh: kind !== undefined && kind !== prev.kind }
}
