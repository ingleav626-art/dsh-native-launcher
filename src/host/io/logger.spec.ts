import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COMPONENT_LOG_MAX_BYTES,
  MAIN_LOG_MAX_BYTES,
  beginApplyLog,
  logMsg,
  migrateLegacyLogs,
  nextSaveSeq,
  rotateComponentLogs,
} from './logger.ts'
import { logsDirOf } from '../core/paths.ts'

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-launcher-log-'))
  tempDirs.push(dir)
  return dir
}
// 测试结束统一清理（进程退出兜底，不阻塞用例）
process.on('exit', () => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 临时目录清理失败可容忍 */ }
  }
})

describe('logsDirOf', () => {
  it('日志目录 = 生成物目录下的 logs/ 子目录（布局单一派生点）', () => {
    expect(logsDirOf('C:/x/.dsh-webui-launcher')).toBe(join('C:/x/.dsh-webui-launcher', 'logs'))
  })
})

describe('migrateLegacyLogs', () => {
  it('把根目录 *.log 挪进 logs/，状态文件（json/txt）留在根目录', () => {
    const dir = makeTempDir()
    const logsDir = join(dir, 'logs')
    mkdirSync(logsDir, { recursive: true })
    writeFileSync(join(dir, 'native-launcher.log'), 'old')
    writeFileSync(join(dir, 'tray-exit.log'), 'old')
    writeFileSync(join(dir, 'tray-notify.json'), '{}')
    writeFileSync(join(dir, 'webui-url.txt'), 'http://x')
    migrateLegacyLogs(dir, logsDir)
    expect(existsSync(join(logsDir, 'native-launcher.log'))).toBe(true)
    expect(existsSync(join(logsDir, 'tray-exit.log'))).toBe(true)
    // 投递交接与状态文件不迁移（托盘/启动链在根目录读它们）
    expect(existsSync(join(dir, 'tray-notify.json'))).toBe(true)
    expect(existsSync(join(dir, 'webui-url.txt'))).toBe(true)
    expect(existsSync(join(dir, 'native-launcher.log'))).toBe(false)
  })

  it('logs/ 已存在同名日志时删根目录旧文件（新路径为准）', () => {
    const dir = makeTempDir()
    const logsDir = join(dir, 'logs')
    mkdirSync(logsDir, { recursive: true })
    writeFileSync(join(dir, 'a.log'), 'old-root')
    writeFileSync(join(logsDir, 'a.log'), 'new-logs')
    migrateLegacyLogs(dir, logsDir)
    expect(existsSync(join(dir, 'a.log'))).toBe(false)
    expect(readFileSync(join(logsDir, 'a.log'), 'utf8')).toBe('new-logs')
  })

  it('launcherDir 不存在时不抛错（日志系统不拖累启动）', () => {
    const dir = makeTempDir()
    migrateLegacyLogs(join(dir, 'not-exist'), join(dir, 'logs'))
  })
})

describe('beginApplyLog + logMsg 落盘', () => {
  it('logMsg 写入 logs/native-launcher.log，行格式 [ts] [级别5] [域] 消息', () => {
    const dir = makeTempDir()
    const { applySeq } = beginApplyLog(dir)
    expect(applySeq).toBeGreaterThanOrEqual(1)
    logMsg('[test-domain] hello message')
    const raw = readFileSync(join(dir, 'logs', 'native-launcher.log'), 'utf8')
    // 域从消息前缀 [tag] 提取并 padEnd(10)；正文为剩余文本
    expect(raw).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2}\] \[INFO \] \[test-domain\] hello message/)
  })

  it('无 [tag] 前缀的消息落在 launcher 域', () => {
    const dir = makeTempDir()
    beginApplyLog(dir)
    logMsg('plain message')
    const raw = readFileSync(join(dir, 'logs', 'native-launcher.log'), 'utf8')
    expect(raw).toMatch(/\[INFO \] \[launcher\s*\] plain message/)
  })
})

describe('nextSaveSeq', () => {
  it('保存链序号单调递增（config.set 的 save#N 串联因果）', () => {
    const a = nextSaveSeq()
    const b = nextSaveSeq()
    expect(b).toBe(a + 1)
  })
})

