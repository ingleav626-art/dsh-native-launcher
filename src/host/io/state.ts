/**
 * launcherDir 状态文件的 JSON 读写（L2 副作用边界）——2026-09-14 状态文件工程化。
 * 背景：历史状态用裸 txt（tray-pid.txt / tray-version.txt / webui-url.txt /
 * shortcut-registry.txt），无结构无元数据、PowerShell 写入带 BOM 污染（node 读取需
 * 特殊处理）、托盘状态拆散两文件——统一迁移为 JSON（无 BOM，自带字段语义）。
 *
 * 兼容策略（一次迁移，读侧兜底）：
 *  - tray-state.json 不存在时回退读旧 txt（升级瞬间旧托盘还在写 txt 的场景）；
 *  - shortcut-registry.json 不存在时迁移旧 txt（行 = lnk 路径）；
 *  - webui-url.json 单写（2026-09-14 用户要求彻底去 txt：旧 txt 仅在升级瞬间可读，
 *    不再产生新 txt 文件——回退形态 launch.cmd 读不到 token 时走基础 URL 探测，行为等价）。
 * 全部写入经 WriteAllText 语义（无 BOM）。
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** 去掉 UTF-8 BOM 与首尾空白（旧 txt 由 PowerShell UTF8 写入，带 BOM）。 */
function cleanTxt(raw: string): string {
  return raw.replace(/^\uFEFF/, '').trim();
}

/** 托盘运行状态：出生登记（PID）+ 脚本版本（apply 自更新对比）合一。 */
export interface TrayState {
  pid: number;
  scriptVersion: number;
  startedAt: string;
}

const trayStatePath = (dir: string): string => join(dir, 'tray-state.json');

