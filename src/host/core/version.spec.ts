import { describe, expect, it } from 'vitest'
import { dshVersionGte, parseDshVersion } from './version.ts'

describe('parseDshVersion', () => {
  it('解析 rc 预发布版本', () => {
    expect(parseDshVersion('0.1.0-rc.8')).toEqual({ major: 0, minor: 1, patch: 0, rc: 8 })
    expect(parseDshVersion('0.1.5-rc.2')).toEqual({ major: 0, minor: 1, patch: 5, rc: 2 })
  })

  it('正式版（无 rc 后缀）rc = Infinity——排序上高于任何 rc', () => {
    expect(parseDshVersion('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0, rc: Infinity })
  })

  it('未知格式返回 null（调用方按版本未知处理，不阻塞启动）', () => {
    expect(parseDshVersion('')).toBeNull()
    expect(parseDshVersion('abc')).toBeNull()
    expect(parseDshVersion(null)).toBeNull()
    expect(parseDshVersion(undefined)).toBeNull()
  })

  it('容忍首尾空白；截断多余段（前缀匹配）', () => {
    expect(parseDshVersion('  0.2.3  ')).toEqual({ major: 0, minor: 2, patch: 3, rc: Infinity })
  })
})

describe('dshVersionGte', () => {
  it('rc.2 满足 rc.8 门槛（主版本更高）', () => {
    expect(dshVersionGte('0.1.5-rc.2', '0.1.0-rc.8')).toBe(true)
  })

  it('正式版高于同版本号的任何 rc', () => {
    expect(dshVersionGte('0.1.0', '0.1.0-rc.8')).toBe(true)
    expect(dshVersionGte('0.1.0-rc.99', '0.1.0')).toBe(false)
  })

  it('同版本号下 rc 序号比较', () => {
    expect(dshVersionGte('0.1.0-rc.8', '0.1.0-rc.8')).toBe(true)
    expect(dshVersionGte('0.1.0-rc.7', '0.1.0-rc.8')).toBe(false)
  })

  it('未知版本一律不满足门槛（宁可提醒升级也不误放行）', () => {
    expect(dshVersionGte('', '0.1.0-rc.8')).toBe(false)
    expect(dshVersionGte('bogus', '0.1.0-rc.8')).toBe(false)
  })
})
