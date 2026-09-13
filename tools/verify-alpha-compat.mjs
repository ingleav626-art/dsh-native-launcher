// verify-alpha-compat.mjs — 在完全隔离的沙箱里验证本插件对指定 dsh 版本的适配情况。
//
// 用法：node verify-alpha-compat.mjs [dsh版本] [--browser]
//   [dsh版本]  默认 0.1.2-alpha.2
//   --browser  额外打开真实浏览器加载 UI，验证浏览器端通知链路（runner-tick）；
//              验证期间浏览器窗口可以随便看，数据全部在沙箱里。
//
// 原则：
//   1. 沙箱物理隔离：DSH_HOME 和 USERPROFILE 都指向临时目录，E:\dsh 不会被写入。
//   2. 真实环境前后快照对比（会话文件数/字节、关键配置哈希、3080 监听进程），任何变化即 FAIL。
//   3. 所有判定都是机器指标：进程存活、端口监听、HTTP 状态码、PowerShell 官方 Parser 结果、
//      日志行匹配。不依赖人工目测。
//   4. ps1 相关检查直接取真实生成文件的原始字节，不复刻、不手抄。
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync, createReadStream } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import net from "node:net";

const ARGS = process.argv.slice(2);
const DSH_VERSION = ARGS.find((a) => !a.startsWith("--")) ?? "0.1.2-alpha.2";
const BROWSER_MODE = ARGS.includes("--browser");
const REAL_HOME = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? "", ".dsh");
const SBX = process.env.DSH_SANDBOX ?? "D:\\web\\demo\\test\\dsh-sandbox";
const SBX_HOME = join(SBX, "home");
const SBX_USER = join(SBX, "user");
const SBX_PROFILE = join(SBX_HOME, "profiles", "web");
const PORT = 3081;
const RESULTS = [];
const note = (name, ok, evidence, skip = false) => {
  RESULTS.push({ name, ok, evidence, skip });
  console.log(`${skip ? "SKIP" : ok ? "PASS" : "FAIL"}  ${name}${evidence ? "  — " + evidence : ""}`);
};

const hashOf = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else { const s = statSync(p); out.push({ p, size: s.size }); }
  }
  return out;
};
const snapshotReal = () => {
  const files = walk(join(REAL_HOME, "sessions"));
  return {
    sessionCount: files.length,
    sessionBytes: files.reduce((a, f) => a + f.size, 0),
    settingsHash: hashOf(join(REAL_HOME, "settings.yaml")),
    profilePkgHash: hashOf(join(REAL_HOME, "profiles", "web", "package.json")),
    patchHash: hashOf(join(REAL_HOME, "profiles", "web", "cordis.patch.yml")),
    port3080: portPid(3080)
  };
};
function portPid(port) {
  const r = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
  const line = (r.stdout ?? "").split("\n").find((l) => l.includes(`:${port}`) && /LISTENING/i.test(l));
  return line ? line.trim().split(/\s+/).pop() : null;
}
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
const httpCode = (url) => new Promise((resolve) => {
  const req = fetch(url, { redirect: "manual" }).then((r) => resolve(String(r.status))).catch(() => resolve("ERR"));
  setTimeout(() => resolve("TIMEOUT"), 10000);
});
const waitForPort = (port, ms) => new Promise((resolve) => {
  const t0 = Date.now();
  const tick = () => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => {
      s.destroy();
      if (Date.now() - t0 > ms) resolve(false); else setTimeout(tick, 1000);
    });
  };
  tick();
});
const parsePs1 = (file) => {
  const script = `$errs=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}', [ref]$null, [ref]$errs); if ($errs) { $errs | ForEach-Object { 'LINE ' + $_.Extent.StartLineNumber + ': ' + $_.Message } } else { 'PARSE OK' }`;
  return run("powershell", ["-NoProfile", "-Command", script]).stdout.trim();
};

// ── Phase 0: 真实环境快照 ──
console.log(`\n== 验证目标：dsh@${DSH_VERSION} ==\n[0] 真实环境快照`);
const before = snapshotReal();
console.log(`    E:\\dsh 会话文件 ${before.sessionCount} 个 / ${before.sessionBytes} 字节；3080 监听 pid=${before.port3080}`);
if (!before.port3080) console.log("    （真实 dsh 未在运行——不影响验证，但结束时无法对比监听进程）");

