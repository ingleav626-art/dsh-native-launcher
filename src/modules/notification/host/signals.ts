/**
 * 转场状态机：把「上一条观察」与「当前观察」折成一次转场判定。
 *
 * 移植自上游 dsh-notification `src/client/runner.ts` 的 `projectionAdvance` / `pendingAdvance`
 * （逐字核对语义）。纯函数、零 IO——**首见只播种（fresh=false）**，历史不补通知。
 * 观察表（Map）的持有归 L3 的 watch 服务，本文件不持状态。
 */
import type { NotificationProjectionValue, PendingKind } from '../shared/types.ts'

/**
 * 折一条会话的投影 turn 观察：首次观察播种基线（永不触发），
 * 之后任何推进都意味着宿主投影落定了一个**新的已完成 turn**——即要通知的新鲜值。
 * 用投影推进（而非 running 边沿）触发，消除了状态帧与投影帧的竞态，
 * 保证正文永远对应"刚完成的那一轮"。
 * @param prevTurn - 该会话上次观察到的 turn（undefined = 播种）。
 * @param projection - 当前宿主投影值（缺席 = turn 0）。
 * @returns 下一个观察 turn 及其是否越过上一条。
 */
export function projectionAdvance(
  prevTurn: number | undefined,
  projection: NotificationProjectionValue | undefined,
): { nextTurn: number; fresh: boolean } {
  const turn = projection?.turn ?? 0
  return { nextTurn: turn, fresh: prevTurn !== undefined && turn > prevTurn }
}

/** 折一条会话的等待交互状态并检出**新的**等待。 */
export function pendingAdvance(
  prev: { kind: PendingKind | undefined } | undefined,
  kind: PendingKind | undefined,
): { kind: PendingKind | undefined; fresh: boolean } {
  if (prev === undefined) return { kind, fresh: false }
  return { kind, fresh: kind !== undefined && kind !== prev.kind }
}
