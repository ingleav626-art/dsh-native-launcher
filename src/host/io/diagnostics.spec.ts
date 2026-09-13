import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectDshVersion, logEnvDiagnostics } from './diagnostics.ts'

// logEnvDiagnostics 走真实 powershell spawn——用例只 mock 外部边界 child_process（原则三/五），
// 捕获命令串后同步触发 close 回调，断言"打印的是传入 cfg 的值而非默认值"（issue #3 缺陷 2）
const spawnMock = vi.fn()
vi.mock('node:child_process', () => ({ spawn: (...a: unknown[]) => spawnMock(...(a as [])) }))

// detectDshVersion 读 process.env.DSH_HOME / USERPROFILE——用例内改，afterEach 还原（不污染其他用例）
const savedEnv = { DSH_HOME: process.env.DSH_HOME, USERPROFILE: process.env.USERPROFILE }
afterEach(() => {
  if (savedEnv.DSH_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedEnv.DSH_HOME
  process.env.USERPROFILE = savedEnv.USERPROFILE
  vi.clearAllMocks()
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

  it('无 DSH_HOME → 回退 ~/.dsh 探测（官方语义 $DSH_HOME || ~/.dsh；issue #3 缺陷 1）', () => {
    // 预期：未设 DSH_HOME 是常态，必须能从 ~/.dsh/profiles/... 读到版本——恒空会让 rc.8 告警永不触发
    const userHome = mkdtempSync(join(tmpdir(), 'dsh-user-'))
    const pkgDir = join(userHome, '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ version: '0.1.5-rc.2' }))
    delete process.env.DSH_HOME
    process.env.USERPROFILE = userHome
    expect(detectDshVersion()).toBe('0.1.5-rc.2')
  })

  it('回退 ~/.dsh 下也没有 dsh 包 → 返回空串（版本未知，不阻塞启动）', () => {
    const userHome = mkdtempSync(join(tmpdir(), 'dsh-user-empty-'))
    delete process.env.DSH_HOME
    process.env.USERPROFILE = userHome
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

describe('logEnvDiagnostics（issue #3 缺陷 2）', () => {
  it('打印传入 cfg 的 launchCommand/shortcutName，而不是 schema 默认值', () => {
    // 预期：diag 必须反映用户设置——否则日志与实际执行链路自相矛盾（"日志说 dsh，实际跑 pnpm"）
    spawnMock.mockReturnValue({ stdout: null, stderr: null, on: (ev: string, cb: () => void) => { if (ev === 'close') queueMicrotask(cb) } })
    const logs: string[] = []
    logEnvDiagnostics('C:\\fake', { launchCommand: 'pnpm dsh --profile web --no-open', shortcutName: 'MyDSH' } as Parameters<typeof logEnvDiagnostics>[1], (m) => logs.push(m))
    const cmd = String(spawnMock.mock.calls[0][1]?.[3] ?? '')
    expect(cmd).toContain('pnpm dsh --profile web --no-open')
    expect(cmd).toContain('MyDSH.lnk')
    expect(cmd).not.toContain('dsh --profile web --no-open")')
  })
})