/** 读托盘状态：JSON 优先，回退旧 txt（pid.txt + version.txt 合并语义）。读不到返回 null。 */
export function readTrayState(dir: string): TrayState | null {
  const jsonPath = trayStatePath(dir);
  try {
    if (existsSync(jsonPath)) {
      const raw = JSON.parse(cleanTxt(readFileSync(jsonPath, 'utf-8'))) as Partial<TrayState>;
      if (Number.isInteger(raw.pid) && (raw.pid ?? 0) > 0 && Number.isInteger(raw.scriptVersion)) {
        return { pid: raw.pid as number, scriptVersion: raw.scriptVersion as number, startedAt: String(raw.startedAt ?? '') };
      }
    }
  } catch { /* 损坏 JSON 按不存在处理 */ }
  // 旧 txt 回退：升级瞬间旧托盘（v21 及以前）还在写 txt
  try {
    const pidTxt = join(dir, 'tray-pid.txt');
    const verTxt = join(dir, 'tray-version.txt');
    if (existsSync(pidTxt) && existsSync(verTxt)) {
      const pid = parseInt(cleanTxt(readFileSync(pidTxt, 'utf-8')), 10);
      const scriptVersion = parseInt(cleanTxt(readFileSync(verTxt, 'utf-8')), 10);
      if (Number.isInteger(pid) && pid > 0 && Number.isInteger(scriptVersion)) {
        return { pid, scriptVersion, startedAt: '' };
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** 写托盘状态（无 BOM；由托盘脚本与 host 双方共用同一格式）。 */
export function writeTrayState(dir: string, state: TrayState): void {
  writeFileSync(trayStatePath(dir), JSON.stringify(state), 'utf-8');
}

/** 迁移收尾：状态已入 JSON 后删除旧 txt（静默，失败留待下次）。 */
export function cleanupLegacyTrayTxt(dir: string): void {
  for (const name of ['tray-pid.txt', 'tray-version.txt']) {
    try { unlinkSync(join(dir, name)); } catch { /* 占用中留待下次 */ }
  }
}

/** WebUI 带 token URL 的捕获状态。 */
export interface WebuiUrlState {
  url: string;
  port: number;
  capturedAt: string;
}

const webuiUrlPath = (dir: string): string => join(dir, 'webui-url.json');

/** 读 WebUI URL：JSON 优先，回退旧 txt（裸 URL 行）。 */
export function readWebuiUrl(dir: string): WebuiUrlState | null {
  const jsonPath = webuiUrlPath(dir);
  try {
    if (existsSync(jsonPath)) {
      const raw = JSON.parse(cleanTxt(readFileSync(jsonPath, 'utf-8'))) as Partial<WebuiUrlState>;
      if (typeof raw.url === 'string' && raw.url && Number.isInteger(raw.port)) {
        return { url: raw.url, port: raw.port as number, capturedAt: String(raw.capturedAt ?? '') };
      }
    }
  } catch { /* 损坏 JSON 按不存在处理 */ }
  try {
    const txt = join(dir, 'webui-url.txt');
    if (existsSync(txt)) {
      const url = cleanTxt(readFileSync(txt, 'utf-8'));
      if (url) return { url, port: 0, capturedAt: '' };
    }
  } catch { /* ignore */ }
  return null;
}

/** 写 WebUI URL（单写 JSON，无 BOM）。 */
export function writeWebuiUrl(dir: string, url: string, port: number, capturedAt: string): void {
  writeFileSync(webuiUrlPath(dir), JSON.stringify({ url, port, capturedAt }), 'utf-8');
}

/** 桌面快捷方式登记（卸载定点清除依据）。 */
export interface ShortcutEntry {
  path: string;
  createdAt: string;
}

const shortcutPath = (dir: string): string => join(dir, 'shortcut-registry.json');

/** 读快捷方式登记：JSON 优先，回退并迁移旧 txt（行 = lnk 路径）。 */
export function readShortcutRegistry(dir: string): ShortcutEntry[] {
  const jsonPath = shortcutPath(dir);
  try {
    if (existsSync(jsonPath)) {
      const raw = JSON.parse(cleanTxt(readFileSync(jsonPath, 'utf-8'))) as ShortcutEntry[];
      if (Array.isArray(raw)) return raw.filter((e) => typeof e?.path === 'string' && e.path);
    }
  } catch { /* 损坏按不存在处理 */ }
  try {
    const txt = join(dir, 'shortcut-registry.txt');
    if (existsSync(txt)) {
      const entries = cleanTxt(readFileSync(txt, 'utf-8')).split(/\r?\n/).filter(Boolean).map((p) => ({ path: p, createdAt: '' }));
      if (entries.length) writeShortcutRegistry(dir, entries); // 迁移：转 JSON
      return entries;
    }
  } catch { /* ignore */ }
  return [];
}

/** 写快捷方式登记（JSON；旧 txt 若存在则迁移后删除）。 */
export function writeShortcutRegistry(dir: string, entries: ShortcutEntry[]): void {
  writeFileSync(shortcutPath(dir), JSON.stringify(entries, null, 2), 'utf-8');
  try {
    const txt = join(dir, 'shortcut-registry.txt');
    if (existsSync(txt)) unlinkSync(txt);
  } catch { /* ignore */ }
}

/**
 * 遗留状态文件统一迁移（apply 每次调用，幂等）：把历史版本的裸 txt 状态文件
 * 转成 JSON 后清理。2026-09-15 沙箱实测发现三类漏洞——webui-url.txt 无清理逻辑、
 * tray txt 只在托盘 kill 分支清理、shortcut txt 只在创建快捷方式时迁移——
 * 导致升级后旧 txt 长期残留。此处集中处理，与各读写路径的"顺手迁移"互补。
 * 返回处理说明列表（供日志）。
 */
export function migrateLegacyStateFiles(dir: string): string[] {
  const notes: string[] = [];
  // 1) tray-pid.txt + tray-version.txt → tray-state.json（仅在 json 缺失且两者可读时合成，保留信息）
  const hadTrayTxt = existsSync(join(dir, 'tray-pid.txt')) || existsSync(join(dir, 'tray-version.txt'));
  try {
    const pidTxt = join(dir, 'tray-pid.txt');
    const verTxt = join(dir, 'tray-version.txt');
    const hasPid = existsSync(pidTxt);
    const hasVer = existsSync(verTxt);
    if ((hasPid || hasVer) && !existsSync(trayStatePath(dir))) {
      const pid = hasPid ? parseInt(cleanTxt(readFileSync(pidTxt, 'utf-8')), 10) : NaN;
      const ver = hasVer ? parseInt(cleanTxt(readFileSync(verTxt, 'utf-8')), 10) : NaN;
      if (Number.isInteger(pid) && pid > 0 && Number.isInteger(ver)) {
        writeTrayState(dir, { pid, scriptVersion: ver, startedAt: '' });
        notes.push(`tray-state.json ← tray-pid.txt+tray-version.txt`);
      }
    }
  } catch { /* ignore */ }
  cleanupLegacyTrayTxt(dir);
  if (hadTrayTxt) {
    notes.push(
      existsSync(join(dir, 'tray-pid.txt')) || existsSync(join(dir, 'tray-version.txt'))
        ? 'tray txt cleanup deferred (in use)'
        : 'tray-pid.txt/tray-version.txt removed',
    );
  }
  // 2) webui-url.txt → webui-url.json（json 缺失时迁移内容，port 从 URL 解析；随后删 txt）
  try {
    const urlTxt = join(dir, 'webui-url.txt');
    if (existsSync(urlTxt)) {
      if (!existsSync(webuiUrlPath(dir))) {
        const url = cleanTxt(readFileSync(urlTxt, 'utf-8'));
        const port = Number(new URL(url).port) || 0;
        if (url) { writeWebuiUrl(dir, url, port, ''); notes.push('webui-url.json ← webui-url.txt'); }
      }
      unlinkSync(urlTxt);
      notes.push('webui-url.txt removed');
    }
  } catch { /* ignore */ }
  // 3) shortcut-registry.txt → shortcut-registry.json（json 缺失时迁移内容；随后无条件删 txt——
  //    2026-09-15 复验实锤：json 已存在时旧 txt 会残留，因为 readShortcutRegistry 的迁移只在 json 缺失时走）
  try {
    const txt = join(dir, 'shortcut-registry.txt');
    if (existsSync(txt)) {
      if (!existsSync(shortcutPath(dir))) {
        const entries = readShortcutRegistry(dir);
        notes.push(`shortcut-registry.json ← txt (${String(entries.length)} entries)`);
      }
      if (existsSync(txt)) unlinkSync(txt);
      notes.push(
        existsSync(txt) ? 'shortcut-registry.txt cleanup deferred' : 'shortcut-registry.txt removed',
      );
    }
  } catch { /* ignore */ }
  return notes;
}