// ── Phase 1: 沙箱准备 ──
console.log("[1] 准备沙箱");
const dshBin = join(SBX, "node_modules", ".bin", "dsh.cmd");
if (!existsSync(dshBin)) {
  console.log(`    安装 dsh@${DSH_VERSION} …`);
  mkdirSync(SBX, { recursive: true });
  if (!existsSync(join(SBX, "package.json"))) run("npm.cmd", ["init", "-y"], { cwd: SBX, shell: true });
  const r = run("npm.cmd", ["i", `@deepseek-ai/dsh@${DSH_VERSION}`, "--no-audit", "--no-fund"], { cwd: SBX, shell: true });
  if (!existsSync(dshBin)) { note("沙箱安装 dsh", false, (r.stderr || r.stdout || String(r.error) || "").slice(-300)); printSummary(); process.exit(1); }
}
rmSync(SBX_HOME, { recursive: true, force: true });
rmSync(SBX_USER, { recursive: true, force: true });
mkdirSync(join(SBX_HOME, "sessions"), { recursive: true });
mkdirSync(join(SBX_HOME, "storages"), { recursive: true });
mkdirSync(join(SBX_USER, "Desktop"), { recursive: true });
const settings = readFileSync(join(REAL_HOME, "settings.yaml"), "utf8")
  .replace(/autoOpen: true/g, "autoOpen: false")
  .replace(/port: 3080/g, `port: ${PORT}`);
writeFileSync(join(SBX_HOME, "settings.yaml"), settings);
mkdirSync(join(SBX_HOME, "profiles"), { recursive: true });
const keep = ["package.json", "cordis.yml", "cordis.patch.yml", "pnpm-workspace.yaml", "pnpm-lock.yaml"];
mkdirSync(SBX_PROFILE, { recursive: true });
for (const f of keep) {
  const src = join(REAL_HOME, "profiles", "web", f);
  if (!existsSync(src)) continue;
  let text = readFileSync(src, "utf8");
  if (f === "cordis.patch.yml") text = text.replace(/host: 0\.0\.0\.0/g, "host: 127.0.0.1").replace(/port: 3080/g, `port: ${PORT}`);
  writeFileSync(join(SBX_PROFILE, f), text);
}
// 一个真实旧格式会话，验证新版能读、也不会改写它
const realSessions = walk(join(REAL_HOME, "sessions"));
const donor = realSessions.find((f) => f.p.endsWith("session.jsonl.zstd") && f.size > 10000);
if (donor) {
  const rel = dirname(donor.p).slice(join(REAL_HOME, "sessions").length);
  const dstDir = join(SBX_HOME, "sessions", rel);
  mkdirSync(dstDir, { recursive: true });
  writeFileSync(join(dstDir, "session.jsonl.zstd"), readFileSync(donor.p));
  var donorSize = donor.size;
}
const env = { ...process.env, DSH_HOME: SBX_HOME, USERPROFILE: SBX_USER };
if (!existsSync(join(SBX_PROFILE, "node_modules"))) {
  console.log("    安装 profile 插件依赖 …");
  const r = run("cmd.exe", ["/c", dshBin, "plugin", "--profile", "web", "install"], { cwd: SBX, env });
  if (!existsSync(join(SBX_PROFILE, "node_modules", "dsh-native-launcher"))) {
    note("安装 profile 插件依赖", false, (r.stdout || r.stderr || "").slice(-300)); printSummary(); process.exit(1);
  }
}

// ── Phase 2: 启动 ──
console.log("[2] 启动沙箱 dsh（端口 " + PORT + "）");
const out = [];
const child = spawn("cmd.exe", ["/c", dshBin, "--profile", "web", "--no-open"], { cwd: SBX, env });
child.stdout.on("data", (d) => out.push(d));
child.stderr.on("data", (d) => out.push(d));
const up = await waitForPort(PORT, 120000);
const sandboxLauncherDir = join(SBX_USER, ".dsh-webui-launcher");
const sandboxLog = join(sandboxLauncherDir, "native-launcher.log");
await new Promise((r) => setTimeout(r, 8000)); // 留给插件 apply 完成
const allOut = out.join("");
const sandboxLogText = existsSync(sandboxLog) ? readFileSync(sandboxLog, "utf8") : "";
const bootLog = allOut + "\n" + sandboxLogText;

