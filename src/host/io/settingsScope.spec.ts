import { describe, expect, it } from 'vitest'
import { MAIN_SETTINGS_ENTRY, createFormsScope, isFormsMechanism, subPathOf } from './settingsScope.ts'

describe('isFormsMechanism（双机制判据）', () => {
  it('有 describe 且无 register = 新机制（0.1.7+ SettingsForms）', () => {
    expect(isFormsMechanism({ describe: () => [] } as never)).toBe(true)
  })

  it('有 register = 旧机制（≤0.1.6）；未注入 = 非新机制（走降级）', () => {
    expect(isFormsMechanism({ register: (() => ({})) as never } as never)).toBe(false)
    expect(isFormsMechanism(undefined)).toBe(false)
  })
})

describe('subPathOf（新机制 ns → 主 entry 子段）', () => {
  it('启动器 = 根段落；通知模块 = notification 子段；未登记 = undefined（调用方降级）', () => {
    expect(subPathOf('native-launcher')).toEqual([])
    expect(subPathOf('dsh-native-notification')).toEqual(['notification'])
    expect(subPathOf('not-registered')).toBeUndefined()
  })
})

/**
 * 假 SettingsForms ctx。
 * @param live - describe 返回的 value（未就绪时 describe 返回空数组，模拟 apply 期自身 fiber 未 active）
 */
function makeForms(live: Record<string, unknown>, initiallyEmpty = false) {
  const updates: Array<{ ns: string; patch: unknown }> = []
  const replaces: Array<{ ns: string; section: unknown }> = []
  const listeners: Array<(...args: unknown[]) => unknown> = []
  let ready = !initiallyEmpty
  const settings = {
    describe: () => (ready ? [{ ns: MAIN_SETTINGS_ENTRY, value: live, revision: 0 }] : []),
    update: async (ns: string, patch: object) => { updates.push({ ns, patch }) },
    replace: async (ns: string, section: object) => { replaces.push({ ns, section }) },
  }
  const ctx = {
    on: (name: string, listener: (...args: unknown[]) => unknown) => {
      if (name === 'settings/document-updated') listeners.push(listener)
      return () => {}
    },
  }
  return {
    settings,
    ctx,
    updates,
    replaces,
    fire: (ns = MAIN_SETTINGS_ENTRY) => { ready = true; for (const l of listeners) l(ns, 0) },
  }
}

describe('createFormsScope（新机制作用域合成）', () => {
  it('子路径读写：get 取子段；update 把 patch 包进子段；replace 退化为子段写回', async () => {
    const f = makeForms({ port: 3080, notification: { enabled: false, rules: [] } })
    const scope = createFormsScope<{ enabled: boolean }>({
      settings: f.settings as never,
      ctx: f.ctx,
      ns: MAIN_SETTINGS_ENTRY,
      base: {},
      subPath: ['notification'],
      log: () => {},
    })
    // 读：只取子段（不要把整个 entry 配置当模块设置）
    expect(scope.get()).toEqual({ enabled: false, rules: [] })
    // 写：patch 必须包在子段下（否则会污染启动器字段）
    await scope.update({ enabled: true })
    expect(f.updates).toEqual([{ ns: MAIN_SETTINGS_ENTRY, patch: { notification: { enabled: true } } }])
    // 子段无"整段重置"语义 → replace 退化为写回
    await scope.replace?.({ enabled: false })
    expect(f.replaces).toEqual([])
    expect(f.updates[1]).toEqual({ ns: MAIN_SETTINGS_ENTRY, patch: { notification: { enabled: false } } })
  })

  it('根路径 replace 走官方 replace（卸载清配置语义）', async () => {
    const f = makeForms({ port: 3080 })
    const scope = createFormsScope<{ port: number }>({
      settings: f.settings as never,
      ctx: f.ctx,
      ns: MAIN_SETTINGS_ENTRY,
      base: {},
      log: () => {},
    })
    await scope.replace?.({})
    expect(f.replaces).toEqual([{ ns: MAIN_SETTINGS_ENTRY, section: {} }])
  })

  it('ready：apply 期 describe 不含自己 → 等变更事件；超时兜底不卡本体', async () => {
    const f = makeForms({ port: 9999 }, true)
    const scope = createFormsScope<{ port: number }>({
      settings: f.settings as never,
      ctx: f.ctx,
      ns: MAIN_SETTINGS_ENTRY,
      base: { port: 1 },
      log: () => {},
      readyTimeoutMs: 5000,
    })
    // 未就绪：get 回落 base（不让 apply 拿到 undefined）
    expect(scope.get()).toEqual({ port: 1 })
    const pending = scope.ready?.()
    f.fire()
    await pending
    // 就绪后读到官方 live 值
    expect(scope.get()).toEqual({ port: 9999 })
  })

  it('watch：仅本 ns 的 document-updated 触发回调', async () => {
    const f = makeForms({ port: 3080 })
    const scope = createFormsScope<{ port: number }>({
      settings: f.settings as never,
      ctx: f.ctx,
      ns: MAIN_SETTINGS_ENTRY,
      base: {},
      log: () => {},
    })
    let hits = 0
    scope.watch(() => { hits += 1 })
    f.fire('some-other-entry')
    expect(hits).toBe(0)
    f.fire()
    expect(hits).toBe(1)
  })
})
