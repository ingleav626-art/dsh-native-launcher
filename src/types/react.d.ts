/**
 * 官方 client 宿主提供的 react 的**最小类型垫片**。
 *
 * 为什么不引 `@types/react`（记账，2026-09-11 用户定调「零新增依赖，复杂度不暴涨就不引」）：
 * - 官方 app 在 client loader 里注入 `require('react')`（现网 LauncherSection 即此路径），
 *   react 本身**不是**我们的依赖；只有"类型"需要来源。
 * - 我们不用 JSX（保持 `createElement` 写法：与重构基线 `lib/client.js` 逐字可比，
 *   compare.cjs 的 JS→TS 对账才对得上），于是需要的类型面只有 createElement / useState / useEffect。
 * - 代价可控 ⇒ 手写垫片；**拆分独立插件时本文件随模块带走**（模块自包含的组成部分）。
 *
 * 注意：这是**环境声明**，不是模块——`import ... from 'react'` 解析到的是宿主注入的模块，
 * 与本仓库文件之间不存在 import 边（split-ready 的层级隔离不受影响）。
 */
declare module 'react' {
  /** React 元素（不透明：我们只创建与传递，不读内部结构）。 */
  export interface ReactElement {
    readonly type: unknown
  }

  /** 子节点：元素、文本、条件渲染的 null/false，以及它们的数组。 */
  export type ReactNode =
    | ReactElement
    | string
    | number
    | boolean
    | null
    | undefined
    | readonly ReactNode[]

  /**
   * `createElement` 的 props 袋：已知键给出精确类型（事件回调因此可被上下文推断，
   * 代码里无需给 `event` 加注解），其余键（`aria-*` / `viewBox` / `htmlFor` / `ref` 等）由索引签名放行。
   */
  export interface ElementProps {
    readonly key?: string | number
    readonly style?: Record<string, unknown>
    readonly className?: string
    readonly children?: ReactNode
    readonly type?: string
    readonly value?: string | number
    readonly checked?: boolean
    readonly defaultChecked?: boolean
    readonly disabled?: boolean
    readonly placeholder?: string
    readonly autoFocus?: boolean
    readonly min?: number
    readonly max?: number
    readonly title?: string
    readonly accept?: string
    readonly onChange?: (event: {
      // value 可写：file input 选完同一路径再选不会再触发 change，调用方需清空 `target.value`
      // （React 官方类型同样把 target 当 DOM 节点从宽处理）；files 仅 file input 消费。
      readonly target: { value: string; checked: boolean; readonly files?: FileList | null }
    }) => void
    readonly onClick?: (event: { readonly target: unknown }) => void
    readonly [extra: string]: unknown
  }

  /** 函数组件：props 形状由组件自己声明（`never` 参数让任意具体 props 类型都能赋给它）。 */
  export type Component = (props: never) => ReactElement | null

  /** 状态设置器。 */
  export type SetState<T> = (next: T | ((prev: T) => T)) => void

  /**
   * 组件重载：props 由**组件自己**的 props 类型决定——回调参数因此按组件语义推断
   * （若走下面的 DOM props 袋，`onChange` 会被推断成事件对象，语义就错了）。
   * `key` 由 React 内部消费，不属于组件 props，故用交叉类型放行。
   */
  export function createElement<P>(
    type: (props: P) => ReactElement | null,
    props?: (P & { readonly key?: string | number }) | null,
    ...children: ReactNode[]
  ): ReactElement

  /** 宿主元素重载：props 袋见 `ElementProps`（已知键精确、其余经索引签名放行）。 */
  export function createElement(
    type: string,
    props?: ElementProps | null,
    ...children: ReactNode[]
  ): ReactElement

  export function useState<T>(initial: T | (() => T)): [T, SetState<T>]

  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void

  /**
   * 可变引用（只消费「隐藏 file input 的 ref 触发 click」这一个用法；
   * 官方类型里的 RefObject 家族在垫片口径下统一成 `{ current }`）。
   */
  export function useRef<T>(initial: T): { current: T }
}
