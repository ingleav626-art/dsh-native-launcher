/**
 * Toast 点击链路探测（独立可重跑，判定全自动——用户点击只是触发输入）：
 *   1. 记录 launch.log 基线行数
 *   2. PS5.1 发真实 Toast 卡（launch = 真机 launcher.vbs 路径——与双击快捷方式同链路）
 *   3. 提示点击 → 500ms 轮询 launch.log，捕捉 delta 出现时刻（= 点击→执行延迟）
 *   4. 结构化结果：PASS { 延迟 ms, 留痕行 } / FAIL { 阶段, 原因 }
 * 跑法：node tests/toast-click-probe.mjs
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const launcherDir = join(process.env.USERPROFILE ?? '', '.dsh-webui-launcher')
const launchLog = join(launcherDir, 'logs', 'launch.log')
const vbs = join(launcherDir, 'launcher.vbs')
const result = { phase: 'init', pass: false, metrics: {}, error: null }

const fail = (phase, error) => {
  result.phase = phase
  result.error = error
  console.log('\n=== FAIL ===')
  console.log('失败阶段:', phase)
  console.log('失败原因:', error)
  process.exit(1)
}

// ① 前置检查
result.phase = 'precheck'
if (!spawnSync('powershell', ['-NoProfile', '-Command', `Test-Path '${vbs.replace(/'/g, "''")}'`], { encoding: 'utf8' }).stdout?.includes('True')) {
  fail('precheck', `launcher.vbs 不存在：${vbs}`)
}
const lineCount = () => {
  try { return readFileSync(launchLog, 'utf8').split('\n').filter((l) => l.trim()).length } catch { return 0 }
}
const before = lineCount()
console.log(`[precheck] launcher.vbs ✓  launch.log 基线 ${before} 行`)

// ② 发卡（PS5.1——WinRT 加载是 5.1 专属语法，pwsh7 不支持）
result.phase = 'show-toast'
const psScript = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$textNodes = $template.GetElementsByTagName('text')
$null = $textNodes.Item(0).AppendChild($template.CreateTextNode('点击探测'))
$null = $textNodes.Item(1).AppendChild($template.CreateTextNode('请点击这张卡片（自动化判定已就绪）'))
$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
$node = $template.DocumentElement
$node.SetAttribute('activationType', 'protocol')
$node.SetAttribute('launch', '${vbs.replace(/'/g, "''")}')
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('DshNativeLauncher')
$notifier.Show($toast)
`
const shownAt = Date.now()
const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], { encoding: 'utf8', timeout: 30000 })
if (r.status !== 0) fail('show-toast', 'Toast 发送失败：' + String(r.stderr ?? '').slice(0, 300))
console.log(`[show-toast] 卡片已发出（${new Date(shownAt).toLocaleTimeString()}）→ 请点击屏幕上的「点击探测」卡片`)

// ③ 全自动轮询判定（120s 超时；delta 出现即成功，同时记录延迟）
result.phase = 'wait-click'
const deadline = Date.now() + 120_000
let firedAt = null
let lastLine = null
process.stdout.write('[wait-click] 轮询 launch.log ')
while (Date.now() < deadline) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
  if (lineCount() > before) {
    firedAt = Date.now()
    const lines = readFileSync(launchLog, 'utf8').split('\n').filter((l) => l.trim())
    lastLine = lines[lines.length - 1]
    break
  }
  process.stdout.write('.')
}
console.log('')
if (firedAt === null) fail('wait-click', '120s 内 launch.log 无新增——卡片未点击或 launch 未被执行（检查卡片是否还在/被系统吞掉）')

// ④ 结构化结果 + 性能指标
const latencyMs = firedAt - shownAt
result.pass = true
result.metrics = {
  '点击→执行延迟': latencyMs + ' ms',
  '新增留痕行数': lineCount() - before,
  '最新留痕': lastLine,
}
console.log('\n=== PASS ===')
for (const [k, v] of Object.entries(result.metrics)) console.log(`${k}: ${v}`)
console.log('链路：Toast 点击 → launcher.vbs（wscript 零窗口）→ launch.cmd（探测→聚焦/启动）')
writeFileSync(new URL('./toast-click-probe.last.json', import.meta.url), JSON.stringify(result, null, 2))
