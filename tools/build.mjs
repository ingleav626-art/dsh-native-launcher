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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

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
//
// P2-B7b 组装根产物化：src/index.ts / src/host/core/moduleRegistry.ts 以源相对 .ts 引用兄弟// 模块，构建时经 rewriteExternal 插件改写为产物视角的相对路径并标记 external——
// lib/host/* 保持独立产物（不回退成单文件 bundle）；tsc 侧 NodeNext 直接解析 .ts 做类型检查。
// strict 模式下未映射的入口相对引用直接报错（防悄悄 bundle 回单文件）。
const rewriteExternal = (importMap, { strict = false } = {}) => ({
  name: 'rewrite-external',
  setup(build) {
    build.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (args.kind === 'entry-point') return undefined
      const mapped = importMap[args.path]
      if (mapped) return { path: mapped, external: true }
      if (strict) throw new Error(`[build] 入口出现未映射的相对引用: ${args.path}（请加入映射表）`)
      return undefined
    })
  },
})

// 组装根的产物路径映射（键 = src/index.ts 视角的源引用，值 = lib/index.js 视角的产物引用）。
const INDEX_IMPORT_MAP = {
  './host/core/moduleRegistry.ts': './module-registry.js',
  './host/io/ports.ts': './host-ports.js',
  './host/io/logger.ts': './host/logger.js',
  './host/core/paths.ts': './host/paths.js',
  './host/core/version.ts': './host/version.js',
  './host/io/diagnostics.ts': './host/diagnostics.js',
  './host/io/settings.ts': './host/settings.js',
  './host/io/scripts.ts': './host/scripts.js',
  './host/io/icon.ts': './host/icon.js',
  './host/io/shortcut.ts': './host/shortcut.js',
  './host/io/pwa.ts': './host/pwa.js',
  './host/io/tray.ts': './host/tray.js',
  './host/io/rpcBridge.ts': './host/rpcBridge.js',
  './host/services/closeToExit.ts': './host/services/closeToExit.js',
  './host/services/autoOpen.ts': './host/services/autoOpen.js',
  './host/services/launcherRpc.ts': './host/services/launcherRpc.js',
  './host/services/modules.ts': './host/services/modules.js',
}

// 组装壳头部说明（esbuild 会剥离普通注释，产物经 banner 保留这段"装进 profile 后"管线文档）
const INDEX_BANNER = [
  '// dsh-native-launcher（构建产物——源码 src/index.ts，改这里没用）',
  '//',
  '// 装进 profile 后：',
  '//   1. 在桌面生成一个快捷方式（默认名 "DSH WebUI"），幂等：已存在则跳过',
  '//   2. 双击快捷方式 → wscript 静默运行 launcher.vbs（隐藏窗口，无 cmd 黑窗）',
  '//   3. launcher.vbs 以 DSH_LAUNCHER=1 环境变量启动 dsh web',
  '//   4. 插件检测到 DSH_LAUNCHER=1 → 等 webServer 就绪 → 自动打开默认浏览器',
  '//   5. 设置页注册 "WebUI 启动器" 增强设置 section（读取配置 / 重新生成快捷方式）',
  '//',
  '// 平时从终端手动启动 dsh web（无 DSH_LAUNCHER）不会触发自动开浏览器。',
  '// 零依赖：只用 node builtins + Windows 自带工具（wscript / powershell / cmd）。',
].join('\n')

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
  ['src/host/io/rpcBridge.ts', 'lib/host/rpcBridge.js', 'esm', 'node', { sourcemap: false }],
  ['src/host/services/launcherRpc.ts', 'lib/host/services/launcherRpc.js', 'esm', 'node', { sourcemap: false }],
  ['src/host/services/modules.ts', 'lib/host/services/modules.js', 'esm', 'node', { sourcemap: false }],
  // P2-B7b：模块注册表 + 端口适配 TS 化（产物路径不变，forged-official E2E 直接引这两个路径）；
  // 注册表外链通知模块产物（不重复打包），registry.ts（CORE_API_VERSION 单一事实源）打入
  [
    'src/host/core/moduleRegistry.ts',
    'lib/module-registry.js',
    'esm',
    'node',
    { sourcemap: false, plugins: [rewriteExternal({ '../../modules/notification/host/index.ts': './modules/notification/index.js' })] },
  ],
  ['src/host/io/ports.ts', 'lib/host-ports.js', 'esm', 'node', { sourcemap: false }],
  // P2-B7b：组装根产物化——lib/index.js 由 src/index.ts 生成（手写版退役）
  ['src/index.ts', 'lib/index.js', 'esm', 'node', { sourcemap: false, banner: { js: INDEX_BANNER }, define: { PLUGIN_VERSION: JSON.stringify(pkg.version) }, plugins: [rewriteExternal(INDEX_IMPORT_MAP, { strict: true })] }],
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