// ── Phase 3: 检查 ──
console.log("[3] 逐项检查\n");
note("1. 新版 dsh 启动成功（端口监听）", up, up ? `pid=${child.pid}` : "120 秒内端口未监听");
note("2. 本插件加载并完成 apply", bootLog.includes("apply #") && bootLog.includes("notifications: applied") && !bootLog.includes("apply failed"),
  bootLog.includes("apply failed") ? bootLog.split("\n").find((l) => l.includes("apply failed")) ?? "" : "apply # + notifications: applied 均在日志中");
const ps1Path = join(sandboxLauncherDir, "open-webui.ps1");
const parseResult = existsSync(ps1Path) ? parsePs1(ps1Path) : "(文件不存在)";
note("3. 生成的 open-webui.ps1 通过 PowerShell 官方 Parser", parseResult === "PARSE OK", parseResult.split("\n")[0]);
const tokenFile = join(sandboxLauncherDir, "webui-url.txt");
const tokenUrl = existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "";
const tokenCode = tokenUrl ? await httpCode(tokenUrl) : "(未捕获)";
const bareCode = await httpCode(`http://127.0.0.1:${PORT}/`);
note("4. token 捕获且有效（带 token 3xx / 不带 401）",
  tokenCode.startsWith("3") && bareCode === "401", `带token=${tokenCode} 不带=${bareCode} url=${tokenUrl || "(无)"}`);
if (existsSync(ps1Path)) {
  const lines = readFileSync(ps1Path, "utf8").split(/\r?\n/);
  const head = lines.slice(0, 4).filter((l) => !l.startsWith("#"));
  const probe = join(SBX, "ps1-head-test.ps1");
  writeFileSync(probe, head.join("\n") + `\nWrite-Output ("URL=" + $url)\n`);
  const parse2 = parsePs1(probe);
  const exec = run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", probe]);
  const chosen = (exec.stdout.match(/URL=(.*)/) ?? [, ""])[1].trim();
  const expectBare = `http://127.0.0.1:${PORT}`;
  const expectTok = tokenUrl || "";
  const ok = parse2 === "PARSE OK" && (chosen === expectTok || chosen === expectBare) && chosen !== "";
  note("5. ps1 取 URL 逻辑（真实文件字节）", ok, `解析=${parse2.split("\n")[0]} 选择=${chosen}`);
} else note("5. ps1 取 URL 逻辑（真实文件字节）", false, "open-webui.ps1 不存在");
const corruptHits = bootLog.split("\n").filter((l) => /corrupt|Zstandard/.test(l));
note("6. 旧格式会话文件可读且未被改写", corruptHits.length === 0 && donor && existsSync(donor && join(SBX_HOME, "sessions", dirname(donor.p).slice(join(REAL_HOME, "sessions").length), "session.jsonl.zstd"))
  ? statSync(join(SBX_HOME, "sessions", dirname(donor.p).slice(join(REAL_HOME, "sessions").length), "session.jsonl.zstd")).size === donorSize : false,
  corruptHits.length ? corruptHits[0].slice(0, 120) : donor ? `样本 ${donorSize} 字节，零 corrupt 报错，大小未变` : "(未找到样本会话)");

