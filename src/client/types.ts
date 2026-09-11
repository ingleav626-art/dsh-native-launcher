/**
 * 官方 client ctx 的**窄面**：只声明本目录触摸到的成员。
 *
 * 官方 client 包不进依赖（`link:` 安装下 profile 树外解析不到官方包），所以这里手写最小类型面，
 * 由组装根（`src/client/index.ts`）把官方 ctx 适配后传入。
 */

/** RPC 应答信封（官方 `connection.rpc.call` 的返回；`ok` 为真时读 `value`）。 */
export interface RpcResult<T = unknown> { readonly ok?: boolean; readonly value?: T; readonly error?: { readonly message?: string } }

/** RPC 调用面：两段式（路径 + 端点），路径见 `RPC_PATH`。 */
export interface RpcFace { call(path: string, endpoint: string, payload?: unknown): Promise<RpcResult<unknown>> }

/** 槽位注册参数（官方 `slots.register` 的消费面）。 */
export interface SlotDescriptor {
  readonly name: string
  readonly id: string
  readonly order: number
  readonly label: string | (() => string)
  readonly inject: () => Record<string, unknown>
}

/** 槽位组件：props 由官方按描述符的 `inject` 提供，组件自己声明具体形状。 */
export type SlotComponent = (props: never) => unknown

/** 槽位账本（alpha.2+ 起有 `inject` 生成器；rc.2 无，退回直接注册）。 */
export interface SlotsFace {
  register(descriptor: SlotDescriptor, component: SlotComponent): void
  inject?(name: string, body: () => Generator<unknown, void, unknown>): void
}

/** 官方 client ctx 的消费面（`get` 用于取 sessions / uiSession 这类注入服务）。 */
export interface ClientContextLike {
  readonly connection?: { readonly rpc?: RpcFace }
  readonly slots?: SlotsFace
  get(name: string): unknown
}

/** RPC 端点前缀（host 侧 connection/兜底桥注册的路径，见 lib/index.js）。 */
export const RPC_PATH = '/native-launcher'
