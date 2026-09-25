/**
 * 通知模块自有 settings namespace：规则与开关的持久化入口。
 *
 * 与上游的**有意差异**（记账）：上游把偏好存 client localStorage（自带 v2/v3/v4 迁移链）；
 * 本项目存官方 settings——schema 校验、持久化、设置页渲染全部由官方服务提供，
 * 于是迁移链、persist key、client 存储全部消失（更稳也更少代码）。
 */
import z from '@deepseek-ai/schemastery'
import type { NotificationSettings } from '../shared/types.ts'
import type { SettingsScopeFactory, SettingsScopeLike } from './ports.ts'

/** 本模块的设置命名空间。 */
export const SETTINGS_NAMESPACE = 'dsh-native-notification'

/** 出厂设置（对齐上游 `defaultNotificationSettings`；sound/soundPath 为本项目扩展，默认走系统音）。 */
export function defaultNotificationSettings(): NotificationSettings {
  return {
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
    sound: 'default',
    soundPath: '',
    soundName: '',
  }
}

/** 单条规则的 schema（`desc` 即设置页文案）。 */
const RULE_SCHEMA = z.object({
  id: z.string().default('').description('规则 id（创建时生成，编辑期间不变）'),
  enabled: z.boolean().default(true).description('启用该规则'),
  mode: z
    .union([
      z.const('include').description('命中才通知'),
      z.const('exclude').description('命中即抑制'),
    ])
    .default('include')
    .description('规则模式'),
  pattern: z.string().default('').description('关键字（或正则）'),
  isRegex: z.boolean().default(false).description('按正则解释 pattern'),
  caseSensitive: z.boolean().default(false).description('区分大小写'),
})

/** 提示音模式的 schema（与 NotificationSoundMode 值域一一对应）。 */
const SOUND_MODE_SCHEMA = z.union([
  z.const('default').description('系统默认提示音'),
  z.const('none').description('静音（弹通知不响）'),
  z.const('custom').description('自定义音效文件'),
]).default('default').description('通知提示音')

/**
 * 设置 schema：与 `defaultNotificationSettings` 的字段一一对应。
 * 对象数组（规则列表）已由沙箱探针实证可注册、可校验、可持久化。
 */
export const NOTIFICATION_SETTINGS_SCHEMA = z.object({
  enabled: z.boolean().default(true).description('任务通知总开关'),
  notifyCompleted: z.boolean().default(true).description('任务完成时通知'),
  notifyError: z.boolean().default(true).description('任务出错时通知'),
  notifyAborted: z.boolean().default(false).description('任务中止时通知'),
  notifyBlocked: z.boolean().default(false).description('任务被阻塞时通知'),
  notifyMaxTokens: z.boolean().default(false).description('达到 token 上限时通知'),
  notifyApproval: z.boolean().default(true).description('等待批准时通知'),
  notifyQuestion: z.boolean().default(true).description('等待回答时通知'),
  notifyPlanReview: z.boolean().default(false).description('等待计划评审时通知'),
  rules: z.array(RULE_SCHEMA).default([]).description('关键字规则：命中标题、回复正文或工具名'),
  requireInteraction: z.boolean().default(false).description('通知常驻直到手动处理（保留字段，对齐上游设置面）'),
  backgroundOnly: z.boolean().default(true).description('仅当 WebUI 不在前台时通知'),
  sound: SOUND_MODE_SCHEMA,
  soundPath: z.string().default('').description('音效副本路径（设置页选择音效文件后由启动器自动保存，无需手填）'),
  soundName: z.string().default('').description('音效文件的原始文件名（设置卡片展示用）'),
})

/**
 * 注册本模块的 settings 作用域。
 * @param factory - 启动器注入的作用域工厂（背后是官方 `settings.register`）。
 * @param base - 覆盖出厂值的初始值（来自 patch / 启动器配置）。
 * @returns 作用域（get / update / watch）。
 */
export function createNotificationSettings(
  factory: SettingsScopeFactory,
  base: Partial<NotificationSettings> = {},
): SettingsScopeLike<NotificationSettings> {
  return factory<NotificationSettings>(SETTINGS_NAMESPACE, NOTIFICATION_SETTINGS_SCHEMA, {
    ...defaultNotificationSettings(),
    ...base,
  })
}