describe('组件日志轮转（2026-09-13 用户质询"会不会无限堆积"）', () => {
  const big = (bytes: number): string => 'x'.repeat(bytes)

  it('超过上限的组件日志归档为 .prev.log，未超限的不动', () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, 'tray-exit.log'), big(COMPONENT_LOG_MAX_BYTES + 1))
    writeFileSync(join(dir, 'launch.log'), 'small')
    const rotated = rotateComponentLogs(dir)
    expect(rotated).toEqual(['tray-exit.log'])
    // 归档名沿用主日志既有约定：<name>.log → <name>.prev.log
    expect(existsSync(join(dir, 'tray-exit.prev.log'))).toBe(true)
    expect(existsSync(join(dir, 'tray-exit.log'))).toBe(false)
    // 未超限的保持原样（不产生多余归档）
    expect(readFileSync(join(dir, 'launch.log'), 'utf8')).toBe('small')
    expect(existsSync(join(dir, 'launch.prev.log'))).toBe(false)
  })

  it('只保留两代：新归档覆盖上一代 .prev.log（不会越滚越多）', () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, 'open-webui.prev.log'), 'gen-1')
    writeFileSync(join(dir, 'open-webui.log'), big(COMPONENT_LOG_MAX_BYTES + 1))
    rotateComponentLogs(dir)
    expect(readFileSync(join(dir, 'open-webui.prev.log'), 'utf8')).not.toBe('gen-1')
    // 目录里永远只有 <name>.log 与 <name>.prev.log 两个名字
    expect(existsSync(join(dir, 'open-webui.prev.prev.log'))).toBe(false)
  })

  it('已有 .prev.log 不会被再次轮转（否则会 .prev.prev.log 无限套娃）', () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, 'a.prev.log'), big(COMPONENT_LOG_MAX_BYTES + 1))
    expect(rotateComponentLogs(dir)).toEqual([])
    expect(existsSync(join(dir, 'a.prev.log'))).toBe(true)
  })

  it('非 .log 文件一律不动（tray-notify.json 是投递交接状态，不是日志）', () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, 'tray-notify.json'), big(COMPONENT_LOG_MAX_BYTES + 1))
    expect(rotateComponentLogs(dir)).toEqual([])
    expect(existsSync(join(dir, 'tray-notify.json'))).toBe(true)
  })

  it('主日志用更大的上限（1MB），组件日志用 256KB', () => {
    const dir = makeTempDir()
    const between = COMPONENT_LOG_MAX_BYTES + 1
    writeFileSync(join(dir, 'native-launcher.log'), big(between))
    writeFileSync(join(dir, 'tray-exit.log'), big(between))
    expect(rotateComponentLogs(dir)).toEqual(['tray-exit.log'])
    expect(existsSync(join(dir, 'native-launcher.log'))).toBe(true)
    // 主日志确实在 1MB 才轮转
    writeFileSync(join(dir, 'native-launcher.log'), big(MAIN_LOG_MAX_BYTES + 1))
    expect(rotateComponentLogs(dir)).toEqual(['native-launcher.log'])
  })

  it('beginApplyLog 会执行轮转并把结果写进主日志（用户看日志即知滚过档）', () => {
    const dir = makeTempDir()
    mkdirSync(join(dir, 'logs'), { recursive: true })
    writeFileSync(join(dir, 'logs', 'pwa-scan.log'), big(COMPONENT_LOG_MAX_BYTES + 1))
    beginApplyLog(dir)
    expect(existsSync(join(dir, 'logs', 'pwa-scan.prev.log'))).toBe(true)
    const main = readFileSync(join(dir, 'logs', 'native-launcher.log'), 'utf8')
    expect(main).toContain('轮转超限日志')
    expect(main).toContain('pwa-scan.log')
  })

  it('logs 目录不存在时不抛错（轮转不拖累启动）', () => {
    const dir = makeTempDir()
    expect(rotateComponentLogs(join(dir, 'not-exist'))).toEqual([])
  })
})
