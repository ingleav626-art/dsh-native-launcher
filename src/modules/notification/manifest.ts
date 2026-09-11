/**
 * 通知模块自述（split-ready 单元的身份声明）。
 *
 * 拆出为独立插件时，本文件即该插件 `package.json` 的 `dsh` 段来源。
 */
import { CORE_API_VERSION, type ModuleManifest } from '../registry.ts'

export const manifest: ModuleManifest = {
  id: 'notification',
  apiVersion: CORE_API_VERSION,
  defaultEnabled: true,
  description: '任务完成 / 等待交互的通知决策，经启动器投递端弹托盘 Toast',
}
