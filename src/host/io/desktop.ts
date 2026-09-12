/**
 * Windows 桌面目录解析（L2，诊断与快捷方式的共用底层设施）。
 * 从 index.js 原样搬入（P2-B1）：优先 OneDrive 重定向的桌面——
 * OneDrive 已接管桌面的机器上，快捷方式写到真实桌面才可见。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
  return candidates[candidates.length - 1] as string;
}
