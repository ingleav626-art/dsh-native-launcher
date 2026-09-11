/**
 * 构建脚本：src/ TypeScript → lib/ 产物（产物入库提交——pnpm link: 安装阻断
 * 生命周期脚本，不能指望安装时自动 build，见 AGENTS.md 技术栈约定）。
 *
 * - host 产物：ESM（Node），external @deepseek-ai/*（profile node_modules 提供）
 * - client 产物：单文件 CJS + ModuleLoader 工厂握手（dsh client loader 线格式，
 *   banner/footer 与现 lib/client.js 骨架逐字一致，见 AGENTS.md Gotchas）
 *
 * Phase 进度：P0 时 ENTRIES 为空（lib/ 仍由手写代码承担，防止覆盖）；
 * P1 填入通知模块条目；P2 host 整体接管；P3 client 整体接管（届时需处理
 * 双 load 合并体——见 AGENTS.md Gotchas）。
 */
import { build } from 'esbuild'

const dshExternal = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-*']

// client 产物线格式：dsh client loader 的工厂握手（与上游 build.mjs 实证一致）
const CLIENT_WRAP = {
  banner: {
    js: "window.__ModuleLoader__.load({ id: 'native-launcher', factory: (require) => { var module = { exports: {} }; var exports = module.exports;",
  },
  footer: { js: 'return module.exports; } });' },
}

// [入口, 产物, 格式, 平台, 额外选项]
const ENTRIES = [
  // P1 起填入，例如：
  // ['src/host/notifications/index.ts', 'lib/modules/notifications/index.js', 'esm', 'node'],
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
    sourcemap: true,
    external: dshExternal,
    logLevel: 'info',
    ...extra,
  })
  built += 1
}
if (built === 0) {
  console.log('[build] ENTRIES 为空（P0：lib/ 由手写代码承担），跳过构建。')
}
