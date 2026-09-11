/**
 * change feed 接线（L3 编排）：投影变更 → 转场判定 → 计划生成 → 投递。
 *
 * 上游把这段放在 client（订阅会话列表快照）；本项目收归 host（官方 `onChanged` 变更流），
 * 因此**与页面开关无关**——页面全关时任务完成一样能弹托盘。
 *
 * 播种语义（对齐上游）：启动时对已有会话只播种基线（`fresh=false`），历史不补通知；
 * 会话消失时清掉观察表与投递去重记录。
 */
import type { NotificationProjectionValue, NotificationSettings } from '../shared/types.ts'
import type { LoggerPort, ProjectionPort, SessionIdentityLike, SessionsPort } from './ports.ts'
import type { Notifier } from './notifier.ts'
import { notificationFor } from './planner.ts'
import { projectionAdvance } from './signals.ts'

/** watch 服务的依赖（端口注入）。 */
export interface WatchDeps {
  readonly projections: ProjectionPort
  readonly sessions: SessionsPort
  /** 读当前设置（每次决策现取，规则改动即时生效）。 */
  readonly settings: () => NotificationSettings
  readonly notifier: Notifier
  readonly logger: LoggerPort
}

/** watch 服务。 */
export interface Watcher {
  /** 播种后订阅变更流；返回取消订阅函数。 */
  start(): () => void
}

/** 把接缝给的 unknown 值窄化为投影值（形状不符即视为无投影，不猜测）。 */
function asProjectionValue(value: unknown): NotificationProjectionValue | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.turn !== 'number' || typeof record.reason !== 'string') return undefined
  if (typeof record.body !== 'string' || !Array.isArray(record.tools)) return undefined
  return {
    turn: record.turn,
    reason: record.reason,
    body: record.body,
    tools: record.tools.filter((item): item is string => typeof item === 'string'),
  }
}

/**
 * 创建 watch 服务。
 * @param deps - 投影/会话/设置/投递/日志端口。
 */
export function createWatcher(deps: WatchDeps): Watcher {
  /** 每会话最后观察到的投影 turn（首见播种，不用 `has` 判定，因为 turn 0 也是合法基线）。 */
  const observedTurn = new Map<string, number>()
  /** 已就"未推进"留痕过的 `会话|turn`（变更流每个事件都可能带同一 turn，不去重会刷屏）。 */
  const staleLogged = new Set<string>()

  const readProjection = (id: string): NotificationProjectionValue | undefined => {
    const session = deps.sessions.get(id)
    if (session === undefined) return undefined
    return asProjectionValue(deps.projections.snapshot(session, ['notification']).notification)
  }

  /** 清理已消失会话的观察表与去重记录。 */
  const dropVanished = (liveIds: ReadonlySet<string>): void => {
    for (const id of [...observedTurn.keys()]) {
      if (liveIds.has(id)) continue
      observedTurn.delete(id)
      for (const key of [...staleLogged]) {
        if (key.startsWith(`${id}|`)) staleLogged.delete(key)
      }
      deps.notifier.forgetSession(id)
    }
  }

  /** 启动播种：只记基线，不通知。 */
  const seed = (): void => {
    const summaries = deps.sessions.list()
    for (const summary of summaries) {
      observedTurn.set(summary.id, projectionAdvance(undefined, readProjection(summary.id)).nextTurn)
    }
    dropVanished(new Set(summaries.map(summary => summary.id)))
  }

  const onChanged = (session: SessionIdentityLike, key: string, value: unknown, seq: number): void => {
    if (key !== 'notification') return
    const id = session.id
    const projection = asProjectionValue(value)
    const { nextTurn, fresh } = projectionAdvance(observedTurn.get(id), projection)
    observedTurn.set(id, nextTurn)
    if (!fresh) {
      // 未推进 = 去重生效点（重放 / 已处理过的 turn）。旧 client 有 `advance-stale` 打点，
      // 迁移时丢了——这里按"每会话每 turn 一次"补回：排查"通知弹两次/该弹没弹"只看这一条。
      const turn = projection?.turn
      if (turn !== undefined && turn >= 1) {
        const staleKey = `${id}|${turn}`
        if (!staleLogged.has(staleKey)) {
          staleLogged.add(staleKey)
          deps.logger.info(`[watch] turn ${turn} 未推进（重放或已处理），跳过投递 (session=${id}, seq=${seq})`)
        }
      }
      return
    }
    const summary = deps.sessions.get(id)
    const plan = notificationFor(id, summary?.origin ?? session.origin, summary?.title, projection, deps.settings())
    if (plan === null) {
      deps.logger.info(`[watch] turn ${nextTurn} 被设置/规则抑制 (session=${id}, seq=${seq})`)
      return
    }
    deps.notifier.deliverCompletion(id, plan)
  }

  return {
    start() {
      seed()
      return deps.projections.onChanged(onChanged)
    },
  }
}
