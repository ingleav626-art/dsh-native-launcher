/**
 * 状态文件 JSON 化的单元测试（v0.4.1 工程化）：
 * 覆盖 ① tray-state 读写与旧 txt 回退 ② webui-url 双写兼容 ③ shortcut-registry 旧 txt 迁移。
 * 全部走真实 tmp 目录文件系统（原则二/三：数据来自真实形状，不 mock fs）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readTrayState, writeTrayState, cleanupLegacyTrayTxt,
  readWebuiUrl, writeWebuiUrl,
  readShortcutRegistry, writeShortcutRegistry,
} from './state.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-state-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readTrayState', () => {
  it('读 JSON：pid/scriptVersion/startedAt 齐全', () => {
    writeTrayState(dir, { pid: 17844, scriptVersion: 22, startedAt: '2026-09-14T11:30:00+08:00' })
    const s = readTrayState(dir)
    expect(s).toEqual({ pid: 17844, scriptVersion: 22, startedAt: '2026-09-14T11:30:00+08:00' })
  })

  it('JSON 不存在 → 回退旧 txt 合并（BOM 兼容：PowerShell UTF8 写入带 BOM，issue 实测）', () => {
    mkdirSync(dir, { recursive: true })
    // 带 BOM 写入，模拟旧 PowerShell Set-Content -Encoding UTF8 的真实形态
    writeFileSync(join(dir, 'tray-pid.txt'), '\uFEFF17844', 'utf-8')
    writeFileSync(join(dir, 'tray-version.txt'), '\uFEFF21', 'utf-8')
    expect(readTrayState(dir)).toEqual({ pid: 17844, scriptVersion: 21, startedAt: '' })
  })

  it('损坏 JSON 容错 → 回退旧 txt 而非抛异常', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'tray-state.json'), '{ broken json', 'utf-8')
    writeFileSync(join(dir, 'tray-pid.txt'), '42', 'utf-8')
    writeFileSync(join(dir, 'tray-version.txt'), '22', 'utf-8')
    expect(readTrayState(dir)?.pid).toBe(42)
  })

  it('两者皆无 → null', () => {
    expect(readTrayState(dir)).toBeNull()
  })

  it('JSON 里 pid 非法（0/负数/缺失）→ 视为无效回退 txt', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'tray-state.json'), '{"pid":0,"scriptVersion":22}', 'utf-8')
    writeFileSync(join(dir, 'tray-pid.txt'), '99', 'utf-8')
    writeFileSync(join(dir, 'tray-version.txt'), '21', 'utf-8')
    expect(readTrayState(dir)?.pid).toBe(99)
  })
})

describe('cleanupLegacyTrayTxt', () => {
  it('删除旧 txt（迁移收尾），不存在时静默', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'tray-pid.txt'), '1', 'utf-8')
    cleanupLegacyTrayTxt(dir)
    expect(existsSync(join(dir, 'tray-pid.txt'))).toBe(false)
    expect(() => cleanupLegacyTrayTxt(dir)).not.toThrow()
  })
})

describe('webui-url 双写兼容', () => {
  it('writeWebuiUrl 同时落 json（结构化）与 txt（launch.cmd 回退兼容）', () => {
    writeWebuiUrl(dir, 'http://127.0.0.1:3080/?token=abc', 3080, '2026-09-14T11:35:00+08:00')
    const j = JSON.parse(readFileSync(join(dir, 'webui-url.json'), 'utf-8'))
    expect(j).toEqual({ url: 'http://127.0.0.1:3080/?token=abc', port: 3080, capturedAt: '2026-09-14T11:35:00+08:00' })
    expect(readFileSync(join(dir, 'webui-url.txt'), 'utf-8')).toContain('token=abc')
    expect(readWebuiUrl(dir)?.port).toBe(3080)
  })

  it('只有旧 txt（升级瞬间）→ 回退读出 URL', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'webui-url.txt'), 'http://127.0.0.1:3080/?token=old\n', 'utf-8')
    expect(readWebuiUrl(dir)?.url).toBe('http://127.0.0.1:3080/?token=old')
  })
})

describe('shortcut-registry 旧 txt 迁移', () => {
  it('旧 txt 存在 → 读出条目并迁移为 json（txt 删除）', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'shortcut-registry.txt'), 'C:\\a\\x.lnk\r\nC:\\b\\y.lnk\r\n', 'utf-8')
    const entries = readShortcutRegistry(dir)
    expect(entries.map((e) => e.path)).toEqual(['C:\\a\\x.lnk', 'C:\\b\\y.lnk'])
    expect(existsSync(join(dir, 'shortcut-registry.txt'))).toBe(false)
    expect(existsSync(join(dir, 'shortcut-registry.json'))).toBe(true)
    // 迁移后 json 继续可读
    expect(readShortcutRegistry(dir).length).toBe(2)
  })

  it('writeShortcutRegistry 写 JSON 且不残留旧 txt', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'shortcut-registry.txt'), 'C:\\old.lnk', 'utf-8')
    writeShortcutRegistry(dir, [{ path: 'C:\\new.lnk', createdAt: '2026-09-14T11:40:00+08:00' }])
    expect(existsSync(join(dir, 'shortcut-registry.txt'))).toBe(false)
    expect(readShortcutRegistry(dir)).toEqual([{ path: 'C:\\new.lnk', createdAt: '2026-09-14T11:40:00+08:00' }])
  })
})
