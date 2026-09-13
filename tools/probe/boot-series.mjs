/**
 * 真实启动耗时序列还原：launch.log 的「launching: dsh」→ native-launcher.log 的首条 [diag] node=
 * 前者 = PowerShell 即将执行 dsh 的时刻，后者 = 插件 apply 的第一行（dsh 本体装载已跑完）。
 * 差值 = shim 解析 + node 引导 + dsh 本体装载，正是被当成「20s 黑盒」的那一段。
 *
 * 用法：node tools/probe/boot-series.mjs [launcherDir]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? join(process.env.USERPROFILE ?? '', '.dsh-webui-launcher')
const logs = join(dir, 'logs')

const read = (f) => readFileSync(join(logs, f), 'utf8').split(/\r?\n/)
const ts = (line) => {
  // 兼容 launch.log 的 [yyyy/MM/dd HH:mm:ss.fff] 与 native-launcher.log 的 [yyyy-MM-dd HH:mm:ss.fff +08:00]
  const m = line.match(/^\[(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})\.(\d{3})/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]).getTime() : null
}

const launch = read('launch.log')
const nat = read('native-launcher.log')

const starts = []
for (const l of launch) if (l.includes('launching: ')) starts.push({ t: ts(l), raw: l })
const diags = []
for (const l of nat) if (l.includes('[diag') && l.includes('node=v')) diags.push({ t: ts(l), raw: l })
const autos = []
for (const l of nat) if (l.includes('[auto-open ]') || l.includes('[auto-open]')) autos.push({ t: ts(l), ms: Number(l.match(/in (\d+)ms/)?.[1] ?? -1) })
const exits = []
for (const l of launch) if (l.includes('launchCommand exited after')) exits.push({ t: ts(l), ms: Number(l.match(/after (\d+)ms/)?.[1] ?? -1) })

console.log(`launch.log 启动行 ${starts.length} 条 / native-launcher.log [diag] ${diags.length} 条 / auto-open ${autos.length} 条`)
console.log('\n时刻              装载耗时   随后存活    auto-open  说明')
const fmt = (t) => new Date(t).toLocaleString('sv-SE')
for (const s of starts) {
  const d = diags.find((x) => x.t !== null && x.t >= s.t && x.t - s.t < 180_000)
  if (!d) {
    console.log(`${fmt(s.t)}   ——（无对应 [diag]，可能还在跑）`)
    continue
  }
  const boot = d.t - s.t
  const ex = exits.find((x) => x.t > d.t && x.t - d.t < 3600_000)
  const au = autos.find((x) => x.t >= d.t && x.t - d.t < 60_000)
  // 相邻两次 [diag] 之间若还有更早的启动行，说明匹配可能串行，标注出来
  const flag = boot > 120_000 ? '⚠️超长' : ''
  console.log(
    `${fmt(s.t)}   ${String(boot).padStart(6)}ms  ${ex ? String(ex.ms).padStart(8) + 'ms' : '    仍在跑'}  ${au ? String(au.ms).padStart(6) + 'ms' : '     -'}  ${flag}`,
  )
}
const boots = []
for (const s of starts) {
  const d = diags.find((x) => x.t !== null && x.t >= s.t && x.t - s.t < 180_000)
  if (d) boots.push(d.t - s.t)
}
if (boots.length) {
  const s = [...boots].sort((a, b) => a - b)
  console.log(`\n装载耗时样本 ${s.length}：min=${s[0]}ms 中位=${s[Math.floor(s.length / 2)]}ms max=${s[s.length - 1]}ms`)
}
