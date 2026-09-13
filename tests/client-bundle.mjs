#!/usr/bin/env node
/**
 * 启动器 **client 产物**的端到端冒烟（闸④的 client 版；必须在 `npm run build` 之后跑）。
 *
 * 测的都是"改一下就静默坏掉、而且只有打开设置页才看得出来"的东西：
 *  1. **线格式**：产物必须调用 `window.__ModuleLoader__.load({ id: 'dsh-native-launcher', factory })`
 *     ——id 与插件 id 不一致时 dsh client loader 不会把 factory 挂进 client graph，
 *     表现是"插件一切正常，但设置页里什么都没有"（P0 的 build.mjs 骨架里就写错过这个 id）。
 *  2. **工厂契约**：`factory(require)` 返回 `{ apply, inject }`，`inject` 声明官方服务依赖。
 *  3. **装配路径**：`apply(ctx)` 注册两节设置卡片（启动器 + 通知）、发起在线心跳、注入图标。
 *  4. **pending 传感器**：会话等待态出现 → 经 RPC 上报（host 决策与投递的前提）。
 *  5. **首见播种**：页面打开时已存在的会话也要上报一次——否则 host 把该会话此后的首次等待
 *     当作"首见"吞掉，表现为"每个会话的第一次等待通知不弹"（P1-e-2 旧实现的真实缺陷）。
 *  6. **失败隔离**：官方服务缺失时装配照常完成（铁律 1 的 client 版）。
 *
 * 环境替身只伪造**外部边界**（window / document / fetch / 官方 client 服务面），
 * 被测链路（产物本身 → 工厂 → apply → 卡片注册与传感器）全部走真实实现。
 *
 * 运行：node tests/client-bundle.mjs（退出码非 0 即失败）
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundleCode = readFileSync(join(root, 'lib/client.js'), 'utf8')

/** 官方 app 注入的 react 替身（本测试不渲染组件，只保证 import 有对象可拿）。 */
const REACT_STUB = {
  createElement: () => ({}),
  useState: () => [undefined, () => {}],
  useEffect: () => {},
}

