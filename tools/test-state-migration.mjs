/**
 * 状态文件迁移验证（沙箱端到端，可复跑）：
 * 在沙箱 launcherDir 造 4 个历史版本的裸 txt 状态文件 → 起沙箱 dsh 触发插件 apply
 * → 检查旧 txt 是否被迁移为 JSON 并清理。
 *
 * 背景（2026-09-15 实锤）：此前迁移只在各处"顺手"执行（创建快捷方式 / 托盘 kill 分支），
 * 实测升级后旧 txt 全部残留；修复为 apply 统一调用 migrateLegacyStateFiles 后，本脚本用于回归。
 *
 * 用法：node tools/test-state-migration.mjs
 * 前置：沙箱 DSH_HOME 已就绪（D:\web\demo\test\dsh-sandbox），端口 3081 空闲。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const SBX = 'D:\\web\\demo\\test\\dsh-sandbox'
const SL = SBX + '\\user\\.dsh-webui-launcher'
const env = { ...process.env, DSH_HOME: SBX + '\\home', USERPROFILE: SBX + '\\user', APPDATA: SBX + '\\appdata' }
const LEGACY = ['tray-pid.txt', 'tray-version.txt', 'webui-url.txt', 'shortcut-registry.txt']
const MODERN = ['tray-state.json', 'webui-url.json', 'shortcut-registry.json']

const kill = () => {
  try { spawnSync('powershell', ['-NoProfile', '-Command', 'Get-NetTCPConnection -LocalPort 3081 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }'], { windowsHide: true, stdio: 'ignore' }) } catch {}
}
const probe = async () => { try { await fetch('http://127.0.0.1:3081/', { signal: AbortSignal.timeout(800) }); return true } catch (e) { return !!e?.response } }

// 造旧文件（模拟历史版本留下的状态文件）
kill()
await new Promise((r) => setTimeout(r, 1500))
writeFileSync(SL + '\\tray-pid.txt', '17844', 'utf-8')
writeFileSync(SL + '\\tray-version.txt', '21', 'utf-8')
writeFileSync(SL + '\\webui-url.txt', 'http://127.0.0.1:3081/?token=MIGRATIONTEST\n', 'utf-8')
writeFileSync(SL + '\\shortcut-registry.txt', 'C:\\Users\\test\\Desktop\\X.lnk\r\n', 'utf-8')
console.log('=== apply 前（造的旧 txt） ===')
for (const f of [...LEGACY, ...MODERN]) console.log(`  ${f}: ${existsSync(SL + '\\' + f) ? '存在' : '不存在'}`)

// 起沙箱 dsh（用当前 lib 产物）触发 apply
const child = spawn(process.execPath, [SBX + '\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js', '--profile', 'web', '--no-open'], { env, cwd: SBX + '\\user', stdio: 'ignore', windowsHide: true })
const t0 = Date.now()
let ready = null
while (Date.now() - t0 < 90_000) {
  await new Promise((r) => setTimeout(r, 400))
  if (await probe()) { ready = Date.now() - t0; break }
}
console.log(`\ndsh 就绪: ${ready ?? 'TIMEOUT'}ms（apply 已执行）`)
await new Promise((r) => setTimeout(r, 4000))
kill()
try { child.kill() } catch {}
await new Promise((r) => setTimeout(r, 2000))

// 检查
console.log('\n=== apply 后 ===')
let failed = 0
for (const f of LEGACY) {
  const left = existsSync(SL + '\\' + f)
  if (left) failed++
  console.log(`  ${f}: ${left ? '★残留（未迁移）' : '已清理 ✓'}`)
}
for (const f of MODERN) {
  const there = existsSync(SL + '\\' + f)
  if (!there) failed++
  console.log(`  ${f}: ${there ? '已生成 ✓' : '★缺失（未生成）'}`)
}
console.log('\n=== JSON 内容抽查 ===')
for (const f of MODERN) {
  if (existsSync(SL + '\\' + f)) { try { console.log(`  ${f}: ${readFileSync(SL + '\\' + f, 'utf-8').trim().slice(0, 140)}`) } catch { } }
}
console.log('\n=== launcherDir 全量 ===')
console.log('  ' + readdirSync(SL).filter((f) => !f.startsWith('.')).join(' | '))
console.log(failed === 0 ? '\n=== PASS：旧 txt 全部迁移清理，JSON 全部就位 ===' : `\n=== FAIL：${String(failed)} 项不符 ===`)
process.exit(failed === 0 ? 0 : 1)
