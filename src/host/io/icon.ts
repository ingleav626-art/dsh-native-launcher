/**
 * 图标资源（L2 副作用边界）：包内 .ico 的落地、PNG 提取/方形化、data URL 派生。
 * 从 index.js 原样搬入（P2-B3）。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { LogFn } from '../types.ts';

/**
 * 本包内的图标资源。
 * 注意：此模块经 esbuild 产出为 `lib/host/icon.js`，`import.meta.url` 运行时指向**产物**位置
 * （不是源码 src/host/io/——两层 `../` 从 lib/host/ 回到包根；P2-B3 沙箱实测纠正，
 * 按源码深度写三层会解析到包外）。改产物目录深度时必须同步这里并跑沙箱。
 */
const ICON_RESOURCE = fileURLToPath(new URL('../../assets/dsh-webui.ico', import.meta.url));

/** 把包内图标复制到用户目录（快捷方式图标路径需要稳定且长期存在）。内容变化时覆盖更新。 */
export function ensureIcon(launcherDir: string, logMsg: LogFn): string | null {
  try {
    const target = join(launcherDir, 'dsh-webui.ico');
    if (!existsSync(target) || readFileSync(target).length !== readFileSync(ICON_RESOURCE).length) {
      mkdirSync(launcherDir, { recursive: true });
      copyFileSync(ICON_RESOURCE, target);
      logMsg('icon copied/updated');
    }
    return target;
  } catch (error) {
    logMsg(`icon copy failed: ${error}`);
    return null;
  }
}

/** 从 ICO 文件提取内嵌 PNG（Buffer，用于 /icon.png 路由）。 */
export function extractPngBuffer(iconPath: string | null): Buffer | null {
  try {
    const buf = readFileSync(iconPath as string);
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const start = buf.indexOf(pngMagic);
    if (start < 0) return null;
    return buf.subarray(start);
  } catch {
    return null;
  }
}

/** 读 PNG 头部获取尺寸（IHDR：字节 16-23）。非法输入返回 null。 */
export function pngSize(buf: Buffer | null | undefined): { w: number; h: number } | null {
  try {
    if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(12) !== 0x49484452) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/**
 * 确保 PWA 图标是方形：Windows 应用列表/任务栏按方形渲染，非方形图标会被压缩变形（很难看）。
 * 源已是 256×256 方形则直接返回（不落缓存，避免旧缓存污染）；
 * 否则用 PowerShell System.Drawing 做"保真填充"（缩放至 256 宽、上下补透明），不裁切不变形。
 * 结果缓存到 launcherDir/icon-256.png；失败回退原 PNG。
 */
export function ensureSquareIconPng(launcherDir: string, pngBuffer: Buffer, logMsg: LogFn): Buffer {
  try {
    const size = pngSize(pngBuffer);
    if (size && size.w === 256 && size.h === 256) return pngBuffer; // 官方图标已是 256×256 方形
    const outPath = join(launcherDir, 'icon-256.png');
    if (existsSync(outPath)) return readFileSync(outPath);
    // 先写临时输入文件
    const inPath = join(launcherDir, 'icon-source.png');
    writeFileSync(inPath, pngBuffer);
    const ps = [
      'Add-Type -AssemblyName System.Drawing',
      `$src = [System.Drawing.Image]::FromFile('${inPath.replace(/'/g, "''")}')`,
      '$w = $src.Width; $h = $src.Height',
      'if ($w -eq 256 -and $h -eq 256) { $src.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png); exit 0 }',
      '$bmp = New-Object System.Drawing.Bitmap(256, 256)',
      '$g = [System.Drawing.Graphics]::FromImage($bmp)',
      '$g.Clear([System.Drawing.Color]::Transparent)',
      '$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
      '$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality',
      '$ratio = [Math]::Min(256 / $w, 256 / $h)',
      '$nw = [Math]::Floor($w * $ratio); $nh = [Math]::Floor($h * $ratio)',
      '$x = [Math]::Floor((256 - $nw) / 2); $y = [Math]::Floor((256 - $nh) / 2)',
      '$g.DrawImage($src, $x, $y, $nw, $nh)',
      '$bmp.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png)',
      '$g.Dispose(); $bmp.Dispose(); $src.Dispose()',
      'exit 0',
    ].join('; ');
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps, outPath], { stdio: 'ignore', windowsHide: true });
    // 清理临时输入
    try { unlinkSync(inPath); } catch {}
    if (result.status === 0 && existsSync(outPath)) {
      logMsg('square icon generated (256x256)');
      return readFileSync(outPath);
    }
    logMsg('square icon generation failed, falling back to source png');
  } catch (error) {
    logMsg(`square icon failed: ${error}`);
  }
  return pngBuffer;
}

/** 从 ICO 文件提取内嵌 PNG，返回 data URL（用于页面 favicon / --app 窗口任务栏图标）。 */
export function extractPngDataUrl(iconPath: string | null): string | null {
  const png = extractPngBuffer(iconPath);
  return png ? `data:image/png;base64,${png.toString('base64')}` : null;
}
