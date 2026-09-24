/**
 * 官方 settings 作用域的双机制适配——全项目唯一「合成设置作用域」的地方。
 *
 * 两种运行形态（2026-09-24 沙箱探针实证，dsh 0.1.7-rc.1）：
 * - 旧（≤0.1.6）：`ctx.settings.register(ns, schema, { base })` → 官方 scope（get/update/watch/replace）
 * - 新（≥0.1.7）：`ctx.settings` = SettingsForms，**没有 register**；配置 schema 来自插件
 *   `export const Config`（schemastery，须 `.volatile()`，否则官方报
 *   `Plugin entry "x" has no volatile fields`）；读取走 `describe()`（value = 实例合并值），
 *   写入走 `update(ns, patch, revision)`，变更观察走 `ctx.on('settings/document-updated', (ns, revision))`。
 *
 * 对外统一暴露 SettingsScopeLike——上层（RPC / 通知模块）零改动。
 *
 * 新机制的两条实测硬约束：
 * ① **apply 期间自己的 entry 不在 describe 里**（fiber 未 active，被 `state !== 2` 过滤）
 *    → `ready()` 等首个 document-updated 事件（带超时兜底）之后才能读到配置；
 * ② **volatile 字段不进 apply 的 config 入参**（官方不重载插件实例）
 *    → 配置必须以 describe 的 `value` 为准，`base`/config 只作兜底。
 */
import type {
  LogFn, SettingsDescriptorLike, SettingsProviderLike, SettingsScopeLike,
} from '../types.ts'

/** 事件面窄接口（避免整块依赖 HostCtx）。 */
interface EventCtx {
  on?(name: string, listener: (...args: unknown[]) => unknown): unknown
}

/** 主设置条目的 profile entry id（= 本插件 entry；新机制下所有配置都挂在这一条下）。 */
export const MAIN_SETTINGS_ENTRY = 'native-launcher'

/**
 * ns → entry 配置子路径（新机制用）。
 *
 * 官方 0.1.7 的 `describe()` **只遍历 profile entries**，而本插件内部模块各有自己的设置 ns
 * （通知模块用 `dsh-native-notification`）——它们不是 profile entry，故新机制下必须
 * 映射到主 entry 的子段（主 Config 里对应一个 `notification` 子 schema）。
 * 旧机制不受影响：直接用各自 ns 注册。
 */
export const SETTINGS_SUBPATH: Record<string, readonly string[]> = {
  'native-launcher': [],
  'dsh-native-notification': ['notification'],
}

/** 取某 ns 在新机制下对应的子路径；未登记返回 undefined（调用方降级）。 */
export function subPathOf(ns: string): readonly string[] | undefined {
  return SETTINGS_SUBPATH[ns]
}

/** 是否为新机制（SettingsForms：无 register 但有 describe）。 */
export function isFormsMechanism(settings: SettingsProviderLike | undefined): boolean {
  return !!settings && typeof settings.register !== 'function' && typeof settings.describe === 'function'
}

/**
 * 从 cordis ctx 安全取 settings 服务。
 *
 * settings **不在插件的 inject 清单里**（可选能力，见 src/index.ts 的 inject 注释）——
 * cordis 4 对未声明服务的**属性访问**会直接抛（`cannot get property "settings" without
 * inject`），因此必须走 `ctx.get`（免守卫）并容错缺失。
 */
export function getSettingsService(ctx: { get(name: string): unknown }): SettingsProviderLike | undefined {
  try {
    return (ctx.get('settings') as SettingsProviderLike | undefined) ?? undefined
  } catch {
    return undefined
  }
}

