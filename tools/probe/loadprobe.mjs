/**
 * 负载探针：把「20s 黑盒」拆成可归因的合成负载，分片测量。
 *
 * 每片 = 250ms 纯 CPU 自旋 + 250ms 纯文件读，记录：
 *   - 墙钟 vs 交付的 CPU 时间（cpuMs / wallMs）→ 区分「在等」与「被节流」
 *   - 自旋吞吐（iters）→ 直接被节流则下降
 *   - 上下文切换（voluntary / involuntary）→ 被抢占（节流）会推高 involuntary
 *   - 每片都留时间戳 → 节流是全程还是只在头几秒，一眼看出
 *
 * `--high-at N`：第 N 片起把本进程提到 High 优先级（自控对照：同一次运行内前后对比），
 * 用来直接判定「提高调度优先级」到底能不能救回吞吐。默认不改。
 *
 * 用法（由 run-contexts.mjs 驱动）：node loadprobe.mjs <out.json> <runId> [chunks] [highAt]
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { availableParallelism, cpus, getPriority, setPriority, constants, totalmem } from 'node:os'

const out = resolve(process.argv[2] ?? 'tools/probe/out/load-unknown.json')
const runId = process.argv[3] ?? 'unknown'
const chunks = Number(process.argv[4] ?? 12)
const highAt = Number(process.argv[5] ?? -1)
const prioName = process.argv[6] ?? 'high'
const PRIO = {
  above: constants.priority.PRIORITY_ABOVE_NORMAL,
  high: constants.priority.PRIORITY_HIGH,
  normal: constants.priority.PRIORITY_NORMAL,
}[prioName]
if (PRIO === undefined) throw new Error(`未知优先级 ${prioName}`)
if (!Number.isFinite(chunks) || chunks <= 0) throw new Error(`chunks 非法: ${process.argv[4]}`)
const SCAN_ROOT = process.env.PROBE_IO_ROOT ?? 'E:\\node\\node_global\\node_modules'
const CHUNK_MS = 250
const FILES_CAP = 400
// 原生（非 JS）算力负载：SHA256 走 OpenSSL C 代码，不受 V8 JIT/解释器影响——
// 用它把「系统真的少给了算力」与「只是 JS 引擎表现异常」区分开
const HASH_BUF = Buffer.alloc(64 * 1024, 7)

const r1 = (n) => Math.round(n * 10) / 10
const nodeStartEpochMs = Math.round(Date.now() - process.uptime() * 1000)
// 创建→脚本第一行的墙钟（探针自身的引导成本，与真机 dsh 的 node 引导可比）
const bootMs = Date.now() - nodeStartEpochMs

// ── 前置：待读文件清单（只在准备阶段扫一次，别把目录遍历算进 IO 吞吐）
const tPrep = Date.now()
const files = []
const walk = (dir, depth) => {
  if (files.length >= FILES_CAP || depth > 7) return
  let ents
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    if (files.length >= FILES_CAP) return
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (e.isFile()) {
      try {
        if (statSync(p).size < 512 * 1024) files.push(p)
      } catch {
        /* 拿不到大小的跳过 */
      }
    }
  }
}
walk(SCAN_ROOT, 0)
const prepMs = Date.now() - tPrep

const cpuMs = () => {
  const c = process.cpuUsage()
  return (c.user + c.system) / 1000
}
const switches = () => {
  const u = process.resourceUsage()
  return { vol: u.voluntaryContextSwitches, invol: u.involuntaryContextSwitches }
}

const base = cpuMs()
const samples = []
let priorityChanges = []

for (let i = 0; i < chunks; i++) {
  if (highAt >= 0 && i === highAt) {
    const before = getPriority(0)
    let note = 'ok'
    try {
      setPriority(0, PRIO)
    } catch (e) {
      note = String(e?.code ?? e)
    }
    priorityChanges.push({ chunk: i, from: before, to: getPriority(0), note, want: prioName })
  }
  const c0 = cpuMs()
  const s0 = switches()
  const w0 = performance.now()
  let iters = 0
  while (performance.now() - w0 < CHUNK_MS) for (let k = 0; k < 20000; k++) iters++
  const cpuWall = performance.now() - w0
  const cpuUsed = cpuMs() - c0
  const s1 = switches()

  const h0 = cpuMs()
  const y0 = performance.now()
  let hashes = 0
  while (performance.now() - y0 < CHUNK_MS) {
    for (let k = 0; k < 8; k++) {
      createHash('sha256').update(HASH_BUF).digest()
      hashes++
    }
  }
  const hashWall = performance.now() - y0
  const hashUsed = cpuMs() - h0

  const i0 = cpuMs()
  const j0 = switches()
  const x0 = performance.now()
  let bytes = 0
  let nFiles = 0
  let done = false
  while (!done && performance.now() - x0 < CHUNK_MS) {
    for (const f of files) {
      try {
        bytes += readFileSync(f).length
        nFiles++
      } catch {
        /* 单文件读失败不影响吞吐统计 */
      }
      if (performance.now() - x0 >= CHUNK_MS) {
        done = true
        break
      }
    }
  }
  const ioWall = performance.now() - x0
  const ioUsed = cpuMs() - i0
  const j1 = switches()

  samples.push({
    i,
    atMs: Date.now() - nodeStartEpochMs,
    priority: getPriority(0),
    cpu: {
      wallMs: r1(cpuWall),
      cpuMs: r1(cpuUsed),
      ratio: Math.round((cpuUsed / cpuWall) * 1000) / 1000,
      iters,
      invol: s1.invol - s0.invol,
      vol: s1.vol - s0.vol,
    },
    io: {
      wallMs: r1(ioWall),
      cpuMs: r1(ioUsed),
      files: nFiles,
      mbps: Math.round((bytes / 1048576 / (ioWall / 1000)) * 10) / 10,
      invol: j1.invol - j0.invol,
      vol: j1.vol - j0.vol,
    },
    hash: {
      wallMs: r1(hashWall),
      cpuMs: r1(hashUsed),
      hashes,
      mbps: Math.round(((hashes * HASH_BUF.length) / 1048576 / (hashWall / 1000)) * 10) / 10,
    },
  })
  if (i % 4 === 3 || i === chunks - 1) {
    // 分段落盘：进程被中途杀掉也能拿到已有数据
    flush(false)
  }
}

function flush(final) {
  const total = cpuMs() - base
  // 分段落盘写 .partial：驱动以「正式文件出现」判定跑完，中途落盘不能顶替正式文件
  const target = final ? out : `${out}.partial`
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(
    target,
    JSON.stringify(
      {
        runId,
        final,
        nodeStartEpochMs,
        bootMs,
        prepMs,
        scanRoot: SCAN_ROOT,
        fileCount: files.length,
        chunks,
        highAt,
        priorityChanges,
        env: {
          cwd: process.cwd(),
          execPath: process.execPath,
          availableParallelism: availableParallelism(),
          cpuCount: cpus().length,
          totalmemMb: Math.round(totalmem() / 1048576),
          UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE ?? null,
          NUMBER_OF_PROCESSORS: process.env.NUMBER_OF_PROCESSORS ?? null,
          NODE_OPTIONS: process.env.NODE_OPTIONS ?? null,
          NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE ?? null,
        },
        totalCpuMs: r1(total),
        totalWallMs: Date.now() - nodeStartEpochMs,
        switches: switches(),
        samples,
      },
      null,
      1,
    ),
    'utf8',
  )
}
flush(true)
