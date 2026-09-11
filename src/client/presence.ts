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

/**
 * 启动存在态上报。
 * @param ctx - 官方 client ctx（只在组装根与本文件被触摸）。
 * @param report - 上报通道（组装根注入，背后是 RPC `presence-report`）。
 */
export function startPresenceReporter(ctx: ClientContextLike, report: (state: PresenceState) => void): void {
  /** 上次上报值：状态没变就不发（页面事件很密集，去重是硬要求）。 */
  let lastKey = ''

  const emit = (): void => {
    const state = readPresence(ctx)
    const key = `${state.visible}|${state.activeSessionId ?? ''}`
    if (key === lastKey) return
    lastKey = key
    report(state)
  }

  try {
    emit()   // 首报：页面刚加载（host 侧据此知道"有人在看某个会话"）
    window.addEventListener('focus', emit)
    window.addEventListener('blur', emit)
    document.addEventListener('visibilitychange', emit)
    const sessions = ctx.get('sessions') as SessionsServiceLike | undefined
    if (sessions?.list !== undefined && typeof sessions.list.subscribe === 'function') {
      // 切换会话（当前查看的会话变了）→ 存在态变了
      sessions.list.subscribe(emit)
    }
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
