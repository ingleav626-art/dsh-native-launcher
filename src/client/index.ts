/**
 * 启动器 client 的组装根（L4）：官方 client ctx 只在这里与本目录的适配层被触摸。
 *
 * 顺序即原实现（`lib/client.js` 的 `apply`）的执行顺序，只把"pending 传感器"挪进了
 * 通知模块的 client 半区（决策权在 host，传感器本就属于模块）：
 *   日志回传接通 → 在线心跳 → 启动器设置卡片 → 内置模块 client 半区 → 图标/manifest 注入 → 安装引导。
 *
 * 每步各自带失败隔离：任何一步炸掉都不得让设置页或页面本身不可用（铁律 1）。
 */
import { startBeacon } from './beacon.ts'
import { injectIcon } from './icon.ts'
import { startInstallPrompt } from './install-prompt.ts'
import { clientInfo, clientWarn, configureClientLog, type ClientLogSender } from './log.ts'
import { applyClientModules } from './modules.ts'
import { createPresenceSender, startPresenceReporter } from './presence.ts'
import { LauncherSection } from './section.ts'
import { registerSettingsSection } from './slots.ts'
import { RPC_PATH, type ClientContextLike, type RpcFace } from './types.ts'

/** 官方 client runner 读取的服务依赖（与原实现逐字一致）。 */
export const inject = ['slots', 'connection', 'sessions', 'locale']

/** 启动器设置卡片的槽位参数（id / order / 导航文案与原实现逐字一致）。 */
const LAUNCHER_SECTION = { id: 'native-launcher', order: 30, label: 'WebUI 启动器' }

/** 经官方 RPC 面回传（正常路径）。 */
function rpcLogSender(rpc: RpcFace): ClientLogSender {
  return payload => {
    // 尽力而为：日志回传失败不上抛、不再记日志（否则自激）
    try {
      void rpc.call(RPC_PATH, 'ntf-log', payload).catch(() => {})
    } catch {
      // 同步抛错同样静默：UI 优先
    }
  }
}

/**
 * 兜底直连回传：host 的 webServer 兜底桥把同一批端点挂在同源 `/native-launcher/<endpoint>`
 * （0.1.5-rc.2 实测走的就是这条路）。仅在拿不到 RPC 面时使用——**client 日志没有第二条退路**
 * （用户定调：不写浏览器 console）。请求失败一律静默。
 */
function directLogSender(): ClientLogSender {
  return payload => {
    try {
      void fetch(`${window.location.origin}${RPC_PATH}/ntf-log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          method: 'ntf-log',
          payload,
        }),
      }).catch(() => {})
    } catch {
      // 静默：日志绝不能拖累页面
    }
  }
}

/**
 * 插件入口：官方 client runner 在槽位就绪后调用。
 * @param ctx - 官方 client ctx。
 */
export function apply(ctx: ClientContextLike): void {
  const rpc = ctx.connection?.rpc

  // 日志先接通：之后所有 client 侧打点都进 native-launcher.log 的 [ntf] 域
  configureClientLog(rpc === undefined ? directLogSender() : rpcLogSender(rpc))
  clientInfo(`[log] client 已启动（inject=${inject.join(',')}，rpc=${rpc === undefined ? 'unavailable->direct' : 'ok'}）`)

  startBeacon()

  // 存在态上报：`backgroundOnly`（"任务不在眼前才通知"）的两个判定输入只有浏览器知道
  // （是否前台 + 正在看哪个会话），host 侧据此决定要不要打扰（见 host/presence.ts）
  if (rpc !== undefined) {
    startPresenceReporter(ctx, createPresenceSender(rpc))
  }

  // rpc 是卡片的数据来源；拿不到就不注册卡片（注册了也只会显示读取失败，还多一次渲染地雷）
  if (rpc === undefined) {
    clientWarn('[settings] connection.rpc 不可用：启动器设置卡片未注册（日志走直连兜底通道）')
  } else {
    registerSettingsSection(ctx, { ...LAUNCHER_SECTION, inject: () => ({ rpc }) }, LauncherSection)
  }

  applyClientModules(ctx)

  injectIcon(ctx)
  startInstallPrompt()
}
