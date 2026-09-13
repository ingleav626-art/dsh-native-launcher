/**
 * 启动上下文对照驱动：同一份探针，跑在四种「谁启动 + 窗口风格」组合下。
 *
 *   explorer0 = explorer.exe 打开 vbs → node 隐藏控制台   （复现「双击 40s」的上下文）
 *   explorer1 = 同上但显示控制台
 *   explorer2 = 同上但最小化
 *   direct0   = 普通进程 spawn wscript（windowsHide）+ node 隐藏控制台（对照快的那条）
 *
 * 链路与真机一致：wscript → 目标进程（真机是 powershell → dsh，这里直接是 node 探针）。
 * 只换「启动者/窗口可见性」这一个变量，其余全同。
 *
 * 用法：
 *   node tools/probe/run-contexts.mjs --probe env  --reps 2
 *   node tools/probe/run-contexts.mjs --probe load --reps 1 --chunks 16
 *   node tools/probe/run-contexts.mjs --probe load --reps 1 --chunks 16 --only explorer0 --high-at 8
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const GEN = join(HERE, 'gen')
const OUT = join(HERE, 'out')
const NODE = process.execPath

const argv = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : dflt
}
const probe = argOf('--probe', 'env')
const reps = Number(argOf('--reps', '2'))
const chunks = Number(argOf('--chunks', '12'))
const highAt = Number(argOf('--high-at', '-1'))
const prioName = String(argOf('--prio', 'high'))
const only = String(argOf('--only', '')).split(',').filter(Boolean)
const affinityArg = argOf('--affinity', '')
const affinity = affinityArg ? (String(affinityArg).startsWith('0x') ? parseInt(String(affinityArg), 16) : Number(affinityArg)) : 0
const timeoutMs = Number(argOf('--timeout', '90000'))
const SCRIPT = { env: 'envprobe.mjs', load: 'loadprobe.mjs' }[probe]
if (!SCRIPT) throw new Error(`未知探针 ${probe}`)

const CONTEXTS = [
  { id: 'explorer0', via: 'explorer', style: 0 },
  { id: 'explorer1', via: 'explorer', style: 1 },
  { id: 'explorer2', via: 'explorer', style: 2 },
  { id: 'direct0', via: 'direct', style: 0 },
  // 真机链路形状：wscript(隐藏) → powershell(设自己优先级) → node，用来测优先级是否被继承
  { id: 'psAbove', via: 'explorer', style: 0, chain: 'above' },
  { id: 'psNormal', via: 'explorer', style: 0, chain: 'normal' },
  // 修法验证：同样隐藏链路，启动后从外部把 node 提到 AboveNormal
  { id: 'psFix', via: 'explorer', style: 0, chain: 'fix' },
].filter((c) => !only.length || only.includes(c.id))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(GEN, { recursive: true })
mkdirSync(OUT, { recursive: true })

const vbsFor = (runId, style, outFile, ctx) => {
  const extra = probe === 'load' ? ` ${chunks} ${highAt} ${prioName}` : ''
  const inner = ctx?.chain
    ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${join(HERE, 'ps-chain.ps1')}" -Out "${outFile}" -RunId "${runId}" -Chunks ${chunks} -HighAt ${highAt} -Prio ${ctx.chain}`
    : `"${NODE}" "${join(HERE, SCRIPT)}" "${outFile}" "${runId}"${extra}`
  const body = ['Set ws = CreateObject("WScript.Shell")', `ws.Run "${inner.replace(/"/g, '""')}", ${style}, False`].join('\r\n')
  const p = join(GEN, `${runId}.vbs`)
  writeFileSync(p, body, 'ascii')
  return p
}

/** 取探针进程的调度证据（优先级/亲和/线程/CPU）。
 *  刻意不用 WMI/CIM：本机 DSH 沙箱把 WMI 查询拒了（拒绝访问），Get-Process 才通。 */
