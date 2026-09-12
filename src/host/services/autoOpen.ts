/**
 * 自动开页面（L3 行为编排）：快捷方式启动（DSH_LAUNCHER=1）+ autoOpen 开启时，
 * 等 webServer 就绪（带 token URL 探测）后经 open-webui.ps1 打开页面（PWA 窗口优先）。
 * 从 index.js「5.」段原样搬入（P2-B5）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import http from 'node:http'
import type { LogFn } from '../types.ts'
import { openBrowser } from '../io/pwa.ts'

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
    let probeTarget: string | null = null
    try {
      const saved = readFileSync(join(launcherDir, 'webui-url.txt'), 'utf8').trim()
      if (saved.startsWith('http')) probeTarget = saved
    } catch { /* 尚未落盘则走裸探测 */ }
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
    waitForPageReady(port, 15000, (ready) => {
      // 已有页面在线（launch.cmd openLine / 用户已手动打开）→ 不再开浏览器，
      // 避免"先起前端再起后端"的双开（日志实锤：online 早于 auto-open）。
      const online = getClientsOnline()
      if (online > 0) {
        logMsg(`[auto-open] page already online (clients=${online}), skip auto-open`)
        return
      }
      if (!ready) logMsg('[auto-open] page not ready within 15s, opening anyway')
      else logMsg(`[auto-open] page ready (HTTP 2xx), opening browser (port=${port})`)
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
