import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { beginApplyLog, logMsg, logsDirOf, migrateLegacyLogs, nextSaveSeq } from './logger.ts'

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
