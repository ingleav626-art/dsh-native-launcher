import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // 单元 spec 与源码同目录（拆分时随模块搬走，见 REFACTOR_PLAN 〇·五）；tests/ 放跨模块与集成
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
  },
})
