/**
 * dsh 版本解析与比较（L1 纯函数）。
 *
 * rc 预发布语义：无 rc 后缀（正式版）rc=Infinity——`0.1.0` > `0.1.0-rc.99`，
 * 与 semver 预发布排序一致。未知格式返回 null（调用方按「版本未知」处理，不阻塞启动）。
 */

export interface DshVersion {
  major: number
  minor: number
  patch: number
  rc: number
}

/** 解析 dsh 版本（'0.1.0-rc.8' → {major,minor,patch,rc}）；未知格式返回 null。 */
export function parseDshVersion(v: unknown): DshVersion | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?/.exec(String(v || '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], rc: m[4] === undefined ? Infinity : +m[4] };
}

/** 比较两个版本字符串（含 rc 预发布），v >= target 返回 true。 */
export function dshVersionGte(v: unknown, target: string): boolean {
  const a = parseDshVersion(v);
  const b = parseDshVersion(target);
  if (!a || !b) return false;
  const keys = ['major', 'minor', 'patch', 'rc'] as const;
  for (const key of keys) {
    if (a[key] !== b[key]) return a[key] > b[key];
  }
  return true;
}
