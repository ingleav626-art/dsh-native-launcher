#!/usr/bin/env node
/**
 * 伪造官方 API 的端到端自测（闸④的进程内替代，真机验证前的最后一道机器验证）。
 *
 * 伪造面 = 0.1.5-rc.2 官方语义（形状与行为均来自沙箱探针实证，见 REFACTOR_PLAN P1·X）：
 *  - sessions.create / session.append：事件按 seq 提交（1 起，单调递增）
 *  - sessionProjections.register / onChanged / snapshot：**派生态**语义——
 *      · 注册即对全部既有会话折完整历史（投影是日志的函数）
 *      · 变更流：每个 committed event、每个 view 变化（Object.is）回调一次
 *      · snapshot 返回 `{ [key]: wireView }`
 *  - settings.register：schemastery 实例应用默认值与校验；get / update / watch 三件套
 *
 * 真实链路（与真机 lib/index.js 的装配路径一致，只差 cordis 本体）：
 *   伪造 ctx → lib/host-ports.js（端口适配）→ lib/module-registry.js（容器，apiVersion 护栏）
 *   → lib/modules/notification/index.js（构建产物）→ tray-notify.json（真实写入临时目录）
 *
 * 运行：node tests/forged-official.mjs（退出码非 0 即失败）
 */
