/**
 * pending 传感器（方案 2 的 client 侧）：观察"会话正在等待什么"→ **变化才上报**，
 * 决策与投递全在 host（托盘通道）。
 *
 * 为什么存在：question / plan-review 不是会话日志事件、也不是持久事件——它们是 Host waterfall
 * 派给 client 的活内存态，host 侧无可观测面（REFACTOR_PLAN P1·X 实验 4 实证）。故 client 保留
 * 这个薄传感器：只上报，不决策、不投递。
 *
 * 与旧实现（P1-e-2 写在 `lib/client.js` 里的那段）的差异——**含一处 bug 修复**（记账）：
 * 旧实现用 `observed.get(id) === kind` 判重，于是"没见过的会话 + 无等待"被判成"无变化"而不上报；
 * host 侧靠**首次上报**播种（首见只播种、不通知），播种缺失使该会话此后第一次真实等待
 * （审批/提问）被 host 当作首见吞掉——表现为"每个会话的第一次等待通知不弹"。
 * 现改为"未记录过 或 等待态变化"即上报。
 */
import type { PendingKind } from '../shared/types.ts'
import type { ClientLoggerPort, PendingFeedPort, PendingObservation, PendingReportPort } from './ports.ts'

/** 传感器依赖（全部为注入窄接口）。 */
export interface PendingReporterDeps {
  readonly feed: PendingFeedPort
  readonly report: PendingReportPort
  readonly logger: ClientLoggerPort
}

/** pending 传感器。 */
export interface PendingReporter {
  /** 订阅等待态；返回退订函数。 */
  start(): () => void
}

/**
 * 创建 pending 传感器。
 * @param deps - 观测源 / 上报通道 / 日志。
 */
export function createPendingReporter(deps: PendingReporterDeps): PendingReporter {
  /** 每会话上次观察到的等待种类（undefined = 无等待）。 */
  const observed = new Map<string, PendingKind | undefined>()
  let stopped = false
  /** 首扫是否已留痕（host 日志要能回答"传感器到底起没起来"）。 */
  let announced = false

  /** 一次快照 → 只上报「首见」或「等待态变化」的会话（省 RPC；host 靠首见完成播种）。 */
  const scan = (items: readonly PendingObservation[]): void => {
    if (stopped) return
    const live = new Set<string>()
    let reported = 0
    for (const item of items) {
      live.add(item.sessionId)
      if (observed.has(item.sessionId) && observed.get(item.sessionId) === item.kind) continue
      observed.set(item.sessionId, item.kind)
      reported += 1
      deps.report.report(item)
    }
    // 会话消失即清状态：下次再见到它时按首见处理（会话 id 不复用，语义正确）
    for (const sessionId of [...observed.keys()]) {
      if (!live.has(sessionId)) observed.delete(sessionId)
    }
    if (!announced) {
      announced = true
      deps.logger.info(`[pending] 传感器已启动：首扫 ${items.length} 个会话、播种上报 ${reported} 次`)
    }
  }

  return {
    start() {
      try {
        deps.feed.subscribe(scan)
      } catch (error) {
        deps.logger.warn(`[pending] 等待态订阅失败（等待类通知将不弹）：${String(error)}`)
      }
      return () => { stopped = true }
    },
  }
}
