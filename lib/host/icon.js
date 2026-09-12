// src/host/io/icon.ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
var ICON_RESOURCE = fileURLToPath(new URL("../../assets/dsh-webui.ico", import.meta.url));
function ensureIcon(launcherDir, logMsg) {
  try {
    const target = join(launcherDir, "dsh-webui.ico");
    if (!existsSync(target) || readFileSync(target).length !== readFileSync(ICON_RESOURCE).length) {
      mkdirSync(launcherDir, { recursive: true });
      copyFileSync(ICON_RESOURCE, target);
      logMsg("icon copied/updated");
    }
    return target;
  } catch (error) {
    logMsg(`icon copy failed: ${error}`);
    return null;
  }
}
function extractPngBuffer(iconPath) {
  try {
    const buf = readFileSync(iconPath);
    const pngMagic = Buffer.from([137, 80, 78, 71]);
    const start = buf.indexOf(pngMagic);
    if (start < 0) return null;
    return buf.subarray(start);
  } catch {
    return null;
  }
}
function pngSize(buf) {
  try {
    if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 2303741511 || buf.readUInt32BE(12) !== 1229472850) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}
function ensureSquareIconPng(launcherDir, pngBuffer, logMsg) {
  try {
    const size = pngSize(pngBuffer);
    if (size && size.w === 256 && size.h === 256) return pngBuffer;
    const outPath = join(launcherDir, "icon-256.png");
    if (existsSync(outPath)) return readFileSync(outPath);
    const inPath = join(launcherDir, "icon-source.png");
    writeFileSync(inPath, pngBuffer);
    const ps = [
      "Add-Type -AssemblyName System.Drawing",
      `$src = [System.Drawing.Image]::FromFile('${inPath.replace(/'/g, "''")}')`,
      "$w = $src.Width; $h = $src.Height",
      "if ($w -eq 256 -and $h -eq 256) { $src.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png); exit 0 }",
      "$bmp = New-Object System.Drawing.Bitmap(256, 256)",
      "$g = [System.Drawing.Graphics]::FromImage($bmp)",
      "$g.Clear([System.Drawing.Color]::Transparent)",
      "$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
      "$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality",
      "$ratio = [Math]::Min(256 / $w, 256 / $h)",
      "$nw = [Math]::Floor($w * $ratio); $nh = [Math]::Floor($h * $ratio)",
      "$x = [Math]::Floor((256 - $nw) / 2); $y = [Math]::Floor((256 - $nh) / 2)",
      "$g.DrawImage($src, $x, $y, $nw, $nh)",
      "$bmp.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png)",
      "$g.Dispose(); $bmp.Dispose(); $src.Dispose()",
      "exit 0"
    ].join("; ");
    const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps, outPath], { stdio: "ignore", windowsHide: true });
    try {
      unlinkSync(inPath);
    } catch {
    }
    if (result.status === 0 && existsSync(outPath)) {
      logMsg("square icon generated (256x256)");
      return readFileSync(outPath);
    }
    logMsg("square icon generation failed, falling back to source png");
  } catch (error) {
    logMsg(`square icon failed: ${error}`);
  }
  return pngBuffer;
}
function extractPngDataUrl(iconPath) {
  const png = extractPngBuffer(iconPath);
  return png ? `data:image/png;base64,${png.toString("base64")}` : null;
}
export {
  ensureIcon,
  ensureSquareIconPng,
  extractPngBuffer,
  extractPngDataUrl,
  pngSize
};
