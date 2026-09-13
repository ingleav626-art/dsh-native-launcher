/**
 * 重生成真机启动脚本（开发/调试用）：按当前 lib/ 产物重写 launcherDir 下的
 * launch.cmd / launch.ps1 / launch-ready.ps1 / launcher.vbs / launcher-visible.vbs /
 * open-webui.ps1——用于不重启 dsh 就刷新启动链（改模板后立即真机验证）。
 * 跑法：node tools/regen-launcher.mjs [launcherDir] [port]
 */
import { writeLauncherFiles } from '../lib/host/scripts.js'
import { join } from 'node:path'

const dir = process.argv[2] || join(process.env.USERPROFILE ?? '', '.dsh-webui-launcher')
const port = Number(process.argv[3]) || 3080
writeLauncherFiles(dir, 'dsh --profile web --no-open', port, join(dir, 'tray.ps1'), join(dir, 'open-webui.ps1'))
console.log(`regenerated launcher scripts in: ${dir} (port ${port})`)
