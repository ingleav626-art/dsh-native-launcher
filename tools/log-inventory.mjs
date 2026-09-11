#!/usr/bin/env node
/**
 * 日志点对账工具：把一份代码里**所有打点**抽成稳定清单，供迁移前后逐条比对。
 *
 * 为什么需要它（2026-09-11 用户质询）：`compare.cjs` 只比函数体，**看不出一行日志被删**——
 * 迁移 client 时我就这么悄悄吃掉了 client→host 的日志回传（host 端点还在、静默空转），
 * 事后只能靠人回忆，用户也"不知道删了多少"。本工具把"日志点"变成可对账的资产。
 *
 * 识别面：
 * - host：`logMsg / logWarn / logFail` 与模块的 `logger.info / warn / fail`
 * - client：`clientInfo / clientWarn / clientLog`（现役）与 `ntfLog`（迁移前旧式）
 * 归一化：模板里的 `${...}` 一律折成 `${}`；行内多余空白折平 —— 位置可变、语义可比。
 *
 * 用法：
 *   node tools/log-inventory.mjs lib/index.js lib/client.js          # 打印清单
 *   node tools/log-inventory.mjs --base <旧文件> --target <新文件…>   # 对账（缺失 = 可能被删）
 * 退出码：对账模式下有"缺失"即 1（可接进 CI / 迁移闸）。
 */
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 打点调用形态 → 通道名。 */
const CHANNELS = [
  { re: /\blogMsg\s*\(/g, channel: 'host:info' },
  { re: /\blogWarn\s*\(/g, channel: 'host:warn' },
  { re: /\blogFail\s*\(/g, channel: 'host:fail' },
  { re: /\blogger\.info\s*\(/g, channel: 'module:info' },
  { re: /\blogger\.warn\s*\(/g, channel: 'module:warn' },
  { re: /\blogger\.fail\s*\(/g, channel: 'module:fail' },
  { re: /\bclientInfo\s*\(/g, channel: 'client:info' },
  { re: /\bclientWarn\s*\(/g, channel: 'client:warn' },
  { re: /\bclientLog\s*\(/g, channel: 'client:log' },
  { re: /\bntfLog\s*\(/g, channel: 'client:legacy' },
]

/** 归一化一条打点文本：模板变量折叠、空白折平、去掉首尾引号。 */
function normalize(raw) {
  return raw
    .replace(/\$\{[^}]*\}/g, '${}')
    .replace(/\s+/g, ' ')
    .replace(/^['"`]|['"`]$/g, '')
    .trim()
}

/** 从调用起点抽出第一个字符串实参（含模板串）；不是字面量则返回调用形状摘要。 */
function readFirstArg(source, openParen) {
  let i = openParen + 1
  while (i < source.length && /\s/.test(source[i])) i++
  const quote = source[i]
  if (quote !== "'" && quote !== '"' && quote !== '`') {
    // 非字面量（变量/拼接）：只记调用形状，保证清单稳定
    return `<expr>${normalize(source.slice(i, i + 40))}`
  }
  let out = ''
  i++
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') { out += source[i + 1]; i += 2; continue }
    if (ch === quote) break
    out += ch
    i++
  }
  return out
}

/** 抽取一个文件里的全部打点。 */
function inventory(file) {
  const source = readFileSync(file, 'utf8')
  const found = []
  for (const { re, channel } of CHANNELS) {
    re.lastIndex = 0
    let match
    while ((match = re.exec(source)) !== null) {
      const openParen = match.index + match[0].length - 1
      const text = normalize(readFirstArg(source, openParen))
      if (text === '') continue
      const line = source.slice(0, match.index).split('\n').length
      found.push({ channel, text, line })
    }
  }
  return found.sort((a, b) => (a.channel + a.text).localeCompare(b.channel + b.text))
}

/** 目录 → 其中的 .js/.mjs/.ts 文件（不递归 node_modules）。 */
function expand(paths) {
  const files = []
  for (const path of paths) {
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (/\.(js|mjs|cjs|ts|tsx)$/.test(entry)) files.push(join(path, entry))
      }
    } else {
      files.push(path)
    }
  }
  return files
}

const argv = process.argv.slice(2)
const baseIndex = argv.indexOf('--base')
const targetIndex = argv.indexOf('--target')

if (baseIndex === -1) {
  if (argv.length === 0) {
    console.log('用法: node tools/log-inventory.mjs <文件|目录…>')
    console.log('     node tools/log-inventory.mjs --base <旧文件> --target <新文件|目录…>')
    process.exit(2)
  }
  const items = expand(argv)
  let total = 0
  for (const file of items) {
    const found = inventory(file)
    total += found.length
    console.log(`\n${file}（${found.length} 处）`)
    for (const item of found) console.log(`  ${item.channel.padEnd(14)} ${item.text}`)
  }
  console.log(`\n合计 ${items.length} 个文件 / ${total} 处打点`)
  process.exit(0)
}

const baseFiles = expand([argv[baseIndex + 1]])
const targetFiles = expand(argv.slice(targetIndex + 1).filter(a => a !== '--target'))
const baseItems = baseFiles.flatMap(file => inventory(file).map(item => ({ ...item, file })))
const targetItems = targetFiles.flatMap(file => inventory(file))
const targetKeys = new Set(targetItems.map(item => item.channel + '|' + item.text))

const missing = baseItems.filter(item => !targetKeys.has(item.channel + '|' + item.text))
const extraCount = targetItems.length - (baseItems.length - missing.length)

console.log('═══════════ 日志点对账 ═══════════')
console.log(`基线：${baseFiles.join(', ')}（${baseItems.length} 处）`)
console.log(`目标：${targetFiles.join(', ')}（${targetItems.length} 处）`)
console.log(`保留 ${baseItems.length - missing.length} 处 ｜ 缺失 ${missing.length} 处 ｜ 目标侧新增 ${extraCount} 处`)

if (missing.length > 0) {
  console.log('\n── 基线的这些打点在目标里找不到（逐条 triage：迁移到别处 / 通道下线 / 真被删了）──')
  for (const item of missing) console.log(`  ${item.channel.padEnd(14)} ${item.text}`)
  console.log('\n提示：迁移不得删除既有日志点；确需删除要逐条记账并经用户确认（AGENTS.md 代码规范）。')
  process.exit(1)
}
console.log('\n✓ 基线打点全部保留')
