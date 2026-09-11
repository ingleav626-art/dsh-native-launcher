import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // 官方 app 在浏览器里注入 react（src/types/react.d.ts 仅有类型）；Node 侧测试落到替身，
    // 避免为测试引入真 react 依赖（零新增依赖红线）。替身被调用即报错——见 tests/stubs/react.ts。
    alias: {
      react: fileURLToPath(new URL('./tests/stubs/react.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // 单元 spec 与源码同目录（拆分时随模块搬走，见 REFACTOR_PLAN 〇·五）；tests/ 放跨模块与集成
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
  },
})
