/**
 * 开机自启动（ensureStartupShortcut）行为测试——2026-09-12 用户质问"自启的测试能抓住吗"
 * 的补课：此前该功能只有字段存在性守卫（schema/config.get/前端控件），行为逻辑零覆盖。
 *
 * mock 口径（AGENTS.md 测试原则三/五）：只 mock 外部边界——fs（lnk 文件存在/读取/删除）
 * 与 child_process（PowerShell 建 lnk）；被测链路 ensureStartupShortcut 本体走真实函数。
 * 每个用例写明预期（原则四）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const existsSync = vi.fn()
const readFileSync = vi.fn()
const unlinkSync = vi.fn()
const spawnSync = vi.fn()

vi.mock('node:fs', () => ({
  default: {},
  existsSync: (...a: unknown[]) => existsSync(...(a as [])),
  readFileSync: (...a: unknown[]) => readFileSync(...(a as [])),
  unlinkSync: (...a: unknown[]) => unlinkSync(...(a as [])),
  writeFileSync: vi.fn(),
}))
vi.mock('node:child_process', () => ({
  default: {},
  spawnSync: (...a: unknown[]) => spawnSync(...(a as [])),
}))

import { ensureStartupShortcut, startupLnkPath } from './shortcut.ts'

const LOGS: string[] = []
const logMsg = (m: string) => LOGS.push(m)
const VBS = 'C:\\fake\\launcher.vbs'
const lnk = () => startupLnkPath('DSH WebUI')

afterEach(() => {
  vi.clearAllMocks()
  LOGS.length = 0
})

describe('startupLnkPath（纯函数）', () => {
  it('用 APPDATA 拼出 shell:startup 下的快捷方式路径', () => {
    vi.stubEnv('APPDATA', 'C:\\fake\\appdata')
    expect(startupLnkPath('DSH WebUI')).toBe('C:\\fake\\appdata\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\DSH WebUI.lnk')
    vi.unstubAllEnvs()
  })
})

describe('ensureStartupShortcut：关闭（enabled=false）', () => {
  it('lnk 存在 → 删除并留痕', () => {
    // 预期：开关关掉时清理启动项——existsSync 命中 → unlinkSync 必须被调用
    existsSync.mockReturnValue(true)
    ensureStartupShortcut('DSH WebUI', VBS, null, false, logMsg)
    expect(unlinkSync).toHaveBeenCalledWith(lnk())
    expect(LOGS.some((l) => l.includes('startup shortcut removed'))).toBe(true)
  })

  it('lnk 不存在 → 什么都不做（幂等，重复关闭无副作用），并留痕"关闭无残留"分支', () => {
    existsSync.mockReturnValue(false)
    ensureStartupShortcut('DSH WebUI', VBS, null, false, logMsg)
    expect(unlinkSync).not.toHaveBeenCalled()
    expect(spawnSync).not.toHaveBeenCalled()
    expect(LOGS.some((l) => l.includes('disabled') && l.includes('nothing to clean'))).toBe(true)
  })
})

describe('ensureStartupShortcut：开启（enabled=true）', () => {
  it('lnk 不存在 → PowerShell 退出 0 且回读存在 → 记 created', () => {
    // 预期：创建成功以"退出码 0 + lnk 真实落盘"双条件判定（缺一即 FAILED）
    existsSync.mockReturnValueOnce(false).mockReturnValueOnce(true)
    spawnSync.mockReturnValue({ status: 0 })
    ensureStartupShortcut('DSH WebUI', VBS, 'C:\\fake\\icon.ico', true, logMsg)
    expect(spawnSync).toHaveBeenCalledTimes(1)
    const cmd = String(spawnSync.mock.calls[0][1]?.[3] ?? '')
    expect(cmd).toContain('wscript.exe')
    expect(cmd).toContain(lnk().replace(/'/g, "''"))
    expect(cmd).toContain(VBS)
    expect(cmd).toContain('icon.ico')
    expect(LOGS.some((l) => l.includes('startup shortcut created'))).toBe(true)
    expect(LOGS.some((l) => l.includes('FAILED'))).toBe(false)
  })

  it('PowerShell 非零退出 → 记 FAILED（含退出码与输出），不得谎报 created', () => {
    // 预期：创建失败必须留失败原因（退出码+stderr），此前无条件打 created 是谎报
    existsSync.mockReturnValue(false)
    spawnSync.mockReturnValue({ status: 1, stderr: 'Access denied' })
    ensureStartupShortcut('DSH WebUI', VBS, null, true, logMsg)
    expect(LOGS.some((l) => l.includes('creation FAILED') && l.includes('exit=1') && l.includes('Access denied'))).toBe(true)
    expect(LOGS.some((l) => l.includes('startup shortcut created'))).toBe(false)
  })

  it('PowerShell 退出 0 但 lnk 未落盘 → 记 FAILED（回读验证）', () => {
    existsSync.mockReturnValue(false) // 创建后回读仍 false = Save 没生效
    spawnSync.mockReturnValue({ status: 0 })
    ensureStartupShortcut('DSH WebUI', VBS, null, true, logMsg)
    expect(LOGS.some((l) => l.includes('creation FAILED') && l.includes('lnk missing'))).toBe(true)
    expect(LOGS.some((l) => l.includes('startup shortcut created'))).toBe(false)
  })

  it('lnk 已存在且指向当前 vbs → 幂等跳过（不重建）', () => {
    // 预期：重复 apply 不产生副作用——lnk 内容含当前 vbs（lnk 以 UTF-16 存路径）→ 不再 spawn
    existsSync.mockReturnValue(true)
    readFileSync.mockReturnValue(Buffer.from(VBS, 'utf16le'))
    ensureStartupShortcut('DSH WebUI', VBS, null, true, logMsg)
    expect(spawnSync).not.toHaveBeenCalled()
    expect(LOGS.some((l) => l.includes('skipping'))).toBe(true)
  })

  it('lnk 存在但指向别处（孤儿）→ 重建', () => {
    // 预期：目录迁移后 lnk 成孤儿（指向旧 vbs）→ 自动重建为当前 vbs
    existsSync.mockReturnValue(true)
    readFileSync.mockReturnValue(Buffer.from('C:\\old\\other.vbs', 'utf16le'))
    ensureStartupShortcut('DSH WebUI', VBS, null, true, logMsg)
    expect(spawnSync).toHaveBeenCalledTimes(1)
    expect(LOGS.some((l) => l.includes('recreating'))).toBe(true)
  })
})

describe('ensureStartupShortcut：异常隔离', () => {
  it('fs 抛错 → 记日志不向上抛（绝不拖垮 apply 主流程）', () => {
    // 预期：容器隔离原则——自启失败只记日志，不能把 apply 炸掉
    existsSync.mockImplementation(() => { throw new Error('disk error') })
    expect(() => ensureStartupShortcut('DSH WebUI', VBS, null, true, logMsg)).not.toThrow()
    expect(LOGS.some((l) => l.includes('startup shortcut failed'))).toBe(true)
  })
})
