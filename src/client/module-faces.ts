/**
 * client 侧端口适配层：把**官方 client 服务**翻译成模块的窄接口
 * （对应 host 侧的 `lib/host-ports.js`，同一思路：官方契约一变只改本文件，模块一行不动）。
 *
 * 本文件是全项目唯一触碰 `ctx.sessions` / `ctx.uiSession` / RPC 端点形状的 client 侧位置。
 */
import type { NotificationClientFace, PendingFeedPort, PendingObservation } from '../modules/notification/client/ports.ts'
import type { NotificationSettings, PendingKind } from '../modules/notification/shared/types.ts'
import { clientInfo, clientWarn } from './log.ts'
import { registerSettingsSection } from './slots.ts'
import { RPC_PATH, type ClientContextLike, type RpcFace } from './types.ts'

/** 官方响应式 store 的窄面（`getSnapshot` + `subscribe`，client 侧容器约定）。 */
interface StoreLike<S> {
  getSnapshot(): S
  subscribe(listener: () => void): unknown
}

/** 会话摘要里我们真正读的字段（官方 `SessionsListState.byId` 的值形状）。 */
interface SessionSummaryLike {
  readonly pendingInteraction?: unknown
  readonly displayTitle?: string
  readonly title?: string
  readonly origin?: string
}

/** 官方会话列表快照。 */
interface SessionsListState {
  readonly ids: readonly string[]
  readonly byId: Record<string, SessionSummaryLike | undefined | null>
}

/** 官方 `uiSession.pendingInteractions` 快照面。 */
interface PendingInteractionsState {
  get(id: string): { readonly kind?: unknown } | undefined | null
}

/** `ctx.sessions` 的窄面。 */
interface SessionsServiceLike {
  readonly list?: StoreLike<SessionsListState>
}

/** `ctx.uiSession` 的窄面。 */
interface UiSessionServiceLike {
  readonly pendingInteractions?: StoreLike<PendingInteractionsState>
}

/** 等待种类守卫：官方值不可信，非法一律按"无等待"处理。 */
function asPendingKind(value: unknown): PendingKind | undefined {
  return value === 'approval' || value === 'question' || value === 'plan-review' ? value : undefined
}

/** 非空对象守卫（跨进程返回值不可盲信）。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/**
 * 设置形状守卫：逐个校验承载语义的字段。
 * 为什么较真：RPC 拿错 namespace 或 host 侧契约漂移时，宁可按"模块不可用"显示，
 * 也不要把一坨形状不对的数据喂进卡片（非受控 checkbox 会照着默认值撒谎）。
 */
function asNotificationSettings(value: unknown): NotificationSettings | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const booleans: readonly string[] = [
    'enabled',
    'notifyCompleted',
    'notifyError',
    'notifyAborted',
    'notifyBlocked',
    'notifyMaxTokens',
    'notifyApproval',
    'notifyQuestion',
    'notifyPlanReview',
    'requireInteraction',
    'backgroundOnly',
  ]
  for (const key of booleans) {
    if (typeof record[key] !== 'boolean') return undefined
  }
  if (!Array.isArray(record.rules)) return undefined
  return record as unknown as NotificationSettings
}

/** 读模块设置（host 侧模块未启用时 ok=false → 视为不可用）。 */
async function readNotificationSettings(rpc: RpcFace): Promise<NotificationSettings | undefined> {
  const result = await rpc.call(RPC_PATH, 'notification.get', {})
  if (result === undefined || result.ok !== true) return undefined
  return asNotificationSettings(result.value)
}

/**
 * 等待态观测源：订阅官方两个 store（会话列表 + uiSession 的活内存等待态），
 * 每次快照变化归一化成一条观测列表交给传感器。
 *
 * 为什么两个 store 都要订阅：`question` / `plan-review` 只存在于 uiSession 的活内存态，
 * 会话摘要里的 `pendingInteraction` 覆盖不到（REFACTOR_PLAN P1·X 实验 4 实证）。
 */
function createPendingFeed(ctx: ClientContextLike): PendingFeedPort {
  const sessions = ctx.get('sessions') as SessionsServiceLike | undefined
  const uiSession = ctx.get('uiSession') as UiSessionServiceLike | undefined
  const listStore = sessions?.list
  const pendingStore = uiSession?.pendingInteractions

  /** 读一次快照：等待种类优先取会话摘要，退回 uiSession 的活内存态。 */
  const readItems = (): PendingObservation[] => {
    const state = listStore?.getSnapshot()
    if (state === undefined || state === null) return []
    // 快照读一次即可（原实现放在循环里逐个会话重读，结果相同但多做 N 次工作）
    const interactions = pendingStore?.getSnapshot()
    const items: PendingObservation[] = []
    for (const id of state.ids) {
      const summary = state.byId[id]
      if (summary === undefined || summary === null) continue
      items.push({
        sessionId: id,
        kind: asPendingKind(summary.pendingInteraction) ?? asPendingKind(interactions?.get(id)?.kind),
        title: summary.displayTitle ?? summary.title,
        origin: summary.origin,
      })
    }
    return items
  }

  return {
    subscribe(listener) {
      const emit = (): void => {
        try {
          listener(readItems())
        } catch (error) {
          clientWarn(`[pending] 快照处理失败（本次跳过）：${String(error)}`)
        }
      }
      if (listStore !== undefined && typeof listStore.subscribe === 'function') listStore.subscribe(emit)
      if (pendingStore !== undefined && typeof pendingStore.subscribe === 'function') pendingStore.subscribe(emit)
      // 订阅即推一次当前快照：传感器据此完成首见播种（首见不通知，故不补历史）
      emit()
    },
  }
}

/**
 * 构造通知模块 client 半区的注入面。
 * @param ctx - 官方 client ctx。
 */
export function createNotificationFace(ctx: ClientContextLike): NotificationClientFace {
  const rpc = ctx.connection?.rpc
  const logger = { info: clientInfo, warn: clientWarn }

  return {
    settings: {
      get: async () => (rpc === undefined ? undefined : readNotificationSettings(rpc)),
      set: async patch => {
        if (rpc === undefined) return false
        const result = await rpc.call(RPC_PATH, 'notification.set', { patch })
        return result !== undefined && result.ok === true
      },
    },

    section: {
      register: section => {
        registerSettingsSection(
          ctx,
          { id: section.id, order: section.order, label: section.label, inject: section.inject },
          section.component,
        )
      },
    },

    pendingFeed: createPendingFeed(ctx),

    test: {
      send: async () => {
        if (rpc === undefined) return false
        const result = await rpc.call(RPC_PATH, 'notification.test', {})
        return result !== undefined && result.ok === true
      },
    },

    pendingReport: {
      report: observation => {
        if (rpc === undefined) return
        // 尽力而为：上报失败不影响任何界面（传感器不是关键路径），故只留痕
        try {
          void rpc.call(RPC_PATH, 'pending-report', observation).catch(error => {
            clientWarn(`[pending] 上报失败（host 未收到本次等待态）：${String(error)}`)
          })
        } catch (error) {
          clientWarn(`[pending] 上报抛出：${String(error)}`)
        }
      },
    },

    logger,
  }
}