/** 出厂通知设置：与 host 侧 schema 的默认值逐字一致（形状漂移会被卡片侧守卫挡下）。 */
const DEFAULT_SETTINGS = {
  enabled: true,
  notifyCompleted: true,
  notifyError: true,
  notifyAborted: false,
  notifyBlocked: false,
  notifyMaxTokens: false,
  notifyApproval: true,
  notifyQuestion: true,
  notifyPlanReview: false,
  rules: [],
  requireInteraction: false,
  backgroundOnly: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// 外部边界替身
// ─────────────────────────────────────────────────────────────────────────────

/** 造一个场景的执行环境（window / document / 官方 client 服务面 / RPC 记录）。 */
function createEnv(options = {}) {
  const rpcCalls = []
  const fetched = []
  const consoleCalls = []
  const sections = []
  const injectedSlots = []
  const storeSubs = { list: [], pending: [] }
  const sessionsState = { ids: [], byId: {}, current: undefined }
  const pendingState = new Map()
  /** 事件监听器（测试可主动触发：页面可见性/焦点变化正是存在态传感器的输入）。 */
  const listeners = { window: {}, document: {} }
  const on = (scope, type, fn) => { (listeners[scope][type] ??= []).push(fn) }
  const fire = (scope, type) => { for (const fn of listeners[scope][type] ?? []) fn() }

  const element = tag => ({
    tag,
    style: {},
    children: [],
    textContent: '',
    id: '',
    setAttribute() {},
    appendChild(child) { this.children.push(child); return child },
    remove() {},
    removeChild() {},
    addEventListener() {},
    querySelectorAll: () => [],
  })

  const document = {
    head: element('head'),
    body: element('body'),
    hidden: false,
    // 见 presence.ts 的 readPresence：可见性 = !hidden && hasFocus()（真机语义）
    hasFocus: () => true,
    createElement: element,
    createTextNode: text => ({ text }),
    getElementById: () => null,
    addEventListener: (type, fn) => on('document', type, fn),
    querySelectorAll: () => [],
  }

  const window = {
    __ModuleLoader__: { load: config => { window.__loaded = config } },
    __loaded: null,
    location: { origin: 'http://127.0.0.1:3080' },
    localStorage: { getItem: () => null, setItem() {} },
    addEventListener: (type, fn) => on('window', type, fn),
  }

  const rpc = {
    call: async (path, endpoint, payload) => {
      rpcCalls.push({ path, endpoint, payload })
      if (endpoint === 'config.get') return { ok: true, value: { port: 3080, openMode: 'app', shortcutExists: true } }
      if (endpoint === 'notification.get') {
        return options.notificationUnavailable === true
          ? { ok: false, error: { code: 'notification', message: 'notification module not loaded' } }
          : { ok: true, value: DEFAULT_SETTINGS }
      }
      if (endpoint === 'icon.get') return { ok: true, value: { dataUrl: 'data:image/png;base64,AAAA' } }
      return { ok: true, value: {} }
    },
  }

  const listStore = { getSnapshot: () => sessionsState, subscribe: fn => { storeSubs.list.push(fn) } }
  const pendingStore = { getSnapshot: () => pendingState, subscribe: fn => { storeSubs.pending.push(fn) } }

  const slots = {
    register: (descriptor, component) => { sections.push({ descriptor, component }) },
  }
  if (options.withSlotInject === true) {
    // alpha.2+ 形态：槽位账本就绪后才挂卡，label 必须是函数
    slots.inject = (name, body) => { injectedSlots.push({ name, body }) }
  }

  const ctx = {
    connection: options.withoutRpc === true ? {} : { rpc },
    slots,
    get: name => {
      if (options.withoutSessions === true) return undefined
      if (name === 'sessions') return { list: listStore }
      if (name === 'uiSession') return { pendingInteractions: pendingStore }
      return undefined
    },
  }

  return {
    window,
    document,
    ctx,
    rpc,
    rpcCalls,
    fetched,
    consoleCalls,
    fire,
    sections,
    injectedSlots,
    storeSubs,
    sessionsState,
    pendingState,
  }
}

/** 在伪造的全局里执行产物、取回工厂并运行本场景；结束时恢复全局（同进程多场景）。 */
async function withBundle(env, fn) {
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch }
  const realConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug }
  globalThis.window = env.window
  globalThis.document = env.document
  globalThis.fetch = async url => { env.fetched.push(String(url)); return { ok: true } }
  // 监视 console：client 产物**不得**写浏览器日志（用户定调：无规范、用户看不到、我们事后也拿不到）
  for (const level of Object.keys(realConsole)) {
    console[level] = (...args) => { env.consoleCalls.push({ level, text: args.map(String).join(' ') }) }
  }
  try {
    new Function(bundleCode)()
    const loaded = env.window.__loaded
    assert.ok(loaded !== null && loaded !== undefined, '产物没有调用 __ModuleLoader__.load（线格式坏了）')
    assert.equal(typeof loaded.factory, 'function', 'factory 必须是函数（loader 直接调用它）')
    const moduleExports = loaded.factory(name => (name === 'react' ? REACT_STUB : {}))
    assert.ok(moduleExports && typeof moduleExports === 'object', 'factory 必须返回 exports 对象')
    return await fn(loaded, moduleExports)
  } finally {
    Object.assign(console, realConsole)
    globalThis.window = previous.window
    globalThis.document = previous.document
    globalThis.fetch = previous.fetch
  }
}

/** 等一次微任务队列（上报/写入都是 promise，断言前必须让它们落地）。 */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

