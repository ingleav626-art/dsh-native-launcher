/**
 * 转场状态机单测：投影 turn 推进与等待交互边沿。
 * 用例逐条迁移自上游 `tests/runner.spec.ts` 的 `projectionAdvance` / `pendingAdvance`。
 */
import { describe, expect, it } from 'vitest'
import { pendingAdvance, projectionAdvance } from './signals.ts'

describe('projectionAdvance', () => {
  it('订阅后首见且已有完成 turn → 视为订阅后诞生的新会话，必须通知', () => {
    // 与上游差异（记账）：上游靠列表轮询，新会话总在 turn 0 被看到，首见播种正确；
    // 我们的 change feed 首次见到一个会话就是它首个 turn/end（view 只在 turn/end 变化），
    // 若按播种处理，主场景「页面开着跑第一个任务」会静默丢失（E2E 抓到的回归）。
    const first = projectionAdvance(undefined, { turn: 1, reason: 'completed', body: 'done', tools: [] })
    expect(first).toEqual({ nextTurn: 1, fresh: true })
  })

  it('订阅后首见但投影为空（turn 0）→ 不触发（防御：空视图本不该广播）', () => {
    expect(projectionAdvance(undefined, undefined)).toEqual({ nextTurn: 0, fresh: false })
  })

  it('启动播种路径只取 nextTurn：既有会话的历史 turn 不经 fresh 触发', () => {
    // seed() 调用方只消费 nextTurn 写观察表；fresh 为真也不会被用于投递（播种不投递）。
    const seeded = projectionAdvance(undefined, { turn: 5, reason: 'completed', body: 'old', tools: [] })
    expect(seeded.nextTurn).toBe(5)
  })

  it('仅在投影 turn 推进时触发', () => {
    expect(projectionAdvance(5, { turn: 6, reason: 'completed', body: 'new', tools: [] })).toEqual({ nextTurn: 6, fresh: true })
    expect(projectionAdvance(6, { turn: 6, reason: 'completed', body: 'new', tools: [] })).toEqual({ nextTurn: 6, fresh: false })
  })

  it('投影缺席视为 turn 0', () => {
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
