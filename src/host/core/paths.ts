/**
 * 路径规则与只读探测（L1）——布局单一派生点，改目录布局只改这里。
 * 计划 L1 职责原文：「路径规则、端口探测判定」——resolveDesktopPath 属于前者。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 日志子目录：**所有诊断日志都写在这里**，用户排错时整包发这一个文件夹即可
 * （2026-09-11 用户定调：日志要好找、能一把拖过来；根目录只留脚本与状态文件）。
 */
export function logsDirOf(launcherDir: string): string {
  return join(launcherDir, 'logs');
}

/** 解析 Windows 桌面路径（优先 OneDrive 重定向的桌面）。 */
export function resolveDesktopPath(): string | null {
  const profile = process.env.USERPROFILE;
  if (!profile) return null;
  const candidates = [
    join(profile, 'OneDrive', 'Desktop'),
    join(profile, 'Desktop'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}
