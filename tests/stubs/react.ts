/**
 * 测试用的 react 替身。
 *
 * 为什么需要：官方 app 在浏览器里注入 `require('react')`（`src/types/react.d.ts` 只提供类型），
 * 而 Node 侧的 vitest 解析不到这个模块。凡是要 import 卡片/组件文件的测试都经 vitest alias
 * 落到本文件——**不为测试引入真 react 依赖**（项目零新增依赖红线）。
 *
 * 只提供组件文件在**模块作用域**用到的名字；渲染行为一律不做（组件级渲染测试不进入本项目的
 * 测试策略：纯函数与装配链路才是抓 bug 的主力，见 AGENTS.md 测试原则）。
 */

/** 与真实 react 同名的占位实现：被调用即说明有测试试图渲染组件（本策略下不应发生）。 */
export function createElement(): never {
  throw new Error('测试替身 react 不支持渲染：请改测纯函数或装配链路')
}

/** 同上。 */
export function useState(): never {
  throw new Error('测试替身 react 不支持 hooks：请改测纯函数或装配链路')
}

/** 同上。 */
export function useEffect(): never {
  throw new Error('测试替身 react 不支持 hooks：请改测纯函数或装配链路')
}
