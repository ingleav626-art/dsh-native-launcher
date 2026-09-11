/**
 * 转场状态机单测：投影 turn 推进与等待交互边沿。
 * 用例逐条迁移自上游 `tests/runner.spec.ts` 的 `projectionAdvance` / `pendingAdvance`。
 */
import { describe, expect, it } from 'vitest'
import { pendingAdvance, projectionAdvance } from './signals.ts'

describe('projectionAdvance', () => {
  it('首次观察只播种，不触发', () => {
    const seeded = projectionAdvance(undefined, { turn: 5, reason: 'completed', body: 'old', tools: [] })
    expect(seeded).toEqual({ nextTurn: 5, fresh: false })
  })

  it('仅在投影 turn 推进时触发', () => {
    expect(projectionAdvance(5, { turn: 6, reason: 'completed', body: 'new', tools: [] })).toEqual({ nextTurn: 6, fresh: true })
    expect(projectionAdvance(6, { turn: 6, reason: 'completed', body: 'new', tools: [] })).toEqual({ nextTurn: 6, fresh: false })
  })

  it('投影缺席视为 turn 0', () => {
    expect(projectionAdvance(undefined, undefined)).toEqual({ nextTurn: 0, fresh: false })
    expect(projectionAdvance(0, { turn: 1, reason: 'completed', body: 'first', tools: [] })).toEqual({ nextTurn: 1, fresh: true })
  })

  it('turn 回退（会话被重置）只更新基线，不误报完成', () => {
    expect(projectionAdvance(7, { turn: 2, reason: 'completed', body: 'x', tools: [] })).toEqual({ nextTurn: 2, fresh: false })
  })
})

describe('pendingAdvance', () => {
  it('播种当前状态，之后检出新的等待', () => {
    expect(pendingAdvance(undefined, 'question')).toEqual({ kind: 'question', fresh: false })
    expect(pendingAdvance({ kind: undefined }, 'question')).toEqual({ kind: 'question', fresh: true })
    expect(pendingAdvance({ kind: 'question' }, undefined)).toEqual({ kind: undefined, fresh: false })
  })

  it('等待种类变化也算新的等待', () => {
    expect(pendingAdvance({ kind: 'approval' }, 'plan-review')).toEqual({ kind: 'plan-review', fresh: true })
  })

  it('同一种等待持续存在时不重复触发', () => {
    expect(pendingAdvance({ kind: 'approval' }, 'approval')).toEqual({ kind: 'approval', fresh: false })
  })
})