// ── 功能级检查：插件的核心产物与运行行为（不只是"加载成功"）──
const arti = [
  join(SBX_USER, "Desktop", "DSH WebUI.lnk"),
  join(sandboxLauncherDir, "launch.cmd"),
  join(sandboxLauncherDir, "launcher.vbs"),
  join(sandboxLauncherDir, "tray.ps1"),
  join(sandboxLauncherDir, "dsh-webui.ico")
];
const missingArti = arti.filter((p) => !existsSync(p));
note("7. 启动器产物真实生成", missingArti.length === 0, missingArti.length ? "缺 " + missingArti.map((p) => p.split("\\").pop()).join(", ") : "沙箱桌面 .lnk + launch.cmd + launcher.vbs + tray.ps1 + 图标全部生成");
const trayPidFile = join(sandboxLauncherDir, "tray-pid.txt");
const trayPid = existsSync(trayPidFile) ? readFileSync(trayPidFile, "utf8").replace(/^\uFEFF/, "").trim() : "";
const trayProc = trayPid ? run("powershell", ["-NoProfile", "-Command", `if (Get-Process -Id ${trayPid} -ErrorAction SilentlyContinue) { 'True' } else { 'False' }`]).stdout.trim() : "False";
const trayLog = join(sandboxLauncherDir, "tray-exit.log");
const trayStarted = existsSync(trayLog) && readFileSync(trayLog, "utf8").includes("[tray started");
note("8. 托盘进程真实存活", trayProc === "True" && trayStarted, `pid=${trayPid || "(无)"} 进程存活=${trayProc} 托盘启动日志=${trayStarted}`);
const iconCode = await httpCode(`http://127.0.0.1:${PORT}/native-launcher/icon.png`);
note("9. PWA 图标路由可用", iconCode.startsWith("2"), `GET /native-launcher/icon.png → HTTP ${iconCode}`);
if (BROWSER_MODE && tokenUrl) {
  // 浏览器端验证：client.js（通知 runner）只运行在真实浏览器页面里。
  // 打开默认浏览器 → token 鉴权 → UI 加载 → 客户端模块注入 → runner-tick 写回插件日志。
  run("powershell", ["-NoProfile", "-Command", `Start-Process '${tokenUrl.replace(/'/g, "''")}'`]);
  let clientTick = false;
  for (let i = 0; i < 120 && !clientTick; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    clientTick = readFileSync(sandboxLog, "utf8").includes("runner-tick");
  }
  const online = readFileSync(sandboxLog, "utf8").includes("] online:");
  note("10. 浏览器端通知 runner（真实浏览器加载 UI）", online && clientTick,
    clientTick ? "浏览器已连接（close-to-exit online）且 runner-tick 已写回" : `120 秒内未见 runner-tick（浏览器连接=${online}）`);
} else {
  note("10. 浏览器端通知 runner（真实浏览器加载 UI）", true,
    "无头模式跳过：该代码运行在浏览器页面里，无头环境等不到。加 --browser 参数启用（会打开真实浏览器窗口）", true);
}

// ── Phase 4: 收尾 + 真实环境复核 ──
console.log("\n[4] 收尾");
try { if (trayPid) run("taskkill", ["/PID", trayPid, "/T", "/F"]); } catch { }
run("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" | Where-Object { $_.CommandLine -like '*${SBX.replace(/\\/g, "\\\\")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`]);
try { run("taskkill", ["/PID", String(child.pid), "/T", "/F"]); } catch { }
await new Promise((r) => setTimeout(r, 2000));
const after = snapshotReal();
const untouched = before.sessionCount === after.sessionCount && before.sessionBytes === after.sessionBytes
  && before.settingsHash === after.settingsHash && before.profilePkgHash === after.profilePkgHash && before.patchHash === after.patchHash
  && (!before.port3080 || before.port3080 === after.port3080);
note("11. 真实环境零改动", untouched,
  untouched ? `会话 ${after.sessionCount} 文件 / ${after.sessionBytes} 字节、3 个关键文件哈希、3080 监听 pid 全部一致`
    : `有变化！之前=${JSON.stringify(before)} 之后=${JSON.stringify(after)}`);
printSummary();
function printSummary() {
  const judged = RESULTS.filter((r) => !r.skip);
  const skipped = RESULTS.length - judged.length;
  const pass = judged.filter((r) => r.ok).length;
  console.log(`\n结果：${pass}/${judged.length} 通过${skipped ? `（另跳过 ${skipped} 项）` : ""} — ${pass === judged.length ? "插件在该版本上适配验证通过 ✓" : "存在失败项 ✗（见上方 FAIL 证据）"}\n`);
  process.exit(pass === judged.length ? 0 : 1);
}
