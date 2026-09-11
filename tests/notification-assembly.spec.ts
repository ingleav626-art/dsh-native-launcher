/**
 * 装配集成测试：容器协议 v2（工厂 + 依赖注入）下的端到端接线。
 *
 * 覆盖：装配不炸 / 投影注册形状 / settings namespace / pending 上报转发与拒绝 /
 * 未装配时的安全降级（对应铁律 1「模块全炸本体照跑」的边界）。
 */
import { describe, expect, it } from 'vitest'
import { createNotificationModule, type NotificationModuleDeps } from '../src/modules/notification/host/index.ts'
import { SETTINGS_NAMESPACE } from '../src/modules/notification/host/settings.ts'
import type { ProjectionDefinitionLike } from '../src/modules/notification/host/ports.ts'
import type { TrayNotification } from '../src/modules/notification/shared/types.ts'

/** 端口替身：只替换外部边界（投影接缝 / 会话 / 设置 / 投递 / 日志），链路内部全走真实实现。 */
function fakeDeps(): {
  deps: NotificationModuleDeps
  registered: ProjectionDefinitionLike[]
  delivered: TrayNotification[]
  settingsCalls: Array<{ namespace: string; schema: unknown; base: unknown }>
} {
  const registered: ProjectionDefinitionLike[] = []
  const delivered: TrayNotification[] = []
  const settingsCalls: Array<{ namespace: string; schema: unknown; base: unknown }> = []
  return {
    registered,
    delivered,
    settingsCalls,
    deps: {
      logger: { info: () => {}, warn: () => {}, fail: () => {} },
      notify: { notify: notification => { delivered.push(notification) } },
      projections: {
        register: definition => { registered.push(definition) },
        onChanged: () => () => {},
        snapshot: () => ({}),
      },
      sessions: { list: () => [], get: () => undefined },
      settingsScope: <T>(namespace: string, schema: unknown, base: Partial<T>) => {
        settingsCalls.push({ namespace, schema, base })
        const value = { ...(base as T) }
        return { get: () => value, update: async () => {}, watch: () => () => {} }
      },
    },
  }
}

describe('通知模块装配（容器协议 v2）', () => {
  it('start() 完成装配：注册 notification 投影 + 注册模块自有 settings 作用域', () => {
    const { deps, registered, settingsCalls } = fakeDeps()
    const module = createNotificationModule(deps)
    const dispose = module.start()
    expect(registered.map(definition => definition.key)).toEqual(['notification'])
    expect(registered[0]?.stateVersion).toBe(1)
    expect(settingsCalls[0]?.namespace).toBe(SETTINGS_NAMESPACE)
    expect(typeof dispose).toBe('function')
  })

  it('模块自述与容器护栏字段齐备（id 与既有配置项 modules.notifications 对齐）', () => {
    const { deps } = fakeDeps()
    const module = createNotificationModule(deps)
    expect(module.id).toBe('notifications')
    expect(module.apiVersion).toBe(2)
    expect(module.settingsNamespace).toBe(SETTINGS_NAMESPACE)
  })

  it('start() 之前的 pending 上报被安全拒绝（不抛、不投递）', () => {
    const { deps, delivered } = fakeDeps()
    const module = createNotificationModule(deps)
    expect(module.reportPending({ sessionId: 's1', kind: 'approval' })).toBe(false)
    expect(delivered).toHaveLength(0)
  })

  it('start() 之后：合法上报被接受且经链路投递，非法形状被拒', () => {
    const { deps, delivered } = fakeDeps()
    const module = createNotificationModule(deps)
    module.start()
    // 首见播种
    expect(module.reportPending({ sessionId: 's1', kind: undefined })).toBe(true)
    // 等待出现 → 投递
    expect(module.reportPending({ sessionId: 's1', kind: 'approval', title: 'Deploy' })).toBe(true)
    expect(delivered.map(item => item.title)).toEqual(['等待你的批准'])
    // 形状非法（缺 sessionId）被拒
    expect(module.reportPending({ kind: 'approval' })).toBe(false)
    expect(module.reportPending(null)).toBe(false)
  })

  it('投影接缝抛错时装配失败向上抛出（由容器隔离，不由模块吞掉）', () => {
    const { deps } = fakeDeps()
    const broken: NotificationModuleDeps = {
      ...deps,
      projections: {
        register: () => { throw new Error('sessionProjections 服务不可用') },
        onChanged: () => () => {},
        snapshot: () => ({}),
      },
    }
    const module = createNotificationModule(broken)
    expect(() => module.start()).toThrow('sessionProjections 服务不可用')
  })
})
