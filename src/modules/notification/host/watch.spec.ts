/**
 * watch 接线单测：启动播种、变更流推进触发、同 turn 不重复、规则抑制、会话消失清理。
 * 链路走真实的 notifier / planner / signals，只把投影接缝、会话服务、投递端口换成替身。
 */
import { describe, expect, it } from 'vitest'
import { testSettings } from '../shared/fixtures.ts'
import type { NotificationProjectionValue, NotificationSettings, TrayNotification } from '../shared/types.ts'
import { createNotifier } from './notifier.ts'
import type { LoggerPort, ProjectionPort, SessionIdentityLike, SessionSummaryLike, SessionsPort } from './ports.ts'
import { createWatcher, type WatchDeps } from './watch.ts'

const silentLogger: LoggerPort = { info: () => {}, warn: () => {}, fail: () => {} }

/** 投影接缝替身：可注入快照，可手动触发变更流（接缝是外部边界，换成可驱动的替身）。 */
function fakeProjections(snapshots: Map<string, NotificationProjectionValue>) {
  let listener: ((session: SessionIdentityLike, key: string, value: unknown, seq: number) => void) | undefined
  const port: ProjectionPort = {
    register: () => {},
    onChanged: (next) => {
      listener = next
      return () => { listener = undefined }
    },
    snapshot: (session) => {
      const value = snapshots.get(session.id)
      return value === undefined ? {} : { notification: value }
    },
  }
  return {
    port,
    emit(session: SessionIdentityLike, value: NotificationProjectionValue | undefined, seq = 1): void {
      listener?.(session, 'notification', value, seq)
    },
    emitOtherKey(session: SessionIdentityLike): void {
      listener?.(session, 'title', 'x', 1)
    },
  }
}

/** 会话服务替身。 */
function fakeSessions(rows: SessionSummaryLike[]): SessionsPort {
  const byId = new Map(rows.map(row => [row.id, row]))
  return { list: () => [...byId.values()], get: id => byId.get(id) }
}

function setup(options: {
  snapshots?: Map<string, NotificationProjectionValue>
  sessions: SessionSummaryLike[]
  settings?: NotificationSettings
}) {
  const delivered: TrayNotification[] = []
  const snapshots = options.snapshots ?? new Map<string, NotificationProjectionValue>()
  const projections = fakeProjections(snapshots)
  const notifier = createNotifier({ notify: { notify: n => { delivered.push(n) } }, logger: silentLogger })
  const deps: WatchDeps = {
    projections: projections.port,
    sessions: fakeSessions(options.sessions),
    settings: () => options.settings ?? testSettings(),
    notifier,
    logger: silentLogger,
  }
  return { delivered, projections, watcher: createWatcher(deps) }
}

const completed = (turn: number, body = 'done'): NotificationProjectionValue => ({ turn, reason: 'completed', body, tools: [] })

