/**
 * 自动开页面（L3 行为编排）：快捷方式启动（DSH_LAUNCHER=1）+ autoOpen 开启时，
 * 等 webServer 就绪（带 token URL 探测）后经 open-webui.ps1 打开页面（PWA 窗口优先）。
 * 从 index.js「5.」段原样搬入（P2-B5）。
 */
import http from 'node:http'
import type { LogFn } from '../types.ts'
import { openBrowser } from '../io/pwa.ts'
import { readWebuiUrl } from '../io/state.ts'

export interface AutoOpenDeps {
  /** 官方服务取用窄面（webServer → port / loader → await）。 */
  getService: (name: string) => unknown
  launcherDir: string
  /** 裸探测回退端口（webui-url.txt 未落盘的旧版 dsh 场景）。 */
  configPort: number
  /** 在线客户端数读取（close-to-exit 属主）——已有页面在线则不重复开浏览器。 */
  getClientsOnline: () => number
  logMsg: LogFn
}

export function setupAutoOpen(deps: AutoOpenDeps): void {
  const { getService, launcherDir, configPort, getClientsOnline, logMsg } = deps

  // 页面就绪（探测返回 2xx）后再开浏览器——socket 绑定 ≠ 静态资源/fallback 就绪，
  // 过早打开会白屏/进不去（"第一次打不开、点刷新就好"的时序根因）。
  // 超时（15s）则仍尝试打开，不阻塞启动。
  // 0.1.2 起 WebUI 带一次性 token 鉴权：裸 / 永远 401，探测必须带 token——
  // 直接用 apply 时落盘的 webui-url.txt（conn.authenticatedUrl 生成的带 token 地址），
  // 返回 2xx = 索引与静态资源真实就绪。旧版 dsh 无 token URL 时退回裸 / 探测。
  const waitForPageReady = (port: number, timeoutMs: number, cb: (ready: boolean) => void): void => {
    const started = Date.now()
    // 探测目标必须经 state 口（readWebuiUrl：webui-url.json 优先 → 旧 txt 回退）。
    // 0.4.1 JSON 化时本处漏改、仍在读 webui-url.txt（已停产）→ 永远 miss → 裸探测在
    // rc.2 一次性 token 鉴权下 401 循环 15s 超时（真机 2026-09-24 实测 probe took
    // 15355ms；残留 txt 时代基准 38ms）。读到带 token URL = 探测直接验证索引与静态资源就绪。
    let probeTarget: string | null = null
    const saved = readWebuiUrl(launcherDir)
    if (saved?.url && saved.url.startsWith('http')) probeTarget = saved.url
    const probe = (): void => {
      // 裸探测回退 = 带 path 的同源 URL 字符串（与对象形式 http.get({host,port,path}) 等价）
      const req = http.get(probeTarget ?? `http://127.0.0.1:${port}/`, { timeout: 2000 }, (res) => {
        res.resume()
        if (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 400) { cb(true); return }
        retry()
      })
      req.on('error', retry)
      req.on('timeout', () => {
        req.destroy()
        retry()
      })
    }
    const retry = (): void => {
      if (Date.now() - started > timeoutMs) { cb(false); return }
      setTimeout(probe, 500)
    }
    probe()
  }

  const attempt = (): boolean => {
    const webServer = getService('webServer') as { port?: number } | undefined
    const port = webServer?.port
    if (port === undefined) return false
    // 启动耗时指标（v0.4.1 优化数据源）：页面就绪探测总时长 = 后端可服务速度的直接反映
    const probeT0 = Date.now()
    waitForPageReady(port, 15000, (ready) => {
      // 已有页面在线（launch.cmd openLine / 用户已手动打开）→ 不再开浏览器，
      // 避免"先起前端再起后端"的双开（日志实锤：online 早于 auto-open）。
      const online = getClientsOnline()
      if (online > 0) {
        logMsg(`[auto-open] page already online (clients=${online}), skip auto-open (probe took ${Date.now() - probeT0}ms)`)
        return
      }
      if (!ready) logMsg(`[auto-open] page not ready within 15s (probe took ${Date.now() - probeT0}ms), opening anyway`)
      else logMsg(`[auto-open] page ready (HTTP 2xx) in ${Date.now() - probeT0}ms, opening browser (port=${port})`)
      setTimeout(() => openBrowser(port, launcherDir, logMsg), 200)
    })
    return true
  }
  const settled = (getService('loader') as { await?: () => Promise<void> } | undefined)?.await?.()
  if (settled === undefined) {
    attempt()
    return
  }
  settled.then(
    () => {
      if (attempt()) return
      // Fallback poll: runner 可能比 socket 绑定早一步 settle
      let tries = 0
      const timer = setInterval(() => {
        tries += 1
        if (attempt() || tries >= 20) clearInterval(timer)
      }, 500)
    },
    () => {},
  )
}
