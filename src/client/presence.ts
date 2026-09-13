/**
 * UI 存在态传感器：把**只有浏览器才知道**的两个输入报给 host。
 *
 * 为什么需要（2026-09-11 用户质询后补回）：设置里的 `backgroundOnly`（"仅在任务不在眼前时通知"）
 * 在上游是 client 侧判定（`document.hidden || !document.hasFocus()` + 当前会话 id）。决策收归 host 后，
 * host 看不到这两项，开关一度形同虚设——用户实测"人在页面前也弹通知"。
 *
 * 设计纪律（与 pending 传感器一致）：只观察、只上报，不做任何决策；去重后上报（状态没变不发），
 * 页面关闭时**不发"关闭"**（浏览器不给我们这个机会）——host 侧靠 TTL 判定失联（见 presence.ts）。
 */
import { clientWarn } from './log.ts'
import { RPC_PATH, type ClientContextLike, type RpcFace } from './types.ts'

/** 上报形状（必须与 host 侧 `isPresenceReport` 对齐）。 */
export interface PresenceState {
  /** 页面是否在前台（`!hidden && hasFocus`）。 */
  readonly visible: boolean
  /** 正在查看的会话 id；未知时缺省。 */
  readonly activeSessionId?: string
}

/** 官方会话列表快照里我们读的字段（`current` = 当前查看的会话）。 */
interface SessionsListState {
  readonly current?: unknown
}

/** 官方会话列表 store 的窄面。 */
interface SessionsServiceLike {
  readonly list?: { getSnapshot(): SessionsListState; subscribe(listener: () => void): unknown }
}

/** 读一次当前存在态（读失败按"不可见"处理——宁可多弹，不可静默漏掉）。 */
function readPresence(ctx: ClientContextLike): PresenceState {
  let visible = false
  try {
    visible = document.hidden !== true && document.hasFocus() === true
  } catch {
    visible = false
  }
  let activeSessionId: string | undefined
  try {
    const sessions = ctx.get('sessions') as SessionsServiceLike | undefined
    const current = sessions?.list?.getSnapshot()?.current
    if (typeof current === 'string' && current !== '') activeSessionId = current
  } catch (error) {
    clientWarn(`[presence] 读取当前会话失败（仅影响 backgroundOnly 判定）：${String(error)}`)
  }
  return activeSessionId === undefined ? { visible } : { visible, activeSessionId }
}

/** 心跳周期：必须显著小于 host 侧 `PRESENCE_TTL_MS`（15s），否则"状态不变"必然周期性过期。 */
export const PRESENCE_HEARTBEAT_MS = 5_000

/**
 * 启动存在态上报。
 * @param ctx - 官方 client ctx（只在组装根与本文件被触摸）。
 * @param report - 上报通道（组装根注入，背后是 RPC `presence-report`）。
 */
export function startPresenceReporter(ctx: ClientContextLike, report: (state: PresenceState) => void): void {
  /** 上次上报值：状态没变就不发（页面事件很密集，去重是硬要求）。 */
  let lastKey = ''

  const emit = (force = false): void => {
    const state = readPresence(ctx)
    const key = `${state.visible}|${state.activeSessionId ?? ''}`
    if (!force && key === lastKey) return
    lastKey = key
    report(state)
  }

  try {
    emit()   // 首报：页面刚加载（host 侧据此知道"有人在看某个会话"）
    window.addEventListener('focus', () => emit())
    window.addEventListener('blur', () => emit())
    document.addEventListener('visibilitychange', () => emit())
    const sessions = ctx.get('sessions') as SessionsServiceLike | undefined
    if (sessions?.list !== undefined && typeof sessions.list.subscribe === 'function') {
      // 切换会话（当前查看的会话变了）→ 存在态变了
      sessions.list.subscribe(() => emit())
    }
    // 心跳（2026-09-13 真机实锤的缺失半边）：host 按 TTL 判"上报是否新鲜"，超过 15s 即当作
    // "页面不在眼前"→ 放行通知。只靠上面那些**边沿事件**上报，用户坐在页面前超过 15 秒就会被
    // 当成失联——这正是"人在眼前照样弹"的根因（日志里表现为时好时坏：挡住的那几次都发生在某个
    // 页面事件之后的 15 秒内）。去重拦的是"事件风暴"，不能拿它当新鲜度。
    // 浏览器对**后台标签页**的定时器有节流（隐藏后 ~1 次/分钟），于是语义天然正确：
    // 前台 → 心跳新鲜 → 抑制；切后台/关页面 → 心跳变慢或停止 → TTL 过期 → 照常通知。
    setInterval(() => emit(true), PRESENCE_HEARTBEAT_MS)
  } catch (error) {
    clientWarn(`[presence] 传感器启动失败（backgroundOnly 将退化为"总是通知"）：${String(error)}`)
  }
}

/** 组装根用的上报通道工厂（RPC 面 → 尽力而为的发送函数）。 */
export function createPresenceSender(rpc: RpcFace): (state: PresenceState) => void {
  return state => {
    try {
      void rpc.call(RPC_PATH, 'presence-report', state).catch(() => {})
    } catch {
      // 静默：存在态上报失败只影响"是否打扰"，绝不能拖累 UI
    }
  }
}
