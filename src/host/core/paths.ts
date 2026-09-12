/**
 * 路径规则（L1 纯函数）——布局单一派生点，改目录布局只改这里。
 */
import { join } from 'node:path';

/**
 * 日志子目录：**所有诊断日志都写在这里**，用户排错时整包发这一个文件夹即可
 * （2026-09-11 用户定调：日志要好找、能一把拖过来；根目录只留脚本与状态文件）。
 */
export function logsDirOf(launcherDir: string): string {
  return join(launcherDir, 'logs');
}