describe('createWatcher', () => {
  it('启动播种已有会话，不补历史通知', () => {
    const snapshots = new Map([['s1', completed(3, 'old')]])
    const { delivered, watcher } = setup({ snapshots, sessions: [{ id: 's1', title: 'Deploy' }] })
    watcher.start()
    expect(delivered).toHaveLength(0)
  })

  it('投影 turn 推进时投递一条完成通知（标题/正文/tag 正确）', () => {
    const snapshots = new Map<string, NotificationProjectionValue>([['s1', completed(1)]])
    const { delivered, projections, watcher } = setup({ snapshots, sessions: [{ id: 's1', title: 'Deploy' }] })
    watcher.start()
    snapshots.set('s1', completed(2, 'all green'))
    projections.emit({ id: 's1' }, completed(2, 'all green'))
    expect(delivered).toEqual([{ title: '任务完成', body: 'all green', tag: 'dsh-notification-s1-2' }])
  })

  it('同一 turn 的重复回调不重复投递（变更流可能对同一 seq 重放）', () => {
    const snapshots = new Map<string, NotificationProjectionValue>([['s1', completed(1)]])
    const { delivered, projections, watcher } = setup({ snapshots, sessions: [{ id: 's1', title: 'Deploy' }] })
    watcher.start()
    projections.emit({ id: 's1' }, completed(1), 5)
    expect(delivered).toHaveLength(0)
  })

  it('未推进（重放）时留下**每会话每 turn 一次**的日志：排查"通知弹两次/该弹没弹"靠它', () => {
    const lines: string[] = []
    const snapshots = new Map<string, NotificationProjectionValue>([['s1', completed(1)]])
    const projections = fakeProjections(snapshots)
    const notifier = createNotifier({ notify: { notify: () => {} }, logger: silentLogger })
    const watcher = createWatcher({
      projections: projections.port,
      sessions: fakeSessions([{ id: 's1', title: 'Deploy' }]),
      settings: () => testSettings(),
      notifier,
      logger: { info: message => { lines.push(message) }, warn: () => {}, fail: () => {} },
    })
    watcher.start()
    // 同一 turn 重放三次（官方变更流对每个 committed event 都会回调）
    projections.emit({ id: 's1' }, completed(1), 5)
    projections.emit({ id: 's1' }, completed(1), 5)
    projections.emit({ id: 's1' }, completed(1), 5)
    const stale = lines.filter(line => line.includes('未推进'))
    expect(stale).toHaveLength(1)
    expect(stale[0]).toContain('turn 1')
    expect(stale[0]).toContain('session=s1')
  })

  it('非本模块的投影键被忽略', () => {
    const { delivered, projections, watcher } = setup({ sessions: [{ id: 's1', title: 'Deploy' }] })
    watcher.start()
    projections.emitOtherKey({ id: 's1' })
    expect(delivered).toHaveLength(0)
  })

  it('规则抑制时不投递（规则作用于标题与正文）', () => {
    const snapshots = new Map<string, NotificationProjectionValue>([['s1', completed(1)]])
    const { delivered, projections, watcher } = setup({
      snapshots,
      sessions: [{ id: 's1', title: 'Deploy' }],
      settings: testSettings({ rules: [{ id: 'r1', enabled: true, mode: 'exclude', pattern: 'preview', isRegex: false, caseSensitive: false }] }),
    })
    watcher.start()
    snapshots.set('s1', completed(2, 'preview build'))
    projections.emit({ id: 's1' }, completed(2, 'preview build'))
    expect(delivered).toHaveLength(0)
  })

  it('subagent 会话不投递', () => {
    const snapshots = new Map<string, NotificationProjectionValue>([['s1', completed(1)]])
    const { delivered, projections, watcher } = setup({ snapshots, sessions: [{ id: 's1', title: 'Deploy', origin: 'subagent' }] })
    watcher.start()
    snapshots.set('s1', completed(2))
    projections.emit({ id: 's1' }, completed(2))
    expect(delivered).toHaveLength(0)
  })

  it('会话消失后观察表与去重记录被清理（重建会话重新播种）', () => {
    const snapshots = new Map<string, NotificationProjectionValue>([['s1', completed(1)]])
    const rows: SessionSummaryLike[] = [{ id: 's1', title: 'Deploy' }]
    const delivered: TrayNotification[] = []
    const projections = fakeProjections(snapshots)
    const notifier = createNotifier({ notify: { notify: n => { delivered.push(n) } }, logger: silentLogger })
    const watcher = createWatcher({
      projections: projections.port,
      sessions: { list: () => [...rows], get: id => rows.find(row => row.id === id) },
      settings: () => testSettings(),
      notifier,
      logger: silentLogger,
    })
    watcher.start()
    snapshots.set('s1', completed(2))
    projections.emit({ id: 's1' }, completed(2))
    expect(delivered).toHaveLength(1)
    // 会话消失：列表清空后重新播种应清理其记录
    rows.length = 0
    const stop = watcher.start()
    expect(notifier.rememberedCount()).toBe(0)
    stop()
  })

  it('回归（E2E 抓到）：订阅后新出现的会话，首个完成 turn 必须通知', () => {
    // 主场景：页面开着 → 新建会话 → 跑第一个任务。change feed 首次见到该会话就是
    // 它首个 turn/end；若按「首见播种」处理，这个完成永远不弹（第二个任务才弹）。
    const { delivered, projections, watcher } = setup({ sessions: [] })
    watcher.start()
    expect(delivered).toHaveLength(0)
    projections.emit({ id: 'new-1' }, completed(1, '第一个任务的回复'))
    expect(delivered).toEqual([{ title: '任务完成', body: '第一个任务的回复', tag: 'dsh-notification-new-1-1' }])
  })
})
