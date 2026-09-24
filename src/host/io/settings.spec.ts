import { describe, expect, it } from 'vitest'
import type { HostCtx, LauncherConfig, SettingsProviderLike, SettingsScopeLike } from '../types.ts'
import { LAUNCHER_SETTINGS_SCHEMA, SETTINGS_NAMESPACE, registerLauncherSettings } from './settings.ts'

/** 旧机制假 ctx（register 返回 scope）。HostCtx 的 webServer/get 在本用例不参与，给最小占位。 */
function makeLegacyCtx(resolved?: LauncherConfig, registerError?: Error): {
  ctx: HostCtx
  calls: Array<{ namespace: string; base: unknown }>
  state: { watched: number }
} {
  const calls: Array<{ namespace: string; base: unknown }> = []
  // 闭包计数装对象里（原始值解构会拷贝，递增后断言读不到——测试自身的经典陷阱）
  const state = { watched: 0 }
  const settings: SettingsProviderLike = {}
  if (registerError || resolved !== undefined) {
    settings.register = <T>(namespace: string, _schema: unknown, options: { base?: unknown }): SettingsScopeLike<T> => {
      calls.push({ namespace, base: options.base })
      if (registerError) throw registerError
      return {
        get: () => (resolved ?? {}) as T,
        update: async () => {},
        watch: () => {
          state.watched += 1
          return () => {}
        },
      }
    }
  }
  return {
    ctx: {
      settings,
      // getSettingsService 走 ctx.get('settings')（settings 不在 inject）——伪造 get 面返回服务
      get: (name: string) => (name === 'settings' ? settings : undefined),
      webServer: {} as never,
    } as unknown as HostCtx,
    calls,
    state,
  }
}

/**
 * 新机制假 ctx（0.1.7+ SettingsForms：无 register）。
 * @param live - describe 里本 ns 的 value（模拟"用户设置 + patch 合并后的 live 值"）
 * @param visible - false 模拟 apply 期间自己的 entry 还不出现在 describe（沙箱实测行为）
 */
function makeFormsCtx(live: LauncherConfig, options: { visible?: boolean; events?: boolean } = {}): {
  ctx: HostCtx
  updates: Array<{ ns: string; patch: unknown }>
  replaces: Array<{ ns: string; section: unknown }>
  fire: () => void
  state: { described: number }
} {
  const updates: Array<{ ns: string; patch: unknown }> = []
  const replaces: Array<{ ns: string; section: unknown }> = []
  const state = { described: 0 }
  const listeners: Array<(...args: unknown[]) => unknown> = []
  let visible = options.visible !== false
  const formsSettings: SettingsProviderLike = {
    describe: () => (visible ? [{ ns: SETTINGS_NAMESPACE, value: live, revision: 0, autoGenerate: true, applies: 'live' }] : []),
    update: async (ns: string, patch: object) => { updates.push({ ns, patch }) },
    replace: async (ns: string, section: object) => { replaces.push({ ns, section }) },
    configure: () => {},
  }
  const ctx = {
    webServer: {} as never,
    // getSettingsService 走 ctx.get('settings') —— 伪造 get 面返回 forms 服务
    get: (name: string) => (name === 'settings' ? formsSettings : undefined),
    on: (name: string, listener: (...args: unknown[]) => unknown) => {
      if (name === 'settings/document-updated') listeners.push(listener)
      return () => {}
    },
    settings: formsSettings,
  } as unknown as HostCtx
  return {
    ctx,
    updates,
    replaces,
    fire: () => { visible = true; for (const l of listeners) l(SETTINGS_NAMESPACE, 0) },
    state,
  }
}

describe('registerLauncherSettings（旧机制 ≤0.1.6）', () => {
  it('正常路径：以正确 namespace 注册、cfg = patch base 与官方 resolved 的合并', async () => {
    const { ctx, calls, state } = makeLegacyCtx({ port: 3081 })
    const config: LauncherConfig = { launchCommand: 'custom cmd' }
    const logs: string[] = []
    const { scope, cfg } = await registerLauncherSettings(ctx, config, (m) => logs.push(m))
    // 注册参数：namespace 固定、base = patch 配置（官方做 默认值→base→用户 三层合并）
    expect(calls).toHaveLength(1)
    expect(calls[0]?.namespace).toBe(SETTINGS_NAMESPACE)
    expect(calls[0]?.base).toBe(config)
    // 合并结果：patch 的 launchCommand 保留，官方 resolved 的 port 覆盖
    expect(cfg).toEqual({ launchCommand: 'custom cmd', port: 3081 })
    expect(scope).not.toBeNull()
    // 官方变更监听已订阅（用户改设置 → 日志提醒重启生效）
    expect(state.watched).toBe(1)
    expect(logs.some((m) => m.startsWith('[settings] registered ns=native-launcher (resolved:'))).toBe(true)
  })

  it('settings 服务未注入：降级用 patch 配置，不拖垮启动', async () => {
    const logs: string[] = []
    const config: LauncherConfig = { port: 1234 }
    const ctx = { webServer: {} as never, get: () => undefined } as unknown as HostCtx
    const { scope, cfg } = await registerLauncherSettings(ctx, config, (m) => logs.push(m))
    expect(scope).toBeNull()
    expect(cfg).toBe(config)
    expect(logs).toContain('settings service unavailable, using patch config only')
  })

  it('register 抛错（如 fiber 重载竞态重复注册）：降级 patch 配置，打点带原因', async () => {
    const { ctx } = makeLegacyCtx(undefined, new Error('already registered'))
    const logs: string[] = []
    const config: LauncherConfig = { autoOpen: false }
    const { scope, cfg } = await registerLauncherSettings(ctx, config, (m) => logs.push(m))
    expect(scope).toBeNull()
    expect(cfg).toBe(config)
    expect(logs).toContain('settings register skipped: already registered')
  })
})

