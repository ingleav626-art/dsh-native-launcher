/**
 * 模块注册表：整合包的可插拔功能容器（架构见 dev-notes 一·七）。
 *
 * 容器协议 v2（P1 通知 v2 起）：模块 = **工厂 + 依赖注入**
 *   { id, apiVersion, defaultEnabled, description, create(ports) → { start() → dispose } }
 * 模块不接触 ctx 与 core —— 官方服务只在组装根（src/index.ts）与 io/ports.ts 被触摸；
 * 模块的端口形状定义见 src/modules/notification/host/ports.ts。
 *
 * 铁律：
 * 1. 本体红线——所有模块全关/全炸，启动器本体照常跑（gating 在 services/modules.ts 统一做隔离）
 * 2. wrap, never modify——vendored 项不改（通知模块 v2 起转为自维护，此条约束未来）
 * 3. apiVersion 护栏——模块声明的 apiVersion 与 CORE_API_VERSION 不一致即拒载
 *
 * （P2-B7b TS 化：自 lib/module-registry.js 迁入，产物路径不变 lib/module-registry.js；
 *   CORE_API_VERSION 自 src/modules/registry.ts 引入——两份常量合并为单一事实源。）
 */
import { createNotificationModule, manifest as notificationManifest } from '../../modules/notification/host/index.ts';
import type { ModuleManifest } from '../../modules/registry.ts';

export { CORE_API_VERSION } from '../../modules/registry.ts';

/** 容器侧的内置模块形状：静态清单 + 工厂（端口形状由各模块 ports.ts 定义，容器以 unknown 传递）。 */
export interface BuiltinModule extends ModuleManifest {
  create(ports: unknown): { start(): unknown }
}

export const BUILTIN_MODULES: BuiltinModule[] = [
  { ...notificationManifest, create: createNotificationModule },
];
