/**
 * 模块注册表：模块容器的内核版本护栏。
 *
 * 铁律 3（AGENTS.md）：模块声明的 apiVersion 与容器不匹配则拒载——
 * 绝不让一个旧模块把本体炸掉。
 */

/** 容器当前内核 API 版本；不兼容变更时递增，旧模块随之被拒载。 */
export const CORE_API_VERSION = 1

/** 模块自述：`apply` 之前的静态清单项（无副作用，可被容器先行校验）。 */
export interface ModuleManifest {
  /** 模块 id（日志前缀与设置 namespace 用）。 */
  readonly id: string
  /** 编译期声明的内核 API 版本，必须等于 `CORE_API_VERSION`。 */
  readonly apiVersion: number
  /** 缺省是否启用；用户可在设置里覆盖。 */
  readonly defaultEnabled: boolean
  /** 一句话职责（诊断日志用）。 */
  readonly description: string
}

/** 版本护栏判定：清单的 apiVersion 是否接受本容器。 */
export function acceptsManifest(manifest: ModuleManifest, coreVersion: number = CORE_API_VERSION): boolean {
  return manifest.apiVersion === coreVersion
}
