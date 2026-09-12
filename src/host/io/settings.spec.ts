import { describe, expect, it } from 'vitest'
import type { LauncherConfig, SettingsProviderLike, SettingsScopeLike } from '../types.ts'
import { LAUNCHER_SETTINGS_SCHEMA, SETTINGS_NAMESPACE, registerLauncherSettings } from './settings.ts'

function makeCtx(resolved?: LauncherConfig, registerError?: Error): {
  ctx: { settings?: SettingsProviderLike }
  calls: Array<{ namespace: string; base: unknown }>
  state: { watched: number }
} {
  const calls: Array<{ namespace: string; base: unknown }> = []
  // 闭包计数装对象里（原始值解构会拷贝，递增后断言读不到——测试自身的经典陷阱）
  const state = { watched: 0 }
  const ctx: { settings?: SettingsProviderLike } = {}
  if (registerError || resolved !== undefined) {
    ctx.settings = {
      register<T>(namespace: string, _schema: unknown, options: { base?: unknown }): SettingsScopeLike<T> {
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
      },
    }
  }
  return { ctx, calls, state }
}

describe('registerLauncherSettings', () => {
  it('正常路径：以正确 namespace 注册、cfg = patch base 与官方 resolved 的合并', () => {
    const { ctx, calls, state } = makeCtx({ port: 3081 })
    const config: LauncherConfig = { launchCommand: 'custom cmd' }
    const logs: string[] = []
    const { scope, cfg } = registerLauncherSettings(ctx, config, (m) => logs.push(m))
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

  it('settings 服务未注入：降级用 patch 配置，不拖垮启动', () => {
    const logs: string[] = []
    const config: LauncherConfig = { port: 1234 }
    const { scope, cfg } = registerLauncherSettings({}, config, (m) => logs.push(m))
    expect(scope).toBeNull()
    expect(cfg).toBe(config)
    expect(logs).toContain('settings service unavailable, using patch config only')
  })

  it('register 抛错（如 fiber 重载竞态重复注册）：降级 patch 配置，打点带原因', () => {
    const { ctx } = makeCtx(undefined, new Error('already registered'))
    const logs: string[] = []
    const config: LauncherConfig = { autoOpen: false }
    const { scope, cfg } = registerLauncherSettings(ctx, config, (m) => logs.push(m))
    expect(scope).toBeNull()
    expect(cfg).toBe(config)
    expect(logs).toContain('settings register skipped: already registered')
  })

  it('真实 schemastery schema：默认值与 README/cordis.patch.yml 口径一致', () => {
    // 官方 register 会调用 schema(...) 做三层合并的第一层；这里直接调 schema 验证默认值
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
})
