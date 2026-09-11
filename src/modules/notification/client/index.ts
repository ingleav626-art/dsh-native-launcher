/**
 * 通知模块的 **client 半区**入口（split-ready：拆包后本文件就是该插件自己的 client.js 入口）。
 *
 * 自包含边界：不 import 启动器内部实现，只消费 `ports.ts` 的注入窄面；官方 client 服务
 * （rpc / slots / sessions / uiSession）的形状由启动器组装根翻译后传入。
 * 拆出独立包时，只需在包内自己接 `ctx` 构造同样的 `NotificationClientFace`。
 */
import { manifest } from '../manifest.ts'
import { NotificationCard } from './card.ts'
import { createPendingReporter } from './pendingReporter.ts'
import type { NotificationClientFace } from './ports.ts'
import { adoptStyles } from './styles.ts'

/** 模块 client 半区实例。 */
export interface NotificationClient {
  readonly id: string
  readonly apiVersion: number
  /** 装配设置卡片与 pending 传感器；返回卸载函数。 */
  start(): () => void
}

/** 卡片在官方 `settings.section` 槽位里的 id（启动器卡片为 native-launcher，不能撞）。 */
const SECTION_ID = 'native-notification'

/** 排序位：启动器卡片为 30，本卡片紧随其后。 */
const SECTION_ORDER = 31

/** 设置页导航文案。 */
const SECTION_LABEL = '任务通知'

/**
 * 创建模块 client 半区。
 * @param face - 注入窄面（启动器组装根提供）。
 */
export function createNotificationClient(face: NotificationClientFace): NotificationClient {
  return {
    id: manifest.id,
    apiVersion: manifest.apiVersion,

    start() {
      adoptStyles()

      // 卡片经注入的槽位端口注册：模块不知道官方 slot API 长什么样（那是组装根的事）
      face.section.register({
        id: SECTION_ID,
        order: SECTION_ORDER,
        label: SECTION_LABEL,
        component: NotificationCard,
        inject: () => ({ face }),
      })

      const stopReporter = createPendingReporter({
        feed: face.pendingFeed,
        report: face.pendingReport,
        logger: face.logger,
      }).start()

      face.logger.info('[notification] client 半区已装配：设置卡片 + pending 传感器')
      return () => { stopReporter() }
    },
  }
}

// 模块自述再导出：client 侧容器（src/client/modules.ts）在装配前读 id / apiVersion 做护栏
export { manifest } from '../manifest.ts'
