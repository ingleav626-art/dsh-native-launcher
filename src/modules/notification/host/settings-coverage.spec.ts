/**
 * 设置项覆盖守卫：**每个设置字段都必须在决策链里被真正读取**。
 *
 * 抓的 bug（2026-09-11 用户实测）：`backgroundOnly`（"任务不在眼前才通知"）一度只存在于
 * schema 与类型里，**没有任何决策消费它**——开关是摆设，UI 承诺与实际行为不符。
 * 这类缺陷函数级对账与单测都抓不到：对账能报 `missing`，但要靠人正确 triage
 * （当时的判定是"浏览器语义，砍掉"——而它有一半是通道无关的产品行为）。
 *
 * 判据：设置字段名必须出现在决策链文件中（`settings.ts` 只是 schema 声明，读它等于自证）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defaultNotificationSettings } from './settings.ts'

/** 决策链文件（改动决策位置时必须同步这里）。 */
const DECISION_FILES = ['filter.ts', 'planner.ts', 'watch.ts', 'pending.ts', 'presence.ts', 'notifier.ts'] as const

/**
 * 已知的"只做设置面对齐、刻意不消费"字段：必须逐条写明理由，否则视为摆设。
 * 每条都必须是**用户已知情**的裁决结果，且卡片 UI 要与之一致（不能给用户一个点了没反应的开关）。
 */
const PLACEBO_ALLOWLIST: readonly string[] = [
  // `requireInteraction` 曾在此豁免（守卫抓到它没被任何决策消费），
  // 2026-09-11 用户拍板实现：`notifier.ts` 读取它并转成托盘的 `persistent`（scenario="reminder"），
  // 故豁免撤销——豁免必须是"用户已知情的裁决"，不是"懒得实现"。
  //
  // `soundName`（2026-09-25 音效功能引入时豁免）：**纯展示字段**——设置卡片读它显示
  // "当前音效文件名"（src/modules/notification/client/card.ts），不参与任何通知决策；
  // 决策侧消费的是它的伴生字段 `soundPath`（notifier.resolveTraySound → 托盘音效指令）。
  'soundName',
]

describe('设置项覆盖（防"开关是摆设"）', () => {
  it('每个设置字段都在决策链里被消费', () => {
    const sources = DECISION_FILES
      .map(name => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))
      .join('\n')
    const fields = Object.keys(defaultNotificationSettings()).filter(field => !PLACEBO_ALLOWLIST.includes(field))
    const unconsumed = fields.filter(field => !sources.includes(field))
    expect(
      unconsumed,
      `这些设置项没有任何决策消费它们（卡片上是摆设）：${unconsumed.join(', ')}`,
    ).toEqual([])
  })

  it('守卫本身有效：字段名必须来自真实 schema（不是空跑）', () => {
    const fields = Object.keys(defaultNotificationSettings())
    expect(fields.length).toBeGreaterThan(8)
    expect(fields).toContain('backgroundOnly')
  })
})