/** 按路径取值（空路径 = 自身）。 */
function pickPath(value: unknown, path: readonly string[]): unknown {
  let node: unknown = value
  for (const key of path) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

/** 把 patch 包进子路径（空路径 = 原样）。 */
function nestPath(path: readonly string[], value: unknown): Record<string, unknown> {
  let acc: unknown = value
  for (let i = path.length - 1; i >= 0; i--) acc = { [path[i] as string]: acc }
  return (acc ?? {}) as Record<string, unknown>
}

export interface FormsScopeOptions {
  settings: SettingsProviderLike
  ctx: EventCtx
  /** profile entry id（= describe 行的 ns）。 */
  ns: string
  /** apply 入参（patch base）——describe 尚未就绪时的兜底。 */
  base: unknown
  /** 子段路径：[] = entry 配置根；通知模块用 ['notification']。 */
  subPath?: readonly string[]
  log: LogFn
  /** ready() 超时兜底（毫秒），默认 2000——正常路径由 100ms 轮询命中，超时只是保险。 */
  readyTimeoutMs?: number
}

/** 新机制作用域：把 SettingsForms 合成旧机制同形的 scope。 */
export function createFormsScope<T extends object>(options: FormsScopeOptions): SettingsScopeLike<T> {
  const { settings, ctx, ns, base, log } = options
  const subPath = options.subPath ?? []
  const readyTimeoutMs = options.readyTimeoutMs ?? 2000

  const readRow = (): SettingsDescriptorLike | undefined => {
    try {
      return settings.describe?.()?.find((row) => row.ns === ns)
    } catch (error) {
      log(`[settings] describe 失败（按 base 兜底）：${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  const get = (): T => {
    const row = readRow()
    const live = row ? pickPath(row.value, subPath) : undefined
    if (live !== undefined && live !== null) return live as T
    const fallback = pickPath(base, subPath)
    return ((fallback ?? base ?? {}) as T)
  }

  const update = async (patch: Partial<T>): Promise<void> => {
    if (typeof settings.update !== 'function') throw new Error('settings.update 不可用')
    await settings.update(ns, nestPath(subPath, patch))
  }

  const replace = async (section: unknown): Promise<void> => {
    if (subPath.length === 0) {
      if (typeof settings.replace !== 'function') throw new Error('settings.replace 不可用')
      await settings.replace(ns, (section ?? {}) as object)
      return
    }
    // 子段无法单独"整段重置"（官方 replace 作用于整个 entry）→ 等价写回传入值
    await update((section ?? {}) as Partial<T>)
  }

  const watch = (listener: (next: T, prev: T) => void): (() => void) => {
    try {
      const off = ctx.on?.('settings/document-updated', (...args: unknown[]) => {
        if (String(args[0] ?? '') !== ns) return
        const next = get()
        listener(next, next)
      })
      return typeof off === 'function' ? (off as () => void) : () => {}
    } catch (error) {
      log(`[settings] document-updated 订阅失败：${error instanceof Error ? error.message : String(error)}`)
      return () => {}
    }
  }

  /**
   * 等本 ns 出现在 describe 里。
   *
   * apply 期间自己的 fiber 尚未 active（官方按 `fiber.state !== 2` 过滤），describe() 拿不到自己；
   * 等 fiber active 后官方才会 emit `settings/document-updated`。
   *
   * **轮询是必需的，不是冗余**：官方的 emit 发生在 `describe()` 内部（比对 raw 后才有回音），
   * 若没人调用 describe()，光靠事件订阅要等到很晚——2026-09-24 沙箱实测：只订阅不轮询时，
   * ready() 一直等到 3s 超时才放行，导致 apply 拿到空配置（日志 `resolved: port=undefined`）
   * 且启动被拖慢 3.2s。轮询既是检查也是"驱动器"。
   *
   * 超时兜底：绝不让本体卡住（拿不到就用 patch base 跑）。
   */
  const ready = (): Promise<void> => new Promise<void>((resolve) => {
    if (readRow() !== undefined) { resolve(); return }
    let settled = false
    let timer: ReturnType<typeof setInterval> | undefined
    const done = () => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearInterval(timer)
      resolve()
    }
    try {
      const off = ctx.on?.('settings/document-updated', (...args: unknown[]) => {
        if (String(args[0] ?? '') !== ns) return
        if (typeof off === 'function') (off as () => void)()
        done()
      })
    } catch { /* 事件面不可用 → 轮询/超时兜底 */ }
    timer = setInterval(() => { if (readRow() !== undefined) done() }, 100)
    setTimeout(done, readyTimeoutMs)
  })

  return { get, update, watch, replace, ready }
}

/** 旧机制作用域：透传官方 register 返回的 scope。 */
export function createLegacyScope<T extends object>(
  settings: SettingsProviderLike,
  ns: string,
  schema: unknown,
  base: unknown,
): SettingsScopeLike<T> {
  if (typeof settings.register !== 'function') throw new Error('settings.register 不可用')
  // **必须方法调用形式**（this = settings）：0.1.5-rc.2 的 register 是读 `this.registrations`
  // 的类方法（官方源码 lib/index.js:283），摘下来裸调 this 丢失 → `Cannot read properties of
  // undefined (reading 'registrations')`——2026-09-24 真机实测（被上层 catch 容住，表现为
  // 设置静默失效，日志只有一条 register skipped）。
  const scope = settings.register<T>(ns, schema, { base })
  const out: SettingsScopeLike<T> = {
    get: () => scope.get(),
    update: (patch) => scope.update(patch),
    watch: (listener) => scope.watch(listener),
  }
  if (typeof scope.replace === 'function') {
    out.replace = (section: unknown) => (scope.replace as (s: unknown) => Promise<void>)(section)
  }
  return out
}