const procFacts = (runId) => {
  const f = join(OUT, `pf-${runId}.json`)
  const ps =
    `$p = Get-Process node -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1; ` +
    `if ($p) { [pscustomobject]@{ pid = $p.Id; priority = [string]$p.PriorityClass; affinity = [int64]$p.ProcessorAffinity; ` +
    `threads = $p.Threads.Count; cpuMs = [int](($p.TotalProcessorTime).TotalMilliseconds) } | ` +
    `ConvertTo-Json -Compress | Set-Content -Path '${f}' -Encoding UTF8 }`
  spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' })
  try {
    return JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

/** 超时兜底：按已知 pid 收尾（探针正常写完 JSON 会自行退出；这里只防挂死）。
 *  刻意不用 WMI（本机 WMI 查询被拒），也绝不按进程名乱杀——驱动自己就是 node。 */
const killProbe = (pid) => {
  if (!pid) return
  spawnSync('powershell', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`], {
    stdio: 'ignore',
  })
}

/** 改探针进程的核绑定（硬亲和）：用来区分「被搬到 E-core」与「同一核降频/降速」 */
const setAffinity = (pid, mask) => {
  spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).ProcessorAffinity = [IntPtr]${mask}`], {
    stdio: 'ignore',
  })
}

const runOne = async (ctx, rep) => {
  const runId = `${probe}-${ctx.id}-r${rep}-${Date.now()}`
  const outFile = join(OUT, `${runId}.json`)
  const vbs = vbsFor(runId, ctx.style, outFile, ctx)
  const launchEpoch = Date.now()
  if (ctx.via === 'explorer') spawn('explorer.exe', [vbs], { detached: true, stdio: 'ignore' }).unref()
  else spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore', windowsHide: true }).unref()

  let facts = null
  let affinitySet = null
  let data = null
  while (Date.now() - launchEpoch < timeoutMs) {
    await sleep(250)
    if (!facts && Date.now() - launchEpoch > 1100) {
      facts = procFacts(runId)
      const f = Array.isArray(facts) ? facts[0] : facts
      if (affinity && f?.pid) {
        setAffinity(f.pid, affinity)
        affinitySet = { pid: f.pid, mask: `0x${affinity.toString(16)}`, atMs: Date.now() - launchEpoch }
      }
    }
    if (existsSync(outFile)) {
      await sleep(150)
      try {
        data = JSON.parse(readFileSync(outFile, 'utf8'))
      } catch {
        /* 还在写，下一轮再读 */
      }
      if (data) break
    }
  }
  killProbe(Array.isArray(facts) ? facts[0]?.pid : facts?.pid)
  const rec = { runId, ctx: ctx.id, rep, launchEpoch, facts, affinitySet, data, outFile }
  writeFileSync(join(OUT, `${runId}.result.json`), JSON.stringify(rec, null, 1), 'utf8')
  return rec
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}

const reportEnv = (recs) => {
  console.log('\n=== 进程创建 + 环境对照 ===')
  for (const r of recs) {
    if (!r.data) {
      console.log(`${r.ctx} r${r.rep}: FAIL（${Math.round(timeoutMs / 1000)}s 内无输出）`)
      continue
    }
    const createMs = r.data.nodeStartEpochMs - r.launchEpoch
    console.log(
      `${r.ctx} r${r.rep}: 创建+引导=${createMs}ms  cwd=${r.data.cwd}  parent=${r.facts?.parent ?? '?'}<-${r.facts?.grandparent ?? '?'}`,
    )
  }
  const pick = (id) => recs.find((r) => r.ctx === id && r.data)
  const a = pick('explorer0')
  const b = pick('direct0')
  const c = pick('explorer1')
  if (!a || !b) return console.log('缺少 explorer0/direct0 数据，跳过 env 差异')
  const diff = (x, y, label) => {
    const ea0 = x.data.env
    const eb0 = y.data.env
    const ka = Object.keys(ea0)
    const kb = Object.keys(eb0)
    const onlyA = ka.filter((k) => !(k in eb0))
    const onlyB = kb.filter((k) => !(k in ea0))
    const changed = ka.filter((k) => k in eb0 && ea0[k] !== eb0[k])
    console.log(`\n--- env 差异：${label} ---`)
    console.log(`仅 A 有: ${onlyA.join(', ') || '(无)'}`)
    console.log(`仅 B 有: ${onlyB.join(', ') || '(无)'}`)
    for (const k of changed) {
      const va = String(x.data.env[k])
      const vb = String(y.data.env[k])
      if (k === 'PATH') {
        const ea = va.split(';')
        const eb = vb.split(';')
        console.log(`PATH 顺序/内容不同：`)
        console.log(`  A 独有: ${ea.filter((e) => !eb.includes(e)).join(' | ') || '(无)'}`)
        console.log(`  B 独有: ${eb.filter((e) => !ea.includes(e)).join(' | ') || '(无)'}`)
        const order = ea.filter((e) => eb.includes(e)).join('|') !== eb.filter((e) => ea.includes(e)).join('|')
        console.log(`  相对顺序不同: ${order}`)
      } else {
        console.log(`${k}: A=[${va.slice(0, 90)}] B=[${vb.slice(0, 90)}]`)
      }
    }
    if (!changed.length && !onlyA.length && !onlyB.length) console.log('(完全一致)')
  }
  diff(a, b, 'explorer0 vs direct0')
  if (c) diff(a, c, 'explorer0 vs explorer1（应完全一致，用于验证对照组有效性）')
}

const reportLoad = (recs) => {
  console.log('\n=== 负载分片对照（每片 250ms JS 自旋 + 250ms 原生 SHA256 + 250ms 文件读）===')
  console.log('ctx        rep 创建+引导  bootMs 总墙钟 总CPU cpu比 iters中位 shaMB/s ioMB/s invol  优先级 亲和        线程')
  for (const r of recs) {
    if (!r.data) {
      console.log(`${r.ctx} r${r.rep}: FAIL（超时无输出）`)
      continue
    }
    const s = r.data.samples
    const pre = r.data.highAt >= 0 ? s.filter((x) => x.i < r.data.highAt) : s
    const post = r.data.highAt >= 0 ? s.filter((x) => x.i >= r.data.highAt) : []
    console.log(
      `${r.ctx} r${r.rep}`.padEnd(12) +
        `${r.data.nodeStartEpochMs - r.launchEpoch}ms`.padStart(9) +
        `${r.data.bootMs}`.padStart(8) +
        `${r.data.totalWallMs}`.padStart(7) +
        `${r.data.totalCpuMs}`.padStart(7) +
        `${(r.data.totalCpuMs / r.data.totalWallMs).toFixed(2)}`.padStart(6) +
        `${median(pre.map((x) => x.cpu.iters))}`.padStart(10) +
        `${median(pre.map((x) => x.hash.mbps))}`.padStart(8) +
        `${median(pre.map((x) => x.io.mbps))}`.padStart(7) +
        `${pre.reduce((s2, x) => s2 + x.cpu.invol, 0)}`.padStart(7) +
        `${(r.facts?.priority ?? '?')}`.padStart(8) +
        `${(r.facts?.affinity ?? '?')}`.padStart(12) +
        `${(r.facts?.threads ?? '?')}`.padStart(5),
    )
    if (post.length) {
      const preLast = s.filter((x) => x.i >= Math.max(0, r.data.highAt - 4) && x.i < r.data.highAt)
      console.log(
        `  提权前末 4 片: ${median(preLast.map((x) => x.cpu.iters))} iters / ${median(preLast.map((x) => x.hash.mbps))} shaMB/s / ${median(preLast.map((x) => x.io.mbps))} ioMB/s`,
      )
      console.log(
        `  └提权后   : ${median(post.map((x) => x.cpu.iters))} iters / ${median(post.map((x) => x.hash.mbps))} shaMB/s / ${median(post.map((x) => x.io.mbps))} ioMB/s, priority=${post[0].priority}`,
      )
      console.log(`  提权记录: ${JSON.stringify(r.data.priorityChanges)}`)
    }
  }
  // 时间分辨曲线：看节流是否只发生在头几秒
  console.log('\n--- 分片吞吐曲线（iters/cpu比/invol 与 sha MB/s）---')
  for (const r of recs) {
    if (!r.data) continue
    const cells = r.data.samples.map(
      (x) => `${x.i}:${x.cpu.iters}/${x.cpu.ratio}${x.cpu.invol ? '!' + x.cpu.invol : ''}#${x.hash.mbps}`,
    )
    console.log(`${r.ctx} r${r.rep}: ${cells.join(' ')}`)
  }
}

const main = async () => {
  console.log(`探针=${probe} 上下文=${CONTEXTS.map((c) => c.id).join(',')} reps=${reps}`)
  const recs = []
  for (let rep = 1; rep <= reps; rep++) {
    for (const ctx of CONTEXTS) {
      const r = await runOne(ctx, rep)
      recs.push(r)
      const tag = r.data ? `OK ${r.data.nodeStartEpochMs - r.launchEpoch}ms` : 'FAIL'
      console.log(`  ${ctx.id} r${rep}: ${tag}`)
    }
  }
  ;(probe === 'env' ? reportEnv : reportLoad)(recs)
  console.log(`\n原始数据: ${OUT}`)
}

await main()
