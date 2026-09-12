/**
 * 关闭语义（L3 行为编排）：全部页面离线 + 防抖 + 任务空闲 → 官方 appExit(0) 优雅退出。
 * 从 index.js 4.7 段原样搬入（P2-B5）；P3-0c 的运行态信号修复（ctx.agents 同步服务）
 * 与等待期复查轮询（idleProbe）语义逐字保留。
 */
import type { LauncherConfig, LogFn, WebServerFace } from '../types.ts'

export interface CloseToExitDeps {
  /** 官方服务取用窄面（agents / sessions / appExit——名字即官方服务名）。 */
  getService: (name: string) => unknown
  /** online/offline 上报路由注册。 */
  webServer: WebServerFace
  /** 总开关判定结果（组装根算好：config.closeToExit !== false && DSH_LAUNCHER === '1'）。 */
  enabled: boolean
  cfg: LauncherConfig
  launcherDir: string
  debounceSeconds: number
  debounceMs: number
  finalConfirmSeconds: number
  finalConfirmMs: number
  /** 注入托盘清理（traySurvivesDsh=false 时优雅退出前清托盘）——io 实例构造注入。 */
  killExistingTrays: (dir: string, log: LogFn) => string
  logMsg: LogFn
  logWarn: LogFn
}

export interface CloseToExitHandle {
  /** 在线客户端数（autoOpen 用：已有页面在线则不重复开浏览器）。 */
  getClientsOnline(): number
}

