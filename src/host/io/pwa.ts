/**
 * PWA 安装检测与静态路由（L2 副作用边界）。
 * 从 index.js 原样搬入（P2-B3）；registerPwaRoutes 窄面化：只收 webServer（不再收整个 ctx）。
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { LogFn, WebServerFace } from '../types.ts';
import { logsDirOf } from '../core/paths.ts';
import { ensureSquareIconPng, extractPngBuffer } from './icon.ts';

/**
 * 扫描 Edge 已安装的 PWA：新版 Edge 的应用数据在
 * %LOCALAPPDATA%\Microsoft\Edge\User Data\<profile>\Web Applications\Manifest Resources\<app_id>\Icons\
 * 返回匹配站点的 app_id（供 --app-id 启动已安装应用）。
 * 归属校验：读 Preferences 的 app_banner 段，确认 127.0.0.1:<port> 有安装提示记录。
 * 每一步都写 debug 日志（logs/pwa-scan.log），找不到时原因一目了然。
 */
export function findInstalledPwaAppId(port: number, launcherDir: string): string | null {
  const log: string[] = [];
  const writeLog = (msg: string): void => {
    log.push(`[${new Date().toISOString()}] ${msg}`);
    try {
      appendFileSync(join(logsDirOf(launcherDir), 'pwa-scan.log'), log[log.length - 1] + '\r\n');
    } catch {}
  };
  try {
    const local = process.env.LOCALAPPDATA;
    writeLog(`LOCALAPPDATA=${local}`);
    if (!local) {
      writeLog('LOCALAPPDATA missing');
      return null;
    }
    const base = join(local, 'Microsoft', 'Edge', 'User Data');
    writeLog(`base=${base} exists=${existsSync(base)}`);
    if (!existsSync(base)) return null;
    const needle = `127.0.0.1:${String(port)}`;
    const profileNames = readdirSync(base).filter((n) => /^(Default|Profile \d+)$/.test(n));
    writeLog(`profiles=${JSON.stringify(profileNames)}`);
    const prefPaths = profileNames.map((n) => join(base, n, 'Preferences')).filter((p) => existsSync(p));
    writeLog(`prefPaths=${JSON.stringify(prefPaths)}`);
    let urlKnown = false;
    for (const p of prefPaths) {
      try {
        if (readFileSync(p, 'utf-8').includes(needle)) {
          urlKnown = true;
          break;
        }
      } catch (e) {
        writeLog(`pref read fail ${p}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    writeLog(`urlKnown=${urlKnown}`);
    for (const profile of profileNames) {
      const mr = join(base, profile, 'Web Applications', 'Manifest Resources');
      writeLog(`check mr=${mr} exists=${existsSync(mr)}`);
      if (!existsSync(mr)) continue;
      for (const id of readdirSync(mr)) {
        const icons = join(mr, id, 'Icons');
        writeLog(`  candidate=${id} icons=${existsSync(icons)}`);
        if (existsSync(icons)) {
          writeLog(`FOUND app_id=${id}`);
          return id;
        }
      }
    }
    writeLog('RESULT: null (no installed pwa found)');
  } catch (error) {
    writeLog(`EXCEPTION: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
  return null;
}

/**
 * 注册 PWA 静态路由：真实 URL 的 manifest + 方形 PNG 图标。
 * Chromium 的可安装性检查只认能 fetch 到的 http(s) manifest（blob/data URL 均被拒），
 * 且图标需 ≥144px 栅格图（dsh 自带 manifest 只有 SVG，不满足——这就是安装提示一直不出现的根因）。
 */
export function registerPwaRoutes(webServer: WebServerFace, launcherDir: string, iconPath: string | null, logMsg: LogFn): void {
  const png = ensureSquareIconPng(launcherDir, extractPngBuffer(iconPath) ?? Buffer.alloc(0), logMsg);
  if (!png || png.length === 0) {
    logMsg('pwa icon extract failed, routes skipped');
    return;
  }
  const manifestJson = JSON.stringify({
    id: '/native-launcher',
    name: 'DSH WebUI',
    short_name: 'DSH WebUI',
    description: 'DeepSeek Harness Web UI',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#141414',
    theme_color: '#141414',
    icons: [{ src: '/native-launcher/icon.png', sizes: '256x256', type: 'image/png', purpose: 'any' }],
  });
  try {
    webServer.register({
      kind: 'exact',
      path: '/native-launcher/manifest.webmanifest',
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(manifestJson);
      },
    });
    webServer.register({
      kind: 'exact',
      path: '/native-launcher/icon.png',
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(png);
      },
    });
    logMsg('pwa routes registered');
  } catch (error) {
    logMsg(`pwa route registration failed: ${error}`);
  }
}

/** 在默认浏览器的独立窗口中打开 dsh web（走生成的 open-webui.ps1，new-window 模式）。 */
export function openBrowser(port: number, launcherDir: string, logMsg: LogFn): boolean {
  try {
    const openScriptPath = join(launcherDir, 'open-webui.ps1');
    if (existsSync(openScriptPath)) {
      spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', openScriptPath], { stdio: 'ignore', windowsHide: true });
    } else {
      spawnSync('cmd', ['/c', 'start', '', `http://127.0.0.1:${String(port)}`], { stdio: 'ignore', windowsHide: true });
    }
    return true;
  } catch (error) {
    logMsg(`open browser failed: ${error}`);
    return false;
  }
}