import { mkdtempSync, readFileSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { createNotificationPorts } from '../lib/host-ports.js'
import { BUILTIN_MODULES, CORE_API_VERSION } from '../lib/module-registry.js'

// ─────────────────────────────────────────────────────────────────────────────
// 伪造官方 API（0.1.5-rc.2 语义）
// ─────────────────────────────────────────────────────────────────────────────

/** 伪造 sessionProjections：派生态 + 变更流（探针实证语义）。 */
class ForgedProjections {
  #defs = new Map() // key -> definition
  #listeners = new Set()
  #states = new Map() // `${sessionId}\\u0000${key}` -> fold 状态
  #sessions = [] // back-ref，由 ForgedDsh 注入

  attachSessions(sessions) {
    this.#sessions = sessions
  }

  register(definition) {
    this.#defs.set(definition.key, definition)
    // 派生态语义：注册即对既有会话折完整历史（此时按模块装配顺序尚无订阅者，不广播）
    for (const session of this.#sessions) {
      for (const [seq, event] of session.log.entries()) {
        this.#fold(session, event, seq + 1, definition)
      }
    }
  }

  onChanged(listener) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  snapshot(session, keys) {
    // 官方契约：snapshot 收的是**真 Session**（内部要走 session.snapshotEvents()）。
    // 这里照样强制——把窄摘要对象当 Session 喂进来必须当场炸：
    // 2026-09-11 沙箱实测过这个接线 bug（宿主把摘要直接喂给官方快照 → 模块整体加载失败），
    // 而当时本测试因为不校验入参形状而放过了它。
    if (session === null || typeof session !== 'object' || typeof session.snapshotEvents !== 'function') {
      throw new TypeError('session.snapshotEvents is not a function（snapshot 只接受真 Session）')
    }
    const out = {}
    for (const [key, def] of this.#defs) {
      if (keys !== undefined && !keys.includes(key)) continue
      const state = this.#stateOf(session.id, def)
      out[key] = def.wire.view(state)
    }
    return out
  }

  /** 变更流重放钩子：把最近一次广播原样重发（模拟官方对同一 seq 的重放）。 */
  replayLast() {
    if (this.#lastBroadcast !== undefined) {
      for (const fn of this.#listeners) fn(...this.#lastBroadcast)
    }
  }

  #lastBroadcast

  #stateOf(sessionId, def) {
    const id = `${sessionId} ${def.key}`
    if (!this.#states.has(id)) this.#states.set(id, def.init())
    return this.#states.get(id)
  }

  /** 会话追加事件时由 ForgedSession 调用：逐定义折事件，view 变化（Object.is）即广播。 */
  _onAppend(session, event, seq) {
    for (const [key, def] of this.#defs) {
      const id = `${session.id} ${key}`
      const prev = this.#stateOf(session.id, def)
      const next = def.apply(prev, event)
      this.#states.set(id, next)
      const prevView = def.wire.view(prev)
      const nextView = def.wire.view(next)
      if (!Object.is(prevView, nextView)) {
        this.#lastBroadcast = [session, key, nextView, seq]
        for (const fn of [...this.#listeners]) fn(session, key, nextView, seq)
      }
    }
  }

  #fold(session, event, seq, def) {
    const id = `${session.id} ${def.key}`
    const prev = this.#stateOf(session.id, def)
    this.#states.set(id, def.apply(prev, event))
  }
}

/** 伪造会话：append 即提交事件（seq 单调），驱动投影折与变更流。 */
class ForgedSession {
  #dsh
  id
  header
  log = []

  constructor(dsh, id, origin) {
    this.#dsh = dsh
    this.id = id
    this.header = { origin }
  }

  append(type, data = {}, _opts = {}) {
    const event = { type, data }
    const seq = this.log.push(event)
    this.#dsh.projections._onAppend(this, event, seq)
    return seq
  }

  /** 官方 Session 的日志读面（0.1.5-rc.2 实证）：`snapshotEvents(from, to)` 取事件区间副本。 */
  snapshotEvents(from = 0, to = this.log.length) {
    return this.log.slice(from, to)
  }
}

/** 伪造官方 ctx（cordis 上下文的官方服务面）。 */
class ForgedDsh {
  projections = new ForgedProjections()
  #sessions = []
  #settings = new Map() // namespace -> { schema, value, listeners }

  /** 官方会话服务**真身**：测试自己造会话用；插件侧只能经 `ctx.get('sessions')` 拿到它。 */
  sessions

  constructor() {
    this.projections.attachSessions(this.#sessions)
    this.sessions = {
      create: (id, origin) => {
        const session = new ForgedSession(this, id, origin)
        this.#sessions.push(session)
        return session
      },
      list: () => [...this.#sessions],
      get: id => this.#sessions.find(session => session.id === id),
    }
    const ctx = {
      sessionProjections: this.projections,
      settings: {
        register: (namespace, schema, { base } = {}) => {
          if (this.#settings.has(namespace)) throw new Error(`settings namespace 重复注册: ${namespace}`)
          // 官方语义：注册即以 schema 校验/补全 base，得到当前值
          let value = schema({ ...(base ?? {}) })
          const listeners = new Set()
          const scope = {
            get: () => value,
            update: async patch => {
              const prev = value
              value = schema({ ...value, ...patch })
              for (const fn of [...listeners]) fn(value, prev)
            },
            replace: async section => {
              const prev = value
              value = schema(section)
              for (const fn of [...listeners]) fn(value, prev)
            },
            watch: fn => {
              listeners.add(fn)
              return () => listeners.delete(fn)
            },
          }
          this.#settings.set(namespace, scope)
          return scope
        },
      },
      // `ctx.get(name)` 是 cordis 的**免守卫**取服务面（客户端传感器与宿主端口都走它）
      get: name => (name === 'sessions' ? this.sessions : undefined),
    }
    // cordis 4 的 inject 守卫：**未在插件 inject 清单里声明的服务，属性访问直接抛**
    // （2026-09-11 沙箱实测的 S1：宿主写 `ctx.sessions` → 抛 → 通知模块整体不加载）。
    // 伪造出来，"该用 ctx.get 还是 ctx.sessions"这类接线错误在本机 E2E 就会炸，而不是等到真机。
    Object.defineProperty(ctx, 'sessions', {
      configurable: true,
      get() { throw new Error('cannot get property "sessions" without inject') },
    })
    this.ctx = ctx
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 运行器
// ─────────────────────────────────────────────────────────────────────────────

const transcript = []
const stamp = () => new Date().toISOString().slice(11, 23)
const line = text => transcript.push(`[${stamp()}] ${text}`)

const failures = []
/** 场景总数（收尾报告用；加场景时同步 +1，别让报告数字骗人）。 */
let STEP_TOTAL = 0
async function step(name, fn) {
  STEP_TOTAL += 1
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  ✗ ${name}`)
    console.log(String(error?.stack ?? error).split('\n').map(l => `      ${l}`).join('\n'))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 场景
// ─────────────────────────────────────────────────────────────────────────────

const launcherDir = mkdtempSync(join(tmpdir(), 'dsh-forged-'))
const trayFile = join(launcherDir, 'tray-notify.json')
const delivered = []
const dsh = new ForgedDsh()

// 场景 1 的素材：dsh 重启前就存在的会话（历史已完成一个 turn）
const bootSession = dsh.sessions.create('boot')
bootSession.append('turn/start', { turn: 1 })
bootSession.append('assistant/message', { turn: 1, message: { content: [{ type: 'text', text: '历史回复' }] } })
bootSession.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

// 真实装配路径：容器 → 适配层 → 构建产物
const mod = BUILTIN_MODULES.find(m => m.id === 'notifications')
const ports = createNotificationPorts(dsh.ctx, {
  launcherDir,
  log: line,
  logWarn: line,
  logFail: line,
  isNotifySuppressed: () => false,
})
// 观察层：真实写文件照常发生，只是顺手留档断言
const realNotify = ports.notify
ports.notify = {
  notify(notification) {
    delivered.push(notification)
    realNotify.notify(notification)
  },
}

console.log('伪造官方 API 端到端自测（tray-notify.json 落在临时目录）\n')

// 步骤 -1｜host 产物链接冒烟（P2-B2 补洞）：手写 lib/index.js 与 lib/host/*.js 产物之间的
// import 契约没有 tsc/node --check 兜底（JS 不进 tsc；语法检查不查跨文件绑定）——
// ESM 链接错误（导入的绑定不存在）只有真加载才炸，且炸的是整个 dsh 启动。
// 这里真实 import 一次，链接错误当场暴露。
await step('步骤 -1｜host 产物链接冒烟：lib/index.js 的 import 图必须能解析', async () => {
  const hostModule = await import('../lib/index.js')
  assert.equal(typeof hostModule.apply, 'function', 'apply 导出缺失')
  assert.equal(typeof hostModule.name, 'string', 'name 导出缺失')
  assert.ok(Array.isArray(hostModule.inject), 'inject 导出缺失')
})

// 步骤 -1b｜生成脚本语法守卫（P2-B7c 补洞）：open-webui.ps1 / tray.ps1 是运行时由
// 模板字符串生成的——函数对账与 tsc 都不覆盖模板内部文本，语法损坏只有 PowerShell
// 解析才暴露；而解析失败 = 整个脚本一行不执行且零日志（openBrowser 不查 spawnSync
// 退出码——2026-09-12 真机回归实锤：B2 迁移丢一个 `}`，快捷方式启动后浏览器静默不开）。
await step('步骤 -1b｜生成脚本语法守卫：writeOpenScript/writeTrayScript 产物必须通过 PowerShell Parser', async () => {
  const { writeOpenScript } = await import('../lib/host/scripts.js')
  const { writeTrayScript } = await import('../lib/host/tray.js')
  const { spawnSync } = await import('node:child_process')
  const scriptDir = join(launcherDir, 'script-guard')
  rmSync(scriptDir, { recursive: true, force: true })
  mkdirSync(scriptDir, { recursive: true })
  // 两个 openScript 变体（无 PWA app id / 有 app id——openMode 分支内容不同）+ tray.ps1
  writeOpenScript(scriptDir, 3080, 'app', 'DSH WebUI', null)
  writeOpenScript(scriptDir, 3080, 'app', 'DSH WebUI', 'ofjcbbcobnobobmogpaohlojjnjfcplh')
  writeTrayScript(scriptDir, 3080, join(scriptDir, 'dsh-webui.ico'), join(scriptDir, 'open-webui.ps1'), null)
  // tray.ps1 语义结构守卫（2026-09-12 真机实锤补洞）：launch 段两处历史 bug 都是
  // "语法正确但语义错"——语法守卫抓不到，必须断言关键结构存在：
  // ① Toast launch 必须现场枚举 AppsFolder（'<appId>!App' 是 UWP 格式，对 Edge
  //    非打包 PWA 无效 → 点击静默无反应）；
  // ② launch 值必须落 tray-notify.log（点击无反应时的唯一排查线索）；
  // ③ AUMID 注册（Toast 必需）与 dsh-webui 协议清理（升级自愈）必须保留。
  {
    const tray = readFileSync(join(scriptDir, 'tray.ps1'), 'utf8')
    assert.ok(tray.includes("SetAttribute('launch'"), 'tray.ps1 缺 Toast launch 设置')
    assert.ok(tray.includes("NameSpace('shell:AppsFolder')"), 'tray.ps1 缺 AppsFolder 枚举（launch 不得拼 appId!App）')
    assert.ok(!tray.includes('+ \'!App\''), 'tray.ps1 出现 UWP 式 !App 拼接（对非打包 PWA 无效）')
    assert.ok(!tray.includes('${String(port)'), 'tray.ps1 出现未插值的 ${String(port)} 字面量（模板用了双引号——[System.Uri] 会抛异常吞掉 launch 段，真机实锤 2026-09-12）')
    assert.ok(tray.includes('$pwaLaunch'), 'tray.ps1 缺顶层 PWA 枚举变量（Show-TrayToast 内的 $appId 是函数局部值，不可见）')
    assert.ok(tray.includes('[toast] launch='), 'tray.ps1 缺 launch 值日志留痕')
    assert.ok(tray.includes('AppUserModelId\\DshNativeLauncher'), 'tray.ps1 缺 AUMID 注册')
    assert.ok(tray.includes("Classes\\dsh-webui'"), 'tray.ps1 缺 v13 协议残留清理行')
  }
  for (const f of ['open-webui.ps1', 'tray.ps1']) {
    const p = join(scriptDir, f)
    assert.ok(existsSync(p), f + ' 未生成')
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `$errs=$null;$toks=$null;$null=[System.Management.Automation.Language.Parser]::ParseFile('${p.replace(/'/g, "''")}',[ref]$toks,[ref]$errs);if($errs){$errs|ForEach-Object{Write-Output ('LINE '+$_.Extent.StartLineNumber+': '+$_.Message)};exit 1}`],
      { encoding: 'utf8' })
    assert.equal(r.status, 0, f + ' PowerShell 语法解析失败：' + String(r.stdout ?? '') + String(r.stderr ?? ''))
  }
})

// 步骤 -1c｜launch.cmd 探测行结构契约守卫（2026-09-12 真机实锤补漏）：探测必须走
// webui-url.txt 的 token URL（与 autoOpen/open-webui.ps1 同一数据源）——旧版裸探测
// 在 dsh token 鉴权时代恒 401 误判 closed → 双击快捷方式永不唤起。行为级验证在沙箱
// 全链路做（真实 dsh + 真实 token + 真实 launch.cmd），此处守卫结构不被回退。
await step('步骤 -1c｜launch.cmd 探测行结构契约：必须读 webui-url.txt 的 token URL', async () => {
  const { writeLauncherFiles } = await import('../lib/host/scripts.js')
  const dir = join(launcherDir, 'probe-guard')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeLauncherFiles(dir, 'dsh --profile web --no-open', 3080, null, join(dir, 'open-webui.ps1'))
  const cmd = readFileSync(join(dir, 'launch.cmd'), 'utf8')
  const probe = cmd.match(/powershell -NoProfile[^\r\n]*-Command "([^"]*Invoke-WebRequest[^"]*)"/)
  assert.ok(probe, 'launch.cmd 缺少 HTTP 探测行')
  assert.ok(probe[1].includes('webui-url.txt'), '探测行必须读 webui-url.txt（token 数据源）——裸探测在 token 鉴权时代恒 401 误判 closed')
  assert.ok(probe[1].includes('Invoke-WebRequest'), '探测行必须发 HTTP 请求')
})

// 步骤 -1d｜tray.ps1 launch 目标行为测试（2026-09-12 晚三重失效的终局补闸）：
// 文本断言抓不到三类 bug——① Show-TrayToast 引用了函数局部 $appId（作用域盲区）、
// ② 模板双引号让 TS 插值失效留字面占位符（[System.Uri] 抛异常被 catch 吞段）、
// ③ launch 值拼裸 appId!App（UWP 格式对非打包 PWA 无效）。解法 = launch 目标计算
// 提成 Get-ToastLaunchTarget 真函数 + 模板标记 E2E-EXTRACT 段，这里提取后配 stub
// 真执行，断言两个分支的真实返回值。
await step('步骤 -1d｜tray.ps1 launch 目标行为测试：Get-ToastLaunchTarget 两分支真执行', async () => {
  const { writeTrayScript } = await import('../lib/host/tray.js')
  const { spawnSync } = await import('node:child_process')
  const dir = join(launcherDir, 'launch-behavior')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeTrayScript(dir, 3080, join(dir, 'dsh-webui.ico'), join(dir, 'open-webui.ps1'), null)
  const tray = readFileSync(join(dir, 'tray.ps1'), 'utf8')
  const m = tray.match(/# ==== E2E-EXTRACT-START[\s\S]*?# ==== E2E-EXTRACT-END ====/)
  assert.ok(m, 'tray.ps1 缺 E2E-EXTRACT 标记段（行为测试无法提取）')
  const script = [
    "function Log-Notify([string]$m) { Write-Output ('[ln] ' + $m) }",
    m[0],
    "Write-Output ('BRANCH1=' + (Get-ToastLaunchTarget))",
    '$pwaLaunch = $null',
    "Write-Output ('BRANCH2=' + (Get-ToastLaunchTarget))",
  ].join('\n')
  const ps1 = join(dir, 'behavior.ps1')
  writeFileSync(ps1, script, 'utf8')
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-File', ps1], { encoding: 'utf8', timeout: 30000 })
  rmSync(dir, { recursive: true, force: true })
  assert.equal(r.status, 0, 'launch 目标计算抛异常（插值/作用域/语法回归）：' + String(r.stderr ?? '').slice(0, 300))
  const out = String(r.stdout ?? '')
  const b1 = out.match(/BRANCH1=(\S+)/)?.[1] ?? ''
  const b2 = out.match(/BRANCH2=(\S+)/)?.[1] ?? ''
  assert.ok(b1, 'PWA 分支无返回值')
  assert.ok(b2, 'URL 回退分支无返回值')
  // BRANCH2 强制 $pwaLaunch=$null 后调用：必须是页面 URL 且无占位符字面量（插值失效检测）
  assert.ok(/^http:\/\/127\.0\.0\.1:3080(\/|\?token=)/.test(b2), `URL 回退分支必须是本机页面 URL（可带 token），实际 ${b2}`)
  assert.ok(!b2.includes('${'), 'URL 回退分支含未插值占位符（模板双引号回归）')
  // BRANCH1：有 PWA → shell:AppsFolder\<真实项名>（项名必须形如 127.0.0.1-…，禁止裸 appId 拼接）；无 PWA → 与 BRANCH2 同
  if (b1.startsWith('shell:AppsFolder\\')) {
    assert.ok(/shell:AppsFolder\\127\.0\.0\.1-/.test(b1), `PWA 分支必须是 AppsFolder 真实项名（127.0.0.1-… 形式），实际 ${b1}`)
  } else {
    assert.ok(b1 === b2, `无 PWA 时 BRANCH1 应与 BRANCH2 同为页面 URL，实际 ${b1} vs ${b2}`)
  }
})

await step('步骤 0｜伪造面自检：inject 守卫与真 Session 契约都必须在假 API 里成立', () => {
  // 这两条是"测试的测试"：假 API 若少了官方守卫，适配层接线错误就会一路潜伏到真机
  // （2026-09-11 沙箱实测的 S1/S2 就是这么漏过去的）
  assert.throws(() => dsh.ctx.sessions, /without inject/, 'ctx.sessions 属性访问必须抛（复刻 cordis inject 守卫）')
  assert.ok(dsh.ctx.get('sessions') !== undefined, "ctx.get('sessions') 必须可达（免守卫取服务面）")
  assert.throws(() => dsh.projections.snapshot({ id: 'x', origin: 'user' }, ['notification']), /snapshotEvents/,
    'projection.snapshot 必须拒绝窄摘要对象（复刻官方"只认真 Session"契约）')
})

await step('步骤 0b｜容器护栏与装配（apiVersion 一致；settings 注册 → 投影注册 → 变更流订阅）', () => {
  assert.equal(mod.apiVersion, CORE_API_VERSION, '容器与模块 apiVersion 必须一致（护栏语义）')
  const instance = mod.create(ports)
  const dispose = instance.start()
  assert.ok(transcript.some(l => l.includes('[notification] settings 已注册 ns=dsh-native-notification')), 'settings 注册日志缺失')
  assert.ok(transcript.some(l => l.includes('已装配')), '装配完成日志缺失')
  globalThis.__mod = instance
  globalThis.__dispose = dispose
})

const instance = globalThis.__mod

await step('步骤 1｜冷启动播种：重启前已完成的 turn 不补通知', () => {
  assert.equal(delivered.length, 0, `历史会话不应产生通知，实际 ${delivered.length} 条`)
})

const live = dsh.sessions.create('live')

await step('步骤 2｜页面开着跑任务：turn 1 完成 → 弹「任务完成」', () => {
  live.append('turn/start', { turn: 1 })
  live.append('assistant/message', { turn: 1, message: { content: [{ type: 'text', text: '构建成功，测试全绿' }] } })
  live.append('tool/call', { turn: 1, name: 'npm' })
  live.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.equal(delivered.length, 1, `应恰好 1 条通知，实际 ${delivered.length}`)
  assert.deepEqual(delivered[0], { title: '任务完成', body: '构建成功，测试全绿', tag: 'dsh-notification-live-1' })
})

await step('步骤 3｜变更流重放同一 turn → 不重复投递（双层去重）', () => {
  dsh.projections.replayLast()
  assert.equal(delivered.length, 1, `重放不应产生新通知，实际 ${delivered.length}`)
})

await step('步骤 4｜出错 turn → 弹「任务出错」', () => {
  live.append('turn/start', { turn: 2 })
  live.append('assistant/message', { turn: 2, message: { content: [{ type: 'text', text: '测试失败：断言不相等' }] } })
  live.append('turn/end', { turn: 2, reason: { kind: 'error' } })
  assert.deepEqual(delivered[1], { title: '任务出错', body: '测试失败：断言不相等', tag: 'dsh-notification-live-2' })
})

await step('步骤 5｜exclude 规则即时生效：nightly 抑制，正常照弹（无需重启）', async () => {
  const ok = await instance.updateSettings({
    rules: [{ id: 'r1', enabled: true, mode: 'exclude', pattern: 'nightly', isRegex: false, caseSensitive: false }],
  })
  assert.equal(ok, true, '规则写入应被接受')
  assert.equal(instance.getSettings().rules.length, 1, '规则应已落库')
  live.append('turn/start', { turn: 3 })
  live.append('assistant/message', { turn: 3, message: { content: [{ type: 'text', text: 'nightly 批处理完成' }] } })
  live.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
  assert.equal(delivered.length, 2, `命中 exclude 规则应抑制，实际 ${delivered.length}`)
  live.append('turn/start', { turn: 4 })
  live.append('assistant/message', { turn: 4, message: { content: [{ type: 'text', text: '正常完成' }] } })
  live.append('turn/end', { turn: 4, reason: { kind: 'completed' } })
  assert.equal(delivered.length, 3, '不命中规则的 turn 应照常投递')
  assert.equal(delivered[2].tag, 'dsh-notification-live-4')
})

await step('步骤 6｜subagent 会话不投递（完成与等待都跳过）', async () => {
  const sub = dsh.sessions.create('sub-1', 'subagent')
  sub.append('turn/start', { turn: 1 })
  sub.append('assistant/message', { turn: 1, message: { content: [{ type: 'text', text: '子代理完成' }] } })
  sub.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.equal(delivered.length, 3, 'subagent 的完成不应投递')
  const ok = instance.reportPending({ sessionId: 'sub-1', kind: 'approval', title: 'x', origin: 'subagent' })
  assert.equal(ok, true, '上报形状合法（拒绝与否由决策层定）')
  assert.equal(delivered.length, 3, 'subagent 的等待不应投递')
})

await step('步骤 7｜等待批准：client 传感器上报 → host 决策 → 托盘文案', () => {
  // 传感器是持续轮询的：页面开着期间先上报「无等待」（播种），等待出现后才上报种类
  assert.equal(instance.reportPending({ sessionId: 'live' }), true, '无等待上报应被接受')
  const ok = instance.reportPending({ sessionId: 'live', kind: 'approval', title: 'Deploy to prod' })
  assert.equal(ok, true)
  assert.deepEqual(delivered[3], { title: '等待你的批准', body: 'Deploy to prod', tag: 'dsh-notification-pending-live-1' })
})

await step('步骤 8｜等待回答（默认开）+ 等待计划评审（默认关 → 打开后弹）', async () => {
  assert.equal(instance.reportPending({ sessionId: 'boot' }), true, 'boot 会话传感器播种')
  const okQ = instance.reportPending({ sessionId: 'boot', kind: 'question', title: '如何配置代理？' })
  assert.equal(okQ, true)
  assert.deepEqual(delivered[4], { title: '等待你的回答', body: '如何配置代理？', tag: 'dsh-notification-pending-boot-1' })
  // 上报「等待解除」再上报 plan-review：默认关 → 不弹（但该次等待已消耗序号 2）
  instance.reportPending({ sessionId: 'live' })
  const off = instance.reportPending({ sessionId: 'live', kind: 'plan-review', title: '重构方案 v2' })
  assert.equal(off, true)
  assert.equal(delivered.length, 5, 'plan-review 默认关闭不应弹')
  await instance.updateSettings({ notifyPlanReview: true })
  // 真实传感器的时序：等待解除 → 再次等待（每次等待都是一次新的上报）
  instance.reportPending({ sessionId: 'live' })
  const on = instance.reportPending({ sessionId: 'live', kind: 'plan-review', title: '重构方案 v2' })
  assert.equal(on, true)
  assert.deepEqual(delivered[5], { title: '等待计划评审', body: '重构方案 v2', tag: 'dsh-notification-pending-live-3' })
})

await step('步骤 9｜非法上报拒绝（跨进程输入不可信）', () => {
  assert.equal(instance.reportPending({}), false, '缺 sessionId 应拒绝')
  assert.equal(instance.reportPending({ sessionId: '' }), false, '空 sessionId 应拒绝')
  assert.equal(instance.reportPending('x'), false, '非对象应拒绝')
  assert.equal(delivered.length, 6, '拒绝的上报不应产生通知')
})

await step('步骤 10｜总开关关闭/恢复（改动即时生效）', async () => {
  await instance.updateSettings({ enabled: false })
  live.append('turn/start', { turn: 5 })
  live.append('turn/end', { turn: 5, reason: { kind: 'completed' } })
  assert.equal(delivered.length, 6, '总开关关闭应全部抑制')
  await instance.updateSettings({ enabled: true })
  live.append('turn/start', { turn: 6 })
  live.append('assistant/message', { turn: 6, message: { content: [{ type: 'text', text: '恢复后的完成' }] } })
  live.append('turn/end', { turn: 6, reason: { kind: 'completed' } })
  assert.equal(delivered.length, 7, '总开关恢复应照常投递')
  assert.equal(delivered[6].tag, 'dsh-notification-live-6')
})

await step('步骤 11｜tray-notify.json 文件契约（真实写入：托盘读走即删的那份）', () => {
  const raw = JSON.parse(readFileSync(trayFile, 'utf8'))
  assert.equal(raw.title, delivered[6].title, '文件 title 必须与最后一次投递一致（托盘只看得到最后一条）')
  assert.equal(raw.body, delivered[6].body)
  assert.equal(typeof raw.ts, 'number', 'ts 必须是毫秒时间戳')
  assert.ok(raw.title.length <= 64 && raw.body.length <= 256, '长度契约 64/256')
})

await step('步骤 12｜测试通知（设置卡片按钮）：走真实投递端、tag 唯一、不经规则与去重', () => {
  const before = delivered.length
  assert.equal(instance.testNotify(), true, 'testNotify 必须返回"已交投递端"')
  assert.equal(delivered.length, before + 1, '测试通知必须真的走投递端（而不是只回个 ok）')
  const first = delivered.at(-1)
  assert.equal(first.title, '任务通知测试')
  assert.match(first.tag, /^dsh-notification-test-\d+-\d+$/, 'tag 必须唯一——同 tag 会被系统静默吞掉（连点第二次就看不到）')
  const raw = JSON.parse(readFileSync(trayFile, 'utf8'))
  assert.equal(raw.title, first.title, '测试通知同样要落进文件契约（托盘只读文件）')
  // 连点第二次：tag 必须不同（否则用户会以为按钮坏了）
  instance.testNotify()
  assert.notEqual(delivered.at(-1).tag, first.tag, '两次测试通知的 tag 不得相同')
})

await step('步骤 13｜backgroundOnly：任务就在眼前时不打扰，切走/失焦照常通知', () => {
  // 这是 host 唯一拿不到的判定输入（是否前台 + 正在看哪个会话），由启动器薄传感器上报
  assert.equal(instance.reportPresence({ visible: true, activeSessionId: 'live' }), true, '合法存在态应被接受')
  assert.equal(instance.reportPresence({ visible: 'yes' }), false, '形状非法应被拒绝（跨进程输入不可信）')

  const before = delivered.length
  live.append('turn/start', { turn: 7 })
  live.append('assistant/message', { turn: 7, message: { content: [{ type: 'text', text: '眼前完成的' }] } })
  live.append('turn/end', { turn: 7, reason: { kind: 'completed' } })
  assert.equal(delivered.length, before, '页面在前台且正在看该会话 → 不该投递')
  assert.ok(transcript.some(l => l.includes('backgroundOnly')), '抑制必须留痕（否则用户以为通知坏了）')

  // 页面不在眼前（失焦/切走）→ 下一个 turn 必须通知
  instance.reportPresence({ visible: false })
  live.append('turn/start', { turn: 8 })
  live.append('assistant/message', { turn: 8, message: { content: [{ type: 'text', text: '切走后完成的' }] } })
  live.append('turn/end', { turn: 8, reason: { kind: 'completed' } })
  assert.equal(delivered.length, before + 1, '页面不在眼前 → 照常投递')
  assert.equal(delivered.at(-1).body, '切走后完成的')
})

await step('步骤 14｜requireInteraction（"需要手动关闭"）→ 托盘文件带 persistent', async () => {
  await instance.updateSettings({ requireInteraction: true })
  instance.testNotify()
  const on = JSON.parse(readFileSync(trayFile, 'utf8'))
  assert.equal(on.persistent, true, '开启后托盘必须收到 persistent=true（托盘据此用 scenario="reminder" 常驻呈现）')
  await instance.updateSettings({ requireInteraction: false })
  instance.testNotify()
  const off = JSON.parse(readFileSync(trayFile, 'utf8'))
  assert.equal(off.persistent, false, '关闭后回到系统默认时长')
})

// 收尾：卸载 + 清理
globalThis.__dispose()
rmSync(launcherDir, { recursive: true, force: true })

console.log('\n────────── 运行转录（= native-launcher.log 会看到的样子）──────────')
for (const text of transcript) console.log(text)
console.log('────────── 转录结束 ──────────')

if (failures.length > 0) {
  console.log(`\n✗ ${failures.length} 个场景失败：${failures.join('；')}`)
  process.exit(1)
}
console.log(`\n✓ 全部 ${STEP_TOTAL} 个场景通过（产物 ${'lib/modules/notification/index.js'} 端到端链路健康）`)
