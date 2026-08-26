// 模块注册表：整合包的可插拔功能容器（架构见 dev-notes.md 一·七）。
//
// v1 为显式注册（内置模块随包发版，可控可查）；external/dev 动态发现留待阶段 4，
// 届时只扩展 loadModules() 的实现，调用方（index.js applyInner）接口不变。
//
// 铁律：
// 1. 本体红线——所有模块全关/全炸，启动器本体照常跑（gating 在 index.js 统一做隔离）
// 2. vendored 模块 wrap, never modify——适配只写各模块的 adapter/vendor 结构
// 3. apiVersion 护栏——模块声明区间与 CORE_API_VERSION 不匹配则拒载

import * as notifications from './modules/notifications/host.js';

// 容器 API 版本：改 core 对象形状/语义时 +1；模块用 apiVersion 声明兼容区间
export const CORE_API_VERSION = 1;

export const BUILTIN_MODULES = [notifications];
