/**
 * client 日志模块单测：抓两类真实回归。
 *
 * ① **迁移后 client 变黑箱**（2026-09-11 实际发生）：通知 React 半区被删时，client→host 的
 *    `ntf-log` 回传发送端一起没了（host 端点一直在），host 日志里再也看不到 client 侧事件。
 * ② **写浏览器 console**（2026-09-11 用户定调禁止）：console 无规范、用户看不到、我们事后也拿不到
 *    ——client 日志唯一出口是 host 日志。
 *
 * 外部边界（host 日志通道 / console）用替身，被测链路（去重状态机 + 组装 payload）走真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clientInfo, clientLog, clientWarn, configureClientLog } from './log.ts'

/** 收集上报载荷的假通道（对应 host 侧 `ntf-log` 端点）。 */
function fakeSender(): { sent: Array<Record<string, unknown>>; send: (payload: Record<string, unknown>) => void } {
  const sent: Array<Record<string, unknown>> = []
  return { sent, send: payload => { sent.push(payload) } }
}

/** console 各方法的总调用次数（必须恒为 0：client 不许写浏览器日志）。 */
function consoleSpies(): { calls: () => number } {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  )
  return { calls: () => spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0) }
}

describe('client 日志回传', () => {
  let consoleCalls: () => number

  beforeEach(() => {
    consoleCalls = consoleSpies().calls
    configureClientLog(undefined)
  })

  it('clientInfo/clientWarn 走注入通道，载荷带 kind 与时间戳', () => {
    const { sent, send } = fakeSender()
    configureClientLog(send)
    clientInfo('client 已启动')
    clientWarn('注入失败：xxx')
    expect(sent.map(item => item.kind)).toEqual(['info', 'warn'])
    expect(sent[0]?.message).toBe('client 已启动')
    expect(typeof sent[0]?.t).toBe('number')
  })

  it('任何路径都不写浏览器 console（含未配置通道 / 通道抛错）', () => {
    const { send } = fakeSender()
    configureClientLog(send)
    clientInfo('正常上报')
    clientWarn('一条告警')
    configureClientLog(() => { throw new Error('rpc 挂了') })
    clientWarn('通道故障时')
    configureClientLog(undefined)
    clientInfo('无通道时')
    expect(consoleCalls()).toBe(0)
  })

  it('同一事件只发一次（防刷屏；不同 kind 的同文案各算一条）', () => {
    const { sent, send } = fakeSender()
    configureClientLog(send)
    clientWarn('icon.get 失败：timeout')
    clientWarn('icon.get 失败：timeout')
    clientWarn('icon.get 失败：timeout')
    clientInfo('icon.get 失败：timeout')
    expect(sent).toHaveLength(2)
    expect(sent.map(item => item.kind)).toEqual(['warn', 'info'])
  })

  it('结构化事件带自定义字段（host 侧可机器解析）', () => {
    const { sent, send } = fakeSender()
    configureClientLog(send)
    clientLog('pending-report-failed', { sessionId: 's1', waitKind: 'approval' })
    expect(sent[0]).toMatchObject({ kind: 'pending-report-failed', sessionId: 's1' })
  })

  it('通道抛错不上抛，且未配置通道时也不抛（日志链路绝不拖累 UI）', () => {
    configureClientLog(() => { throw new Error('rpc 挂了') })
    expect(() => clientWarn('一条告警')).not.toThrow()
    configureClientLog(undefined)
    expect(() => clientInfo('无通道')).not.toThrow()
  })
})
