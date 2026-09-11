/**
 * 通知投影的折（fold）：把会话日志折成「最近一次已完成 turn」的有界摘要。
 *
 * 移植自上游 dsh-notification `src/projection.ts`（逐字核对语义）。与上游的**有意差异**（记账）：
 * - 上游用 zod 写 `stateSchema` / `viewSchema`；本项目改手写 `{ parse }` 解析器
 *   ——沙箱探针实证：投影接缝只调用 `parse`，手写对象可注册成功并进快照（省掉整个 zod 依赖）
 * - 事件入参为窄形状 {@link SessionEventLike}（模块不依赖官方包），边界做最小字段守卫：
 *   形状漂移时退回原状态而不是折出脏数据
 *
 * 不变量（对齐上游）：无趣的事件返回**同一引用**——变更流用 `Object.is` 判定是否上报。
 */
import type {
  MessageContentBlock,
  NotificationProjectionState,
  NotificationProjectionValue,
  SessionEventLike,
} from '../shared/types.ts'
import type { ProjectionDefinitionLike } from './ports.ts'

/** 折叠参数（模块配置）。 */
export interface ResolvedConfig {
  /** 回复正文的字符预算；超出即截断，保证持久状态不无限增长。 */
  readonly maxBodyChars: number
}

/** 空日志视图（尚无已完成 turn）。 */
export const EMPTY_PROJECTION: NotificationProjectionValue = Object.freeze({
  turn: 0,
  reason: '',
  body: '',
  tools: Object.freeze([]) as readonly string[],
})

/**
 * 把一段回复限制在预算内，溢出用省略号收尾（保留预算长度）。
 * @param text - 累积的回复正文。
 * @param maxChars - 字符预算。
 * @returns 有界文本。
 */
export function boundText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars - 1) + '…'
}

/** 安全读取对象记录（非对象/数组值为 undefined）。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** 安全读取有限数字。 */
function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 读取事件数据里的 turn 序号；形状不符返回 undefined。 */
function readTurn(event: SessionEventLike): number | undefined {
  return asFiniteNumber(asRecord(event.data)?.turn)
}

/** 累加一条 assistant 消息里的全部 text 块。 */
function accumulateText(content: readonly MessageContentBlock[]): string {
  let text = ''
  for (const block of content) {
    const record = asRecord(block)
    if (record?.type === 'text' && typeof record.text === 'string') text += record.text
  }
  return text
}

/**
 * 把一个已提交事件折进状态。无趣事件返回同一引用。
 * @param state - 覆盖此前全部事件的状态。
 * @param event - 下一个已提交事件。
 * @param maxChars - 正文预算。
 * @returns 下一个状态。
 */
export function applyProjectionEvent(
  state: NotificationProjectionState,
  event: SessionEventLike,
  maxChars: number,
): NotificationProjectionState {
  switch (event.type) {
    case 'turn/start': {
      const turn = readTurn(event)
      if (turn === undefined) return state
      return { ...state, openTurn: { turn, text: '', tools: [] } }
    }
    case 'assistant/message': {
      const open = state.openTurn
      if (open === null) return state
      const turn = readTurn(event)
      if (turn === undefined || open.turn !== turn) return state
      const content = asRecord(asRecord(event.data)?.message)?.content
      if (!Array.isArray(content)) return state
      let text = open.text + accumulateText(content as readonly MessageContentBlock[])
      if (text.length > maxChars) text = boundText(text, maxChars)
      if (text === open.text) return state
      return { ...state, openTurn: { ...open, text } }
    }
    case 'tool/call': {
      const open = state.openTurn
      if (open === null) return state
      const turn = readTurn(event)
      const name = asRecord(event.data)?.name
      if (turn === undefined || open.turn !== turn || typeof name !== 'string') return state
      if (open.tools.includes(name)) return state
      return { ...state, openTurn: { ...open, tools: [...open.tools, name] } }
    }
    case 'turn/end': {
      const open = state.openTurn
      if (open === null) return state
      const turn = readTurn(event)
      const kind = asRecord(asRecord(event.data)?.reason)?.kind
      if (turn === undefined || open.turn !== turn || typeof kind !== 'string') return state
      return {
        openTurn: null,
        last: { turn, reason: kind, body: open.text.trim(), tools: open.tools },
      }
    }
    default:
      return state
  }
}

/** 校验字符串数组；非数组或含非字符串项即抛错。 */
function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`${label} 必须是字符串数组`)
  }
  return value as string[]
}

/** 校验投影视图（对齐上游 `viewSchema.strict()`）。 */
export function parseProjectionValue(value: unknown): NotificationProjectionValue {
  const record = asRecord(value)
  if (record === undefined) throw new TypeError('投影值必须是对象')
  const turn = asFiniteNumber(record.turn)
  if (turn === undefined || !Number.isInteger(turn) || turn < 0) throw new TypeError('turn 必须是非负整数')
  if (typeof record.reason !== 'string') throw new TypeError('reason 必须是字符串')
  if (typeof record.body !== 'string') throw new TypeError('body 必须是字符串')
  return { turn, reason: record.reason, body: record.body, tools: parseStringArray(record.tools, 'tools') }
}

/** 校验持久 fold 状态（对齐上游 `stateSchema.strict()`）。 */
export function parseProjectionState(value: unknown): NotificationProjectionState {
  const record = asRecord(value)
  if (record === undefined) throw new TypeError('投影状态必须是对象')
  const rawOpen = record.openTurn
  let openTurn: NotificationProjectionState['openTurn'] = null
  if (rawOpen !== null && rawOpen !== undefined) {
    const open = asRecord(rawOpen)
    if (open === undefined) throw new TypeError('openTurn 必须是对象或 null')
    const turn = asFiniteNumber(open.turn)
    if (turn === undefined || !Number.isInteger(turn) || turn < 0) throw new TypeError('openTurn.turn 必须是非负整数')
    if (typeof open.text !== 'string') throw new TypeError('openTurn.text 必须是字符串')
    openTurn = { turn, text: open.text, tools: parseStringArray(open.tools, 'openTurn.tools') }
  }
  const rawLast = record.last
  const last = rawLast === null || rawLast === undefined ? null : parseProjectionValue(rawLast)
  return { openTurn, last }
}

/**
 * 构建 `notification` 投影单元。
 * 注册是调用方 fiber 上的 effect：卸载即摘键（官方 0.1.5 契约）。
 * @param config - 已解析的模块配置（正文预算）。
 * @returns 注册到投影接缝的定义。
 */
export function notificationProjection(config: ResolvedConfig): ProjectionDefinitionLike {
  return {
    key: 'notification',
    stateSchema: { parse: parseProjectionState },
    init: () => ({ openTurn: null, last: null }),
    apply: (state, event) => applyProjectionEvent(state as NotificationProjectionState, event, config.maxBodyChars),
    wire: {
      viewSchema: { parse: parseProjectionValue },
      view: (state) => (state as NotificationProjectionState).last ?? EMPTY_PROJECTION,
    },
    stateVersion: 1,
  }
}
