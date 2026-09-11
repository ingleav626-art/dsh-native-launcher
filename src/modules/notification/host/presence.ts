/**
 * UI 存在态（presence）：判断"这条通知该不该弹"所需要的、**只有浏览器才知道**的两个输入。
 *
 * 为什么需要它（2026-09-11 用户质询后补回，P3-0 漏项）：设置里的 `backgroundOnly`
 * （"仅在任务不在眼前时通知"）在上游是 client 侧的判定——
 * `shouldShow(permission, backgroundOnly, documentHidden, completedSessionId, currentSessionId)`：
 * 页面在前台**且**正在看这个会话时抑制。决策收归 host 后，host 拿不到"是否前台/正在看哪个会话"，
 * 于是这个开关一度形同虚设（真机上"人在页面前也弹"）。现在由启动器的薄传感器上报，
 * 本模块只做判定。
 *
 * 失效语义（关键）：浏览器不会告诉我们"页面关了"，只会停止上报。故设 TTL——
 * 超过 `PRESENCE_TTL_MS` 没收到上报即视为"页面不在眼前"→ **照常通知**（宁可多弹，不可静默漏掉）。
 */
import type { NotificationSettings } from '../shared/types.ts'

/** 上报的存在态（跨进程输入，字段一律当作不可信）。 */
export interface PresenceState {
  /** 页面是否在前台（`!hidden && hasFocus`）。 */
  readonly visible: boolean
  /** 正在查看的会话 id；未知时缺省。 */
  readonly activeSessionId?: string
}

/** 存在态有效期：超过即认为页面已关闭/失联（浏览器不会发送"关闭"事件给我们）。 */
export const PRESENCE_TTL_MS = 15_000

/** 存在态追踪器。 */
export interface PresenceTracker {
  /** 处理一次上报；形状非法返回 false（不上抛）。 */
  report(raw: unknown): boolean
  /**
   * 该会话的完成通知是否应因"任务就在眼前"而抑制。
   * @param sessionId - 结束的会话。
   * @param settings - 当前设置（读 `backgroundOnly`）。
   * @param now - 当前时间（测试注入用）。
   */
  suppresses(sessionId: string, settings: NotificationSettings, now?: number): boolean
}

/** 形状守卫：`visible` 必须是布尔；`activeSessionId` 可选但必须是字符串。 */
export function isPresenceReport(value: unknown): value is PresenceState {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.visible !== 'boolean') return false
  return record.activeSessionId === undefined || typeof record.activeSessionId === 'string'
}

/**
 * 创建存在态追踪器。
 * @param now - 时钟（测试可注入；默认 Date.now）。
 */
export function createPresenceTracker(now: () => number = Date.now): PresenceTracker {
  let last: { state: PresenceState; at: number } | undefined

  return {
    report(raw) {
      if (!isPresenceReport(raw)) return false
      // 只存字段（不持有调用方对象引用），并夹住长度避免异常大值
      last = {
        state: {
          visible: raw.visible,
          ...(raw.activeSessionId === undefined ? {} : { activeSessionId: raw.activeSessionId.slice(0, 200) }),
        },
        at: now(),
      }
      return true
    },

    suppresses(sessionId, settings, at = now()) {
      if (settings.backgroundOnly !== true) return false
      if (last === undefined) return false                       // 从未上报 → 按"不在眼前"处理
      if (at - last.at > PRESENCE_TTL_MS) return false           // 上报过期 → 页面已关/失联
      if (!last.state.visible) return false                      // 页面在后台 → 该弹
      return last.state.activeSessionId === sessionId            // 前台且正在看这个会话 → 抑制
    },
  }
}
