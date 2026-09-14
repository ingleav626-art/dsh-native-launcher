/**
 * 重生成真机启动脚本（开发/调试用）：按当前 lib/ 产物重写 launcherDir 下的全部生成物——
 * launch 系列（writeLauncherFiles）+ open-webui.ps1（writeOpenScript）+ tray.ps1（writeTrayScript），
 * 与 applyInner 的写入集对齐（漏任何一个都会造成"改了没生效"的排查浪费，2026-09-14 教训）。
 * 跑法：node tools/regen-launcher.mjs [launcherDir] [port] [shortcutName] [pwaAppId]
 */
import { writeLauncherFiles, writeOpenScript } from '../lib/host/scripts.js'
import { writeTrayScript } from '../lib/host/tray.js'
import { join } from 'node:path'

const dir = process.argv[2] || join(process.env.USERPROFILE ?? '', '.dsh-webui-launcher')
const port = Number(process.argv[3]) || 3080
const shortcutName = process.argv[4] || 'DSH WebUI'
const pwaAppId = process.argv[5] || 'ofjcbbcobnobobmogpaohlojjnjfcplh'

const iconPath = join(dir, 'dsh-webui.ico')
const openScriptPath = join(dir, 'open-webui.ps1')
const launchCommand = 'dsh --profile web --no-open'

writeLauncherFiles(dir, launchCommand, port, join(dir, 'tray.ps1'), openScriptPath)
writeOpenScript(dir, port, 'app', shortcutName, pwaAppId)
writeTrayScript(dir, port, iconPath, openScriptPath, pwaAppId)
console.log(`regenerated: launch 系列 + open-webui.ps1 + tray.ps1 in ${dir} (port ${port})`)
