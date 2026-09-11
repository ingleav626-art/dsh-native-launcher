/**
 * 官方 `settings.section` 槽位的注册适配——全项目唯一触碰该槽位形状的地方。
 *
 * 两个版本形态（原实现的实际经验，改一处就够）：
 * - alpha.2+ 有 `slots.inject`：走生成器（槽位账本就绪后才挂卡），且 `label` 必须是**函数**
 *   （与官方"插件"段同款写法）；
 * - rc.2 无 `slots.inject`：直接注册，`label` 接受**字符串**。
 *
 * 注册失败只记日志、绝不向上抛：设置卡片挂不上不该拖累整个页面（铁律 1 的 client 版）。
 */
import { clientWarn } from './log.ts'
import type { ClientContextLike, SlotComponent } from './types.ts'

/** 一节设置卡片的参数（槽位名由本模块补全）。 */
export interface SettingsSectionSpec {
  readonly id: string
  readonly order: number
  readonly label: string
  readonly inject: () => Record<string, unknown>
}

/**
 * 把一节卡片注册进官方设置页。
 * @param ctx - 官方 client ctx（只在组装根与本文件被触摸）。
 * @param spec - 卡片标识 / 排序 / 导航文案 / 注入面。
 * @param component - 卡片组件。
 */
export function registerSettingsSection(
  ctx: ClientContextLike,
  spec: SettingsSectionSpec,
  component: SlotComponent,
): void {
  try {
    const slots = ctx.slots
    if (slots === undefined) {
      clientWarn(`[settings] 槽位服务不可用：卡片 ${spec.id} 未注册`)
      return
    }
    if (typeof slots.inject === 'function') {
      const label = spec.label
      slots.inject('settings.section', function* () {
        yield slots.register(
          { name: 'settings.section', id: spec.id, order: spec.order, label: () => label, inject: spec.inject },
          component,
        )
      })
      return
    }
    slots.register(
      { name: 'settings.section', id: spec.id, order: spec.order, label: spec.label, inject: spec.inject },
      component,
    )
  } catch (error) {
    clientWarn(`[settings] 卡片 ${spec.id} 注册失败（仅该卡片不可见）：${String(error)}`)
  }
}
