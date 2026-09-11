/**
 * client 侧的内置模块容器（与 host 侧 `lib/module-registry.js` 的 `BUILTIN_MODULES` 对称）。
 *
 * 承担两件铁律的 client 版：
 * - 铁律 3 apiVersion 护栏：清单与容器 `CORE_API_VERSION` 不匹配即拒载；
 * - 铁律 1 本体红线：单个模块的 client 半区装配失败只记日志并禁用该模块，
 *   启动器卡片与页面本身照常（try/catch 逐个隔离）。
 *
 * 模块开关（`modules.notifications`）是 host 侧配置，client 读不到也不该读：
 * 模块未启用时 host 的 RPC 会明确回 `ok=false`，卡片据此显示"未启用"，语义自洽。
 */
import { createNotificationClient, manifest as notificationManifest } from '../modules/notification/client/index.ts'
import { acceptsManifest, CORE_API_VERSION, type ModuleManifest } from '../modules/registry.ts'
import { clientInfo, clientWarn } from './log.ts'
import { createNotificationFace } from './module-faces.ts'
import type { ClientContextLike } from './types.ts'

/** 容器对模块 client 半区的最小要求。 */
export interface ClientModuleInstance {
  readonly id: string
  readonly apiVersion: number
  start(): () => void
}

/** 内置模块的 client 半区清单。 */
const BUILTIN_CLIENT_MODULES: ReadonlyArray<{
  readonly manifest: ModuleManifest
  readonly create: (ctx: ClientContextLike) => ClientModuleInstance
}> = [
  {
    manifest: notificationManifest,
    create: ctx => createNotificationClient(createNotificationFace(ctx)),
  },
]

/**
 * 装配全部内置模块的 client 半区。
 * @param ctx - 官方 client ctx（本文件只把它转交给模块的端口适配层）。
 */
export function applyClientModules(ctx: ClientContextLike): void {
  for (const mod of BUILTIN_CLIENT_MODULES) {
    if (!acceptsManifest(mod.manifest)) {
      clientWarn(
        `[modules] ${mod.manifest.id}: apiVersion ${mod.manifest.apiVersion} 与容器 v${CORE_API_VERSION} 不匹配，拒载`,
      )
      continue
    }
    try {
      mod.create(ctx).start()
      clientInfo(`[modules] ${mod.manifest.id}: client 半区已装配 (core=v${CORE_API_VERSION})`)
    } catch (error) {
      clientWarn(`[modules] ${mod.manifest.id}: client 半区装配失败，仅禁用该模块：${String(error)}`)
    }
  }
}
