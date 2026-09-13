/**
 * 启动耗时计时（隐秘窗口链路）——等价双击桌面快捷方式：
 *   wscript → launcher.vbs（窗口风格 0 = 隐藏）→ launch.ps1（隐藏）→ dsh 启动
 * 计时终点 = socket ready（端口能收到 HTTP 响应），全程无窗口、无人工掐表。
 *
 * 跑法：
 *   node tools/launch-timing.mjs              # 用真机 launcherDir，默认 3080
 *   node tools/launch-timing.mjs --close      # 计时结束后关掉 dsh
 *   node tools/launch-timing.mjs --vbs launcher-visible.vbs   # 换显示版对照
 *
 * 前置：脚本会先停掉端口上的现有实例（保证走"启动"分支而非"聚焦"分支）。
 */
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1]) || 3080
const vbsName = args.includes('--vbs') ? args[args.indexOf('--vbs') + 1] : 'launcher.vbs'
const closeAfter = args.includes('--close')
const launcherDir = join(process.env.USERPROFILE ?? '', '.dsh-webui-launcher')
const vbs = join(launcherDir, vbsName)

if (!existsSync(vbs)) {
  console.error(`FAIL: ${vbs} 不存在（先运行一次 dsh 让 apply 生成启动脚本）`)
  process.exit(1)
}

const stopExisting = () => {
  try {
    execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }"`, { windowsHide: true, stdio: 'ignore' })
  } catch {}
}

const probe = async () => {
  try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) }); return true } catch (e) { return !!e?.response }
}

// 前置：停掉现有实例（否则 probe=open 分支会立即返回、计时无意义）
stopExisting()
await new Promise((r) => setTimeout(r, 1500))
if (await probe()) {
  console.error('FAIL: 端口仍被占用，无法进行干净计时')
  process.exit(1)
}

console.log(`计时：${vbsName}（隐秘窗口链路）→ socket ready，端口 ${port}${args.includes('--via-explorer') ? ' [explorer 启动=等价双击]' : ''}`)
const t0 = Date.now()
if (args.includes('--via-explorer')) {
  // 经 explorer 启动 = 完全等价用户双击桌面快捷方式（启动上下文一致）
  spawn('explorer.exe', [vbs], { detached: true, stdio: 'ignore' }).unref()
} else {
  spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

let ready = null
while (Date.now() - t0 < 120_000) {
  await new Promise((r) => setTimeout(r, 300))
  if (await probe()) { ready = Date.now() - t0; break }
}

if (ready === null) {
  console.log('=== FAIL ===  120s 内 socket 未就绪（查 logs/launch.log 与 logs/dsh-boot.log）')
  process.exit(1)
}
console.log('=== PASS ===')
console.log(`双击(vbs) → socket ready: ${ready} ms`)
try {
  const log = execSync(`powershell -NoProfile -Command "Get-Content '${join(launcherDir, 'logs', 'launch.log')}' -Tail 6 -Encoding UTF8"`, { windowsHide: true, encoding: 'utf8' })
  console.log('--- launch.log 尾部 ---')
  console.log(String(log).trim())
} catch {}
if (closeAfter) {
  stopExisting()
  console.log('（已关闭 dsh）')
}
process.exit(0)