describe('registerLauncherSettings（新机制 0.1.7+ SettingsForms）', () => {
  it('无 register 时走 describe：cfg 取 describe 的 live 值（patch 兜底、用户值优先）', async () => {
    // 用户设置 port=9999；patch base 只有 launchCommand —— 合并后两者都在
    const { ctx } = makeFormsCtx({ port: 9999 })
    const config: LauncherConfig = { launchCommand: 'from patch' }
    const logs: string[] = []
    const { scope, cfg } = await registerLauncherSettings(ctx, config, (m) => logs.push(m))
    expect(cfg).toEqual({ launchCommand: 'from patch', port: 9999 })
    expect(scope).not.toBeNull()
    expect(scope?.ready).toBeTypeOf('function')
    // 打点文本与旧机制同形（日志对账口径）
    expect(logs.some((m) => m.startsWith('[settings] registered ns=native-launcher (resolved:'))).toBe(true)
  })

  it('apply 期间自己不在 describe（沙箱实测）：ready() 等变更事件后取到配置，超时则回落 base', async () => {
    // visible=false = apply 期自己的 fiber 未 active → describe 返回空
    const { ctx, fire } = makeFormsCtx({ port: 7777 }, { visible: false })
    const config: LauncherConfig = { launchCommand: 'patch cmd' }
    const pending = registerLauncherSettings(ctx, config, () => {})
    // 就绪事件到达（官方随后会为每个条目发一次 document-updated）
    fire()
    const { cfg } = await pending
    // 事件就绪后 cfg = 官方 live 值（而非 patch base）——ready() 的核心语义
    expect(cfg).toEqual({ launchCommand: 'patch cmd', port: 7777 })
  })

  it('update/replace 走官方 SettingsForms 的对应方法（ns = profile entry id）', async () => {
    const { ctx, updates, replaces } = makeFormsCtx({ port: 3080 })
    const { scope } = await registerLauncherSettings(ctx, {}, () => {})
    await scope?.update({ port: 4000 })
    await scope?.replace?.({})
    expect(updates).toEqual([{ ns: SETTINGS_NAMESPACE, patch: { port: 4000 } }])
    expect(replaces).toEqual([{ ns: SETTINGS_NAMESPACE, section: {} }])
  })
})

describe('LAUNCHER_SETTINGS_SCHEMA 默认值', () => {
  it('与 README / cordis.patch.yml 口径一致（volatile 标记不影响取值）', () => {
    const resolved = LAUNCHER_SETTINGS_SCHEMA({}) as Record<string, unknown>
    expect(resolved.launchCommand).toBe('dsh --profile web --no-open')
    expect(resolved.port).toBe(3080)
    expect(resolved.shortcutName).toBe('DSH WebUI')
    expect(resolved.autoOpen).toBe(true)
    expect(resolved.openMode).toBe('app')
    expect(resolved.tray).toBe(true)
    expect(resolved.traySurvivesDsh).toBe(true)
    expect(resolved.trayNotify).toBe(true)
    expect(resolved.closeToExit).toBe(true)
    expect(resolved.closeToExitDebounceSeconds).toBe(20)
    expect(resolved.closeToExitFinalConfirmSeconds).toBe(2)
    expect(resolved.force).toBe(false)
    expect(resolved.modules).toEqual({ notifications: true })
  })

  it('旧机制 schema 刻意不带 volatile（volatile 只加在组装根 Config 上）', () => {
    // 依据：volatile 会改变 schema 求值语义（返回 volatile 包装），而旧版官方（≤0.1.6）
    // 不识别 meta.volatile 会照常求值合并 → 混用会污染配置。新机制要求的 volatile
    // 由 src/index.ts 的 Config 单独承担（沙箱实测：未标记时官方报 no volatile fields）。
    expect((LAUNCHER_SETTINGS_SCHEMA as unknown as { meta?: { volatile?: boolean } }).meta?.volatile).toBeFalsy()
  })
})