export function setupCloseToExit(deps: CloseToExitDeps): CloseToExitHandle {
  const { webServer, enabled, cfg, launcherDir, debounceSeconds, debounceMs, finalConfirmSeconds, finalConfirmMs, logMsg, logWarn } = deps
  // 在线客户端计数（close-to-exit 与 autoOpen 共享）：autoOpen 检测到页面已在用时不再开浏览器
  let clientsOnline = 0
  try {
    // 关闭语义只对"启动器拉起"的会话生效（launch.cmd 设置 DSH_LAUNCHER=1）：
    // 命令行/npx 手动启动 = 传统服务语义（常驻，关窗不退出），与上方 autoOpen 的
    // DSH_LAUNCHER 判断对称——否则命令行启动时浏览器不自动开、却会在关窗后 20s 自杀，
    // 表现为"输入地址栏打不开"。兜底：从未有客户端 online 则本就不触发退出（安全）。
    const clients = new Map() // 在线客户端（关闭语义）
    let exitTimer: ReturnType<typeof setTimeout> | null = null
    let waitingForIdle = false
    /** 等待任务结束期间的复查定时器（见 armIdleProbe；仅等待期间存在）。显式 Node 类型（DOM/Node 混合 lib 下 clearInterval 歧义）。 */
    let idleProbe: NodeJS.Timeout | null = null

    /**
     * 运行中任务数（「等任务跑完再退」的唯一信号源）。
     *
     * 历史坑：旧实现靠 `ctx.on('agent/status')` 维护计数——该事件在 agent/session 作用域发射，
     * 插件级 ctx **0 次触发**（作用域 containment），于是 `runningCount` 恒 0，
     * 「任务在跑时关窗会等待」从未生效（关页面直接杀任务）。
     *
     * 现在改用官方**同步服务**（绕开事件作用域问题，0.1.5-rc.2 实证）：
     *   `ctx.agents`（AgentRegistry）有 `get(sessionId) → Agent`，Agent 上带 `status: 'idle' | 'running'`；
     * 于是枚举 `ctx.sessions.list()` 逐个问状态即可。同步、无订阅、无轮询定时器。
     * 服务缺失或抛错一律按 0 处理（宁可照常退出，也不让关窗语义卡死）。
     */
    let runningCount = 0
    const countRunningAgents = (): number => {
      try {
        const agents = deps.getService('agents') as { get?: (id: string) => { status?: string } | undefined } | undefined
        const sessions = deps.getService('sessions') as { list?: () => Array<{ id?: string }> } | undefined
        if (!agents || typeof agents.get !== 'function' || !sessions || typeof sessions.list !== 'function') return 0
        let running = 0
        for (const session of sessions.list()) {
          const agent = agents.get(session?.id ?? '')
          if (agent && agent.status === 'running') running += 1
        }
        return running
      } catch (error) {
        logWarn(`[close-to-exit] running 探测失败（按 0 处理）：${(error as { message?: string })?.message ?? error}`)
        return 0
      }
    }
    // 启动自检：服务可达性只报一次，省得排查时反复怀疑信号源
    const agentsProbe = deps.getService('agents') as { get?: unknown } | undefined
    runningCount = countRunningAgents()
    logMsg(`[close-to-exit] running 信号源：ctx.agents ${agentsProbe && typeof agentsProbe.get === 'function' ? 'ok' : 'unavailable'}，当前 running=${runningCount}`)

    // 关闭语义：无客户端且无任务 → 官方优雅退出（appExit = dsh-cmdline 提供的 exit 回调）
    // 关闭语义计时器：全链路留痕——触发原因 / 20s 到期状态 / 挂起 / 2s 确认 / 取消，
    // 定位"任务刚结束就想重开页面却连不上"这类时序问题只看日志即可。
    const armIdleProbe = (): void => {
      if (idleProbe) return
      logMsg('[close-to-exit] 开始复查任务状态（每 5s 一次，仅等待期间）')
      idleProbe = setInterval(() => {
        const running = countRunningAgents()
        if (running > 0) return
        disarmIdleProbe()
        logMsg('[close-to-exit] 任务已结束，重新评估退出')
        scheduleExitCheck('idle')
      }, 5000)
    }
    const disarmIdleProbe = (): void => {
      if (idleProbe === null) return
      clearInterval(idleProbe)
      idleProbe = null
    }
    const scheduleExitCheck = (reason: string): void => {
      // 每次决策现算（同步且便宜）：切页面/任务起停都可能在两次触发之间发生
      runningCount = countRunningAgents()
      if (exitTimer) {
        logMsg(`[close-to-exit] schedule skipped (already pending, reason=${reason}): clients=${clients.size}, running=${runningCount}`)
        return
      }
      logMsg(`[close-to-exit] schedule (${reason}): clients=${clients.size}, running=${runningCount}`)
      // 任务在跑 → 立即挂起等待（不设 20s 防抖），任务完成（idle）时唤醒重新计时。
      // 否则任务在 20s 防抖窗口内结束时，20s 到期会直接走 2s 确认退出——
      // 用户重开页面只剩 2s 窗口（bug：任务刚结束就想重开页面会连不上）。
      if (runningCount > 0) {
        waitingForIdle = true
        logMsg(`[close-to-exit] tasks running (${runningCount}), waiting for idle (no timer)`)
        armIdleProbe()
        return
      }
      logMsg(`[close-to-exit] no tasks, ${debounceSeconds}s debounce started`)
      exitTimer = setTimeout(() => {
        exitTimer = null
        logMsg(`[close-to-exit] ${debounceSeconds}s elapsed: clients=${clients.size}, running=${runningCount}`)
        if (clients.size > 0) return
        if (runningCount > 0) {
          waitingForIdle = true
          logMsg('[close-to-exit] tasks still running, will exit when idle (waiting)')
          armIdleProbe()
          return
        }
        logMsg(`[close-to-exit] idle, starting ${finalConfirmSeconds}s final confirm`)
        // 二次确认（默认 2s，可配）：给"页面重开请求在途"的毫秒级竞态留窗口——
        // 用户在退出瞬间重开前端时，online 请求可能正在路上
        setTimeout(() => {
          runningCount = countRunningAgents() // 确认前再算一次（2s 窗口内可能刚起来一个任务）
          if (clients.size > 0 || runningCount > 0) {
            logMsg(`[close-to-exit] client/task reappeared (clients=${clients.size}, running=${runningCount}), exit cancelled`)
            if (runningCount > 0) { waitingForIdle = true; armIdleProbe() }
            return
          }
          const appExit = deps.getService('appExit') as ((code: number) => void) | undefined
          logMsg('[close-to-exit] final confirm passed (clients=0, running=0) -> appExit(0)')
          // traySurvivesDsh=false：优雅退出（appExit）不会连带杀子进程，必须显式清托盘，
          // 否则"托盘随 dsh 退出"的承诺在关窗场景失效（强杀路径才会连带）
          if (cfg.traySurvivesDsh === false) {
            logMsg('[close-to-exit] traySurvivesDsh=false -> killing tray before exit')
            deps.killExistingTrays(launcherDir, logMsg)
          }
          if (typeof appExit === 'function') {
            try {
              appExit(0)
            } catch (error) {
              logMsg(`[close-to-exit] appExit call failed: ${error}`)
            }
          } else {
            logMsg('[close-to-exit] appExit service unavailable')
          }
        }, finalConfirmMs)
      }, debounceMs)
    }
    const cancelExit = (reason: string): void => {
      if (exitTimer) {
        clearTimeout(exitTimer)
        exitTimer = null
        logMsg(`[close-to-exit] exit check cancelled (${reason}): clients=${clients.size}, running=${runningCount}`)
      }
      if (waitingForIdle) {
        waitingForIdle = false
        disarmIdleProbe()
        logMsg(`[close-to-exit] waitingForIdle cleared (${reason}): clients=${clients.size}, running=${runningCount}`)
      }
    }

    // 运行态订阅已移除（旧 4.6 链）：
    //   ① `ctx.on('agent/status')` / `ctx.on('session/event')` 在插件 ctx 上实测 **0 次触发**
    //      （会话事件在 agent/session 作用域发射，插件级 ctx 收不到——见 AGENTS.md 官方契约纪律）；
    //   ② 通知决策已收归通知模块（投影 change feed），本体不再需要监听会话事件。
    // 运行态信号已改走**同步服务** `ctx.agents` + `ctx.sessions`（见 countRunningAgents）：
    // 「任务在跑时不退出」自 2026-09-11 起真正生效（此前 runningCount 恒 0，关窗会直接杀任务）。

    // 客户端在线/离线（关闭语义信号；pagehide + fetch keepalive 由浏览器保证送达）
    const handleClient = (action: 'online' | 'offline') => (req: unknown, res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: unknown): void }) => {
      try {
        const u = new URL((req as { url?: string }).url ?? '/', 'http://localhost')
        const id = u.searchParams.get('client')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (!id) {
          res.end('{"ok":false,"error":"missing client"}')
          return
        }
        if (action === 'online') {
          clients.set(id, true)
          cancelExit('online')
          clientsOnline = clients.size
          logMsg(`[close-to-exit] online: ${id} (clients=${clients.size})`)
        } else {
          clients.delete(id)
          clientsOnline = clients.size
          logMsg(`[close-to-exit] offline: ${id} (clients=${clients.size})`)
          if (clients.size === 0) scheduleExitCheck('offline')
        }
        res.end('{"ok":true}')
      } catch {
        try {
          res.writeHead(500)
          res.end('{"ok":false}')
        } catch {
          // ignore
        }
      }
    }
    webServer.register({ kind: 'exact', path: '/native-launcher/online', handler: handleClient('online') })
    webServer.register({ kind: 'exact', path: '/native-launcher/offline', handler: handleClient('offline') })
    logMsg(`[close-to-exit] armed (closeToExit=${enabled})`)
  } catch (error) {
    logMsg(`tray-notify/close-to-exit setup failed: ${error}`)
  }
  return { getClientsOnline: () => clientsOnline }
}
