/**
 * 构建脚本：src/ TypeScript → lib/ 产物（产物入库提交——pnpm link: 安装阻断
 * 生命周期脚本，不能指望安装时自动 build，见 AGENTS.md 技术栈约定）。
 *
 * - host 产物：ESM（Node），external @deepseek-ai/*（profile node_modules 提供）
 * - client 产物：单文件 CJS + ModuleLoader 工厂握手（dsh client loader 线格式）
 *
 * Phase 进度：P0 空骨架（防覆盖手写 lib/）→ P1 通知模块 host 半区 →
 * **P3-0（2026-09-11）启动器 client 整体接管**（设置卡片 TS 化 + 构建产物化）→
 * P2 启动器 host 整体接管。
 */
import { build } from 'esbuild'

// 官方包一律 external：由 profile 的 node_modules 提供（schemastery 是唯一被模块直接 import 的官方运行时依赖）
const dshExternal = ['@deepseek-ai/*']

// react 由官方 app 在 client loader 里注入（factory 的 require 参数），绝不能打进产物
const clientExternal = [...dshExternal, 'react', 'react/jsx-runtime', 'react-dom']

/**
 * client 产物线格式：dsh client loader 的工厂注册模型。
 *
 * 三条不能改的事实（AGENTS.md Gotchas + P1-e-2 实证）：
 * - `id` 必须与插件 id 一致（`dsh-native-launcher`），loader 按它挂进 client graph
 * - factory 必须收下 `require` 并用它拿 react（官方 app 提供）
 * - 外层 `__ModuleLoader__` 守卫保留：产物被非浏览器环境加载时不得抛错
 */
const CLIENT_WRAP = {
  banner: {
    js: [
      "if (typeof window !== 'undefined' && typeof window.__ModuleLoader__ !== 'undefined') {",
      'window.__ModuleLoader__.load({',
      "  id: 'dsh-native-launcher',",
      '  factory: (require) => {',
      '    var module = { exports: {} };',
      '    var exports = module.exports;',
      '',
    ].join('\n'),
  },
  footer: {
    js: [
      '',
      '    return module.exports;',
      '  },',
      '});',
      '}',
      '',
    ].join('\n'),
  },
}

// [入口, 产物, 格式, 平台, 额外选项]
const ENTRIES = [
  // P1：通知模块 host 半区（启动器本体 host 仍为手写，P2 接管）
  ['src/modules/notification/host/index.ts', 'lib/modules/notification/index.js', 'esm', 'node', { sourcemap: false }],
  // P3-0：启动器 client（含内置模块 client 半区）→ 单文件 bundle
  [
    'src/client/index.ts',
    'lib/client.js',
    'cjs',
    'browser',
    { sourcemap: false, external: clientExternal, ...CLIENT_WRAP },
  ],
  // P2-B1 起：启动器 host 拆分批次——中间产物 lib/host/*.js，手写 lib/index.js 渐进改 import；
  // 全部批次完成后 index.js 本体转为构建产物（P4 切换）
  ['src/host/core/version.ts', 'lib/host/version.js', 'esm', 'node', { sourcemap: false }],
  ['src/host/core/paths.ts', 'lib/host/paths.js', 'esm', 'node', { sourcemap: false }],
  ['src/host/io/logger.ts', 'lib/host/logger.js', 'esm', 'node', { sourcemap: false }],
  ['src/host/io/diagnostics.ts', 'lib/host/diagnostics.js', 'esm', 'node', { sourcemap: false }],
  ['src/host/io/settings.ts', 'lib/host/settings.js', 'esm', 'node', { sourcemap: false }],
  ['src/host/io/scripts.ts', 'lib/host/scripts.js', 'esm', 'node', { sourcemap: false }],
  ['src/host/io/icon.ts', 'lib/host/icon.js', 'esm', 'node', { sourcemap: false }],
  ['src/host/io/shortcut.ts', 'lib/host/shortcut.js', 'esm', 'node', { sourcemap: false }],
  ['src/host/io/pwa.ts', 'lib/host/pwa.js', 'esm', 'node', { sourcemap: false }],
  ['src/host/io/tray.ts', 'lib/host/tray.js', 'esm', 'node', { sourcemap: false }],
  ['src/host/services/closeToExit.ts', 'lib/host/services/closeToExit.js', 'esm', 'node', { sourcemap: false }],
  ['src/host/services/autoOpen.ts', 'lib/host/services/autoOpen.js', 'esm', 'node', { sourcemap: false }],
]

let built = 0
for (const [entry, outfile, format, platform, extra = {}] of ENTRIES) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format,
    platform,
    target: platform === 'node' ? ['node22'] : ['es2022'],
    sourcemap: false,
    // 产物入库提交、人要读 diff：保留 UTF-8 中文原文（esbuild 默认 charset=ascii 会把中文转成 \uXXXX，
    // 功能等价但产物不可读、体积也更大）
    charset: 'utf8',
    external: dshExternal,
    logLevel: 'info',
    ...extra,
  })
  built += 1
}
if (built === 0) {
  console.log('[build] ENTRIES 为空（P0：lib/ 由手写代码承担），跳过构建。')
}