/** client 不得写浏览器 console（用户定调：无规范、用户看不到、我们事后也拿不到）。 */
function assertNoConsole(env) {
  assert.deepEqual(
    env.consoleCalls,
    [],
    `client 不得写浏览器 console，实际写了：${env.consoleCalls.map(item => `${item.level}: ${item.text}`).join(' | ')}`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 场景
// ─────────────────────────────────────────────────────────────────────────────

const failures = []
/** 场景总数（收尾报告用；加场景时自动计数，别让报告数字骗人）。 */
let STEP_TOTAL = 0
async function step(name, fn) {
  STEP_TOTAL += 1
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  ✗ ${name}`)
    console.log(String(error?.stack ?? error).split('\n').map(line => `      ${line}`).join('\n'))
  }
}

console.log('\n启动器 client 产物冒烟（lib/client.js）\n')

await step('步骤 1｜线格式与工厂契约：id / factory / apply / inject', async () => {
  const env = createEnv()
  await withBundle(env, (loaded, moduleExports) => {
    assert.equal(loaded.id, 'dsh-native-launcher', 'id 必须与插件 id 一致（否则 loader 不认这个 factory）')
    assert.equal(typeof moduleExports.apply, 'function', '必须导出 apply(ctx)')
    assert.deepEqual(
      moduleExports.inject,
      ['slots', 'connection', 'sessions', 'locale'],
      'inject 声明的官方服务依赖不得变化（改了等于换契约）',
    )
  })
})

await step('步骤 2｜装配：两节卡片 + 在线心跳 + 图标 + 日志只回传 host（不写 console）', async () => {
  const env = createEnv()
  await withBundle(env, async (loaded, moduleExports) => {
    moduleExports.apply(env.ctx)
    await flush()

    const launcher = env.sections.find(item => item.descriptor.id === 'native-launcher')
    const notification = env.sections.find(item => item.descriptor.id === 'native-notification')
    assert.ok(launcher !== undefined, '启动器设置卡片必须注册进 settings.section 槽位')
    assert.ok(notification !== undefined, '通知设置卡片必须注册（P1-e-3b 的落地判据）')
    assert.equal(launcher.descriptor.name, 'settings.section')
    assert.equal(launcher.descriptor.order, 30)
    assert.equal(launcher.descriptor.label, 'WebUI 启动器', 'rc.2 无 slots.inject 时 label 是字符串')
    assert.equal(notification.descriptor.order, 31, '通知卡片排在启动器卡片之后')
    assert.equal(notification.descriptor.label, '任务通知')
    for (const item of [launcher, notification]) {
      assert.equal(typeof item.component, 'function', '两节卡片都必须是组件（槽位按组件渲染）')
    }

    // 日志回传：client 侧事件必须进 host 日志（[ntf] 域）——否则 client 就是黑箱
    // （2026-09-11 真实回归：删通知 React 半区时发送端一起没了，host 端点却一直空转）
    const logged = env.rpcCalls.filter(call => call.endpoint === 'ntf-log')
    assert.ok(logged.length >= 1, 'client 启动必须回传至少一条日志到 host（ntf-log 端点）')
    assert.equal(logged[0].path, '/native-launcher')
    assert.equal(logged[0].payload.kind, 'info')
    assert.match(String(logged[0].payload.message), /client 已启动/)
    assert.equal(typeof logged[0].payload.t, 'number', '事件必须带时间戳（host 侧只加行首时间）')

    // 存在态上报：`backgroundOnly`（"任务不在眼前才通知"）的判定输入只有浏览器知道——
    // 页面是否在前台 + 正在看哪个会话。少了它这个开关就是摆设（2026-09-11 用户实测"人在页面前也弹"）
    const presence = env.rpcCalls.filter(call => call.endpoint === 'presence-report')
    assert.ok(presence.length >= 1, 'client 启动必须上报一次存在态（否则 backgroundOnly 失效）')
    assert.equal(typeof presence[0].payload.visible, 'boolean', 'visible 必须是布尔（host 侧形状守卫）')

    // 反向断言：console 一条都不许有（client 日志唯一出口是 host 日志）
    assertNoConsole(env)

    assert.ok(
      env.fetched.some(url => url.includes('/native-launcher/online')),
      '页面加载必须上报在线心跳（关窗即退依赖它判断有无客户端）',
    )
    assert.ok(
      env.rpcCalls.some(call => call.endpoint === 'icon.get'),
      '必须请求图标（favicon 与 PWA manifest 注入依赖它）',
    )
  })
})

await step('步骤 3｜pending 传感器：首见播种 + 等待出现各上报一次', async () => {
  const env = createEnv()
  await withBundle(env, async (loaded, moduleExports) => {
    moduleExports.apply(env.ctx)
    await flush()

    // 页面打开时已存在的会话（无等待）：必须上报一次，host 据此完成播种
    env.sessionsState.ids = ['s1']
    env.sessionsState.byId.s1 = { displayTitle: '部署会话', origin: 'user' }
    for (const notify of env.storeSubs.list) notify()
    await flush()

    // 等待出现（审批）
    env.sessionsState.byId.s1 = { displayTitle: '部署会话', origin: 'user', pendingInteraction: 'approval' }
    for (const notify of env.storeSubs.list) notify()
    await flush()

    const reports = env.rpcCalls.filter(call => call.endpoint === 'pending-report')
    assert.equal(reports.length, 2, '首见与等待出现各一次上报（重复快照不得重复上报）')
    assert.equal(reports[0].path, '/native-launcher')
    assert.deepEqual(
      reports[0].payload,
      { sessionId: 's1', kind: undefined, title: '部署会话', origin: 'user' },
      '首见播种上报：kind 为 undefined，host 据此知道"此会话无等待"',
    )
    assert.equal(reports[1].payload.kind, 'approval')

    // 等待解除：再次上报（host 据此复位该会话的等待态）
    env.sessionsState.byId.s1 = { displayTitle: '部署会话', origin: 'user' }
    for (const notify of env.storeSubs.list) notify()
    await flush()
    const after = env.rpcCalls.filter(call => call.endpoint === 'pending-report')
    assert.equal(after.length, 3)
    assert.equal(after[2].payload.kind, undefined)
  })
})

await step('步骤 4｜等待态只在 uiSession 活内存里（question/plan-review）也能上报', async () => {
  const env = createEnv()
  await withBundle(env, async (loaded, moduleExports) => {
    moduleExports.apply(env.ctx)
    await flush()

    // 会话摘要没有 pendingInteraction：等待态只在 uiSession 的活内存态（P1·X 实验 4 实证）
    env.sessionsState.ids = ['s2']
    env.sessionsState.byId.s2 = { title: '提问会话' }
    env.pendingState.set('s2', { kind: 'question' })
    for (const notify of env.storeSubs.pending) notify()
    await flush()

    const reports = env.rpcCalls.filter(call => call.endpoint === 'pending-report')
    assert.equal(reports.at(-1)?.payload.kind, 'question', 'uiSession 的等待态必须被读出来并上报')
    assert.equal(reports.at(-1)?.payload.sessionId, 's2')
  })
})

await step('步骤 5｜失败隔离：官方服务缺失时装配照常完成（铁律 1）', async () => {
  const env = createEnv({ withoutSessions: true, withoutRpc: true })
  await withBundle(env, (loaded, moduleExports) => {
    assert.doesNotThrow(() => moduleExports.apply(env.ctx), 'apply 不得因官方服务缺失而抛出')
    const ids = env.sections.map(item => item.descriptor.id)
    assert.ok(!ids.includes('native-launcher'), 'rpc 不可用时启动器卡片不注册（注册了也只会显示读取失败）')
    assert.ok(ids.includes('native-notification'), '模块卡片与官方服务无关，仍应注册')
    // 拿不到官方 RPC 时日志必须走直连兜底通道（否则 client 侧发生什么就没人知道）
    assert.ok(
      env.fetched.some(url => url.includes('/native-launcher/ntf-log')),
      'rpc 不可用时必须经直连兜底把日志送达 host（ntf-log）',
    )
    assertNoConsole(env)
  })
})

await step('步骤 6｜slots.inject 形态（alpha.2+）：走生成器且 label 是函数', async () => {
  const env = createEnv({ withSlotInject: true })
  await withBundle(env, (loaded, moduleExports) => {
    moduleExports.apply(env.ctx)
    assert.ok(env.injectedSlots.length >= 1, '有 slots.inject 时必须走生成器注册（槽位账本就绪后才挂卡）')
    for (const injected of env.injectedSlots) {
      assert.equal(injected.name, 'settings.section')
      // 生成器体在槽位就绪时被官方 runner 迭代——这里手动迭代一次，等价于那一刻
      for (const _step of injected.body()) { /* 迭代即执行 register */ }
    }
    const ids = env.sections.map(item => item.descriptor.id)
    assert.ok(ids.includes('native-launcher'), '生成器路径也要注册启动器卡片')
    assert.ok(ids.includes('native-notification'), '生成器路径也要注册通知卡片')
    for (const item of env.sections) {
      assert.equal(typeof item.descriptor.label, 'function', 'inject 路径的 label 必须是函数（rc.2 才接受字符串）')
    }
  })
})

await step('步骤 7｜模块未启用（notification.get 失败）时，卡片仍注册且不抛', async () => {
  const env = createEnv({ notificationUnavailable: true })
  await withBundle(env, async (loaded, moduleExports) => {
    assert.doesNotThrow(() => moduleExports.apply(env.ctx))
    await flush()
    assert.ok(env.sections.some(item => item.descriptor.id === 'native-notification'), '卡片仍注册，由卡片自身显示"未启用"')
  })
})

await step('步骤 8｜存在态传感器：切会话/失焦要重报，状态没变不重发（backgroundOnly 的输入）', async () => {
  const env = createEnv()
  await withBundle(env, async (loaded, moduleExports) => {
    moduleExports.apply(env.ctx)
    await flush()
    const presence = () => env.rpcCalls.filter(call => call.endpoint === 'presence-report')

    assert.equal(presence().length, 1, '启动时上报一次')
    assert.equal(presence()[0].payload.visible, true, 'document 有焦点且未隐藏 → visible=true')

    // 切换当前会话 → 必须重报（host 才能知道"正在看哪个会话"）
    env.sessionsState.current = 's-active'
    for (const notify of env.storeSubs.list) notify()
    await flush()
    assert.equal(presence().length, 2, '会话切换要重报')
    assert.equal(presence()[1].payload.activeSessionId, 's-active')

    // 状态没变 → 不重发（页面事件很密集，去重是硬要求）
    for (const notify of env.storeSubs.list) notify()
    await flush()
    assert.equal(presence().length, 2, '状态未变不得重发')

    // 页面切到后台（visibilitychange）→ visible=false，host 据此恢复通知
    env.document.hidden = true
    env.fire('document', 'visibilitychange')
    await flush()
    assert.equal(presence().length, 3, '可见性变化要重报')
    assert.equal(presence()[2].payload.visible, false, 'hidden=true → visible=false')
  })
})

if (failures.length > 0) {
  console.log(`\n✗ ${failures.length} 个场景失败：${failures.join('；')}`)
  process.exit(1)
}
console.log(`\n✓ client 产物 ${STEP_TOTAL} 个场景全过（线格式 + 装配 + 日志回传 + 传感器接线健康）`)
// client 现在带存在态心跳定时器（`setInterval`，见 src/client/presence.ts）——真实浏览器里它常驻，
// 但在 Node 里会吊住事件循环让本进程不退出，故显式收尾（不是测试通过条件的一部分）。
process.exit(0)
