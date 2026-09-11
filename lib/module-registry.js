// 模块注册表：整合包的可插拔功能容器（架构见 dev-notes.md 一·七）。
//
// 容器协议 v2（P1 通知 v2 起）：模块 = **工厂 + 依赖注入**
//   { id, apiVersion, defaultEnabled, description, create(ports) → { start() → dispose } }
// 模块不接触 ctx 与 core —— 官方服务只在 lib/host-ports.js（组装根）被触摸；
// 模块的端口形状定义见 src/modules/notification/host/ports.ts。
//
// 铁律：
// 1. 本体红线——所有模块全关/全炸，启动器本体照常跑（gating 在 index.js 统一做隔离）
// 2. wrap, never modify——vendored 项不改（通知模块 v2 起转为自维护，此条约束未来）
// 3. apiVersion 护栏——模块声明的 apiVersion 与 CORE_API_VERSION 不一致即拒载

import { createNotificationModule, manifest as notificationManifest } from './modules/notification/index.js';

// 容器 API 版本：改端口形状/语义时 +1；模块用 manifest.apiVersion 声明兼容版本。
// ⚠️ 与 src/modules/registry.ts 的 CORE_API_VERSION 各有一份，P2 本体 TS 化时合并。
export const CORE_API_VERSION = 2;

export const BUILTIN_MODULES = [
  { ...notificationManifest, create: createNotificationModule },
];
