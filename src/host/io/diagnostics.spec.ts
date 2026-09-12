import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectDshVersion } from './diagnostics.ts'

// detectDshVersion 读 process.env.DSH_HOME——用例内改，afterEach 还原（不污染其他用例）
const savedEnv = process.env.DSH_HOME
afterEach(() => {
  if (savedEnv === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedEnv
})

describe('detectDshVersion', () => {
  it('读 profile 依赖树里 dsh 包的 version', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-detect-'))
    const pkgDir = join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.5-rc.2' }))
    process.env.DSH_HOME = home
    expect(detectDshVersion()).toBe('0.1.5-rc.2')
  })

  it('无 DSH_HOME 返回空串（版本未知，不阻塞启动）', () => {
    delete process.env.DSH_HOME
    expect(detectDshVersion()).toBe('')
  })

  it('DSH_HOME 下没有 dsh 包返回空串', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-detect-empty-'))
    process.env.DSH_HOME = home
    expect(detectDshVersion()).toBe('')
  })

  it('package.json 损坏（非法 JSON）时容忍并尝试下一个候选路径', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-detect-broken-'))
    const brokenDir = join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh')
    const goodDir = join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh')
    mkdirSync(brokenDir, { recursive: true })
    mkdirSync(goodDir, { recursive: true })
    writeFileSync(join(brokenDir, 'package.json'), '{ broken json')
    writeFileSync(join(goodDir, 'package.json'), JSON.stringify({ version: '0.1.1-rc.2' }))
    process.env.DSH_HOME = home
    expect(detectDshVersion()).toBe('0.1.1-rc.2')
  })
})
