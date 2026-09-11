/**
 * 投影 fold 单测：把会话日志折成「最近一次已完成 turn」的有界摘要。
 *
 * 用例对齐上游 `tests/projection.spec.ts`（逐条迁移）；事件用本地夹具构造
 * （形状取自官方 .d.ts，上游用 `@deepseek-ai/dsh-llm` 的工厂——本项目模块不依赖官方包）。
 * 新增用例：形状漂移（缺字段/非数组）时守卫必须退回原状态，不得折出脏数据。
 */
import { describe, expect, it } from 'vitest'
import { assistantEvent, toolCallEvent, turnEndEvent, turnStartEvent } from '../shared/fixtures.ts'
import type { NotificationProjectionState, NotificationProjectionValue, SessionEventLike } from '../shared/types.ts'
import {
  EMPTY_PROJECTION,
  applyProjectionEvent,
  boundText,
  notificationProjection,
  parseProjectionValue,
  type ResolvedConfig,
} from './fold.ts'

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return { maxBodyChars: 400, ...overrides }
}

function fold(events: readonly SessionEventLike[], cfg: ResolvedConfig): NotificationProjectionValue {
  let state: NotificationProjectionState = { openTurn: null, last: null }
  for (const event of events) state = applyProjectionEvent(state, event, cfg.maxBodyChars)
  return notificationProjection(cfg).wire.view(state) as NotificationProjectionValue
}

describe('boundText', () => {
  it('返回不超预算的原文', () => {
    expect(boundText('done', 10)).toBe('done')
  })

  it('超预算时截断并以省略号收尾（总长等于预算）', () => {
    expect(boundText('1234567890', 5)).toBe('1234…')
  })
})

describe('applyProjectionEvent', () => {
  it('把一轮完成折成 last 摘要：正文累加、工具名去重保序、reason 记录', () => {
    const value = fold([
      turnStartEvent(1),
      assistantEvent(1, 'deploy '),
      assistantEvent(1, 'done'),
      toolCallEvent(1, 'bash'),
      toolCallEvent(1, 'bash'),
      toolCallEvent(1, 'edit'),
      turnEndEvent(1, 'completed'),
    ], config())
    expect(value).toEqual({ turn: 1, reason: 'completed', body: 'deploy done', tools: ['bash', 'edit'] })
  })

  it('首个 turn 完成前返回空视图', () => {
    expect(fold([], config())).toEqual(EMPTY_PROJECTION)
    expect(fold([turnStartEvent(1), assistantEvent(1, 'hi')], config())).toEqual(EMPTY_PROJECTION)
  })

  it('按配置预算截断正文', () => {
    const value = fold([
      turnStartEvent(1),
      assistantEvent(1, '1234567890'),
      turnEndEvent(1, 'completed'),
    ], config({ maxBodyChars: 5 }))
    expect(value.body).toBe('1234…')
  })

  it('忽略不属于当前 open turn 的事件', () => {
    const value = fold([
      turnStartEvent(1),
      assistantEvent(2, 'ignored'),
      turnEndEvent(1, 'error'),
    ], config())
    expect(value).toMatchObject({ turn: 1, reason: 'error', body: '' })
  })

  it('原样记录非完成原因', () => {
    const value = fold([turnStartEvent(1), turnEndEvent(1, 'blocked')], config())
    expect(value.reason).toBe('blocked')
  })

  it('无趣事件返回同一引用（Object.is 是变更流的闸门）', () => {
    const state: NotificationProjectionState = { openTurn: null, last: null }
    expect(applyProjectionEvent(state, { type: 'session/title', data: { title: 'x' } }, 400)).toBe(state)
  })

  it('形状漂移时退回原状态而不是折出脏数据', () => {
    const open: NotificationProjectionState = { openTurn: { turn: 1, text: 'hi', tools: [] }, last: null }
    // 缺 turn
    expect(applyProjectionEvent(open, { type: 'assistant/message', data: { message: { content: [] } } }, 400)).toBe(open)
    // content 非数组
    expect(applyProjectionEvent(open, { type: 'assistant/message', data: { turn: 1, message: { content: 'oops' } } }, 400)).toBe(open)
    // name 非字符串
    expect(applyProjectionEvent(open, { type: 'tool/call', data: { turn: 1, name: 42 } }, 400)).toBe(open)
    // reason 缺 kind
    expect(applyProjectionEvent(open, { type: 'turn/end', data: { turn: 1, reason: {} } }, 400)).toBe(open)
  })

  it('定义携带 key / stateVersion，且两个 schema 均可解析自身产物', () => {
    const def = notificationProjection(config())
    expect(def.key).toBe('notification')
    expect(def.stateVersion).toBe(1)
    expect(def.stateSchema.parse({ openTurn: null, last: null })).toEqual({ openTurn: null, last: null })
    expect(def.wire.viewSchema.parse(EMPTY_PROJECTION)).toEqual(EMPTY_PROJECTION)
  })

  it('schema 拒绝非法形状（非负整数 turn、对象 last）', () => {
    expect(() => parseProjectionValue({ turn: -1, reason: '', body: '', tools: [] })).toThrow()
    expect(() => parseProjectionValue({ turn: 1.5, reason: '', body: '', tools: [] })).toThrow()
    expect(() => parseProjectionValue({ turn: 1, reason: '', body: '', tools: [1] })).toThrow()
    expect(() => notificationProjection(config()).stateSchema.parse({ openTurn: 'x', last: null })).toThrow()
  })
})
