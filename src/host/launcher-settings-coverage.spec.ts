/**
 * launcher 设置三方一致性守卫（2026-09-12 真机实锤补闸）。
 *
 * 抓的 bug：autoStartBoot 加了 schema、config.get 白名单漏了（应答不返回 → 前端读不到）、
 * section.ts 渲染行 Edit 报成功未落盘（用户界面看不见）——三方各缺一处，没有任何既有闸报错。
 * 对齐通知卡片的先例（card.spec.ts「schema 每个布尔字段都有开关」），launcher 侧补齐：
 *   schema 字段 ↔ config.get 应答 ↔ 前端控件，三方交叉断言。
 * 读产物 lib/client.js（前端真身）而非源码——「源码在、产物没有」的漂移就是这么漏的。
 * 字段清单从 settings.ts 的 schema 块文本提取（@deepseek-ai/schemastery 无 shape 元数据）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const settingsSrc = readFileSync(new URL('./io/settings.ts', import.meta.url), 'utf8')
const schemaBlock = settingsSrc.slice(
  settingsSrc.indexOf('LAUNCHER_SETTINGS_SCHEMA = z.object'),
  settingsSrc.indexOf('});', settingsSrc.indexOf('LAUNCHER_SETTINGS_SCHEMA = z.object')),
)
// 顶层字段 = schema 块内两空格缩进的 `字段名: z.` 行（嵌套对象的更深缩进不计）
const fields = [...schemaBlock.matchAll(/^  ([A-Za-z]+): z\./gm)].map((m) => m[1])
// 用例自身前提：提取法必须真的拿到字段（坏掉就假通过）
expect(fields.length).toBeGreaterThanOrEqual(12)
expect(fields).toContain('autoStartBoot')

const rpcSrc = readFileSync(new URL('./services/launcherRpc.ts', import.meta.url), 'utf8')
const configGetBlock = rpcSrc.slice(
  rpcSrc.indexOf("case 'config.get'"),
  rpcSrc.indexOf("case 'config.set'"),
)
const clientJs = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')

/** 有意不在前端暴露的字段（实施细节：通知模块开关由通知卡片代管总语义）。 */
const NO_UI = new Set(['modules'])

describe('launcher 设置三方一致性（schema ↔ config.get ↔ 前端控件）', () => {
  it('schema 的每个字段都被 config.get 应答（漏了 = 前端永远读到 undefined）', () => {
    for (const f of fields) {
      expect(configGetBlock, `config.get 应答缺字段 ${f}`).toContain(f)
    }
  })

  it('除豁免外每个字段都在前端产物 lib/client.js 有控件（漏了 = 用户看不见的开关等于不存在）', () => {
    for (const f of fields) {
      if (NO_UI.has(f)) continue
      expect(clientJs, `lib/client.js 缺字段 ${f} 的控件（schema 有 UI 无，或源码改动未落盘/未构建）`).toContain(f)
    }
  })

  it('前端引用的开关字段都真实存在于 schema（防反向漂移：UI 引用幽灵字段）', () => {
    const toggles = [...clientJs.matchAll(/toggleEl\(["']([A-Za-z]+)["']\)/g)].map((m) => m[1])
    expect(toggles.length).toBeGreaterThan(0)
    for (const t of toggles) {
      expect(fields, `前端 toggleEl('${t}') 引用了 schema 不存在的字段`).toContain(t)
    }
  })
})
