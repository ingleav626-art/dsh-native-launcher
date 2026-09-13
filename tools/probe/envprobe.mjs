/**
 * 环境探针：把「explorer 启动」与「终端启动」两个上下文的 env / cwd / 进程创建延迟落盘。
 * 目的：先排除最廉价的一类病根（PATH 顺序、NODE_OPTIONS、NODE_COMPILE_CACHE、UV_THREADPOOL_SIZE、
 * cwd 不同导致的相对路径解析差异），再谈要不要上 ETW。
 *
 * 用 run-contexts.mjs 驱动，不要手跑（需要四种启动上下文对照）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const out = resolve(process.argv[2] ?? 'tools/probe/out/env-unknown.json')
const runId = process.argv[3] ?? 'unknown'

mkdirSync(dirname(out), { recursive: true })
writeFileSync(
  out,
  JSON.stringify(
    {
      runId,
      nowEpochMs: Date.now(),
      // 进程创建时刻（libuv 记的 start_time 反推），与驱动记的启动时刻相减 = shell+创建+引导的墙钟
      nodeStartEpochMs: Math.round(Date.now() - process.uptime() * 1000),
      execPath: process.execPath,
      argv: process.argv,
      cwd: process.cwd(),
      env: process.env,
    },
    null,
    2,
  ),
  'utf8',
)
