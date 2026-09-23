/**
 * 自动发布的"接线员"：把 Windows 计划任务装好/拆掉，或手动立即跑一次。
 *
 * 为什么用 VBS + 计划任务，而不是常驻进程：
 *   - 计划任务由 Windows 自己调度，电脑重启后自动恢复，不需要任何后台程序常驻。
 *   - VBS 包一层是为了**不弹黑窗口**。直接让计划任务调 node.exe，每 5 分钟会闪一个
 *     控制台窗口出来，很烦人。VBS 以隐藏模式（窗口模式 0）启动 node，界面完全无感。
 *   - VBS 必须写成 UTF-16LE（带 BOM），否则 WSH 按本地 ANSI 解析，中文路径会乱掉——这点已实测确认。
 *
 * 用法：
 *   node scripts/auto-publish-install.mjs install     安装（幂等，重复执行安全）
 *   node scripts/auto-publish-install.mjs uninstall   卸载（只删计划任务，不动代码与线上）
 *   node scripts/auto-publish-install.mjs run         立即执行一次（可见输出，用于人工确认）
 *   node scripts/auto-publish-install.mjs status      查看计划任务状态
 *   node scripts/auto-publish-install.mjs probe       线上健康检查
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { STATE_DIR, projectRoot } from "./publish-state.mjs";

const project = projectRoot;
const TASK_NAME = "拾念-自动发布";
const LAUNCHER_VBS = path.join(STATE_DIR, "auto-publish-launcher.vbs");
const INTERVAL_MINUTES = 5;

const command = (process.argv[2] || "").toLowerCase();

// ── 工具 ─────────────────────────────────────────────────────

/**
 * 调 schtasks 并正确解码输出。
 *
 * Windows 中文版 schtasks 输出是 GBK（有时是 UTF-16LE），直接当 UTF-8 读会全是乱码。
 * 这里按 BOM 判断编码，没有 BOM 就按 GBK 解。
 */
function schtasks(taskArgs) {
  const result = spawnSync("schtasks", taskArgs, { encoding: "buffer", windowsHide: true });
  const decode = buffer => {
    if (!buffer?.length) return "";
    const isUtf16 = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe;
    try {
      return new TextDecoder(isUtf16 ? "utf-16le" : "gbk").decode(isUtf16 ? buffer.subarray(2) : buffer);
    } catch {
      return buffer.toString("utf8");
    }
  };
  return {
    code: result.status,
    out: decode(result.stdout).trim(),
    err: decode(result.stderr).trim(),
  };
}

function nodePath() {
  return process.execPath;
}

/** 生成 VBS：隐藏窗口启动自动发布引擎一次，然后立刻退出（不常驻）。 */
async function writeLauncher() {
  await mkdir(STATE_DIR, { recursive: true });
  const logDir = STATE_DIR.replace(/\\/g, "\\");
  const body = [
    "' 自动生成：隐藏窗口运行一次自动发布检查。不要手改，改安装脚本或重新 install。",
    "Option Explicit",
    "Dim sh, cmd",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = "${project}"`,
    // 窗口模式 0 = 隐藏；第三个参数 False = 不等它结束，立即释放。
    `cmd = """" & "${nodePath().replace(/\\/g, "\\")}" & """ """ & "${path.join(project, "scripts", "auto-publish.mjs").replace(/\\/g, "\\")}" & """ --task"`,
    "sh.Run cmd, 0, False",
    "",
  ].join("\r\n");
  // 必须 UTF-16LE + BOM，WSH 才能正确解析含中文的路径。
  await writeFile(LAUNCHER_VBS, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, "utf16le")]));
  return { launcher: LAUNCHER_VBS, logDir };
}

function queryTask() {
  const result = schtasks(["/query", "/tn", TASK_NAME, "/xml"]);
  if (result.code !== 0) return { installed: false };
  const enabled = /<Enabled>true<\/Enabled>/i.test(result.out);
  const interval = result.out.match(/<Interval>PT(\d+)M<\/Interval>/i)?.[1] ?? "";
  const batterySafe = /<DisallowStartIfOnBatteries>false<\/DisallowStartIfOnBatteries>/i.test(result.out);
  return { installed: true, enabled, interval, batterySafe };
}

/** 取当前用户的 SID，任务定义里要用它来绑定"以本用户身份运行"。 */
function currentUserSid() {
  const result = spawnSync("C:\\Windows\\System32\\whoami.exe", ["/user"], { encoding: "utf8", windowsHide: true });
  return (result.stdout || "").match(/S-1-5-[\d-]+/)?.[0] ?? "";
}

/**
 * 写出计划任务的 XML 定义。
 *
 * 为什么不用 `schtasks /create` 的命令行参数：命令行方式没法关掉
 * 「使用电池时不起作用」(DisallowStartIfOnBatteries)。这台是笔记本，
 * 一旦拔掉电源，自动发布就会静默停摆，而且没有任何提示——很难发现。
 * XML 方式可以显式设为 false，还顺带把多实例策略定死为 IgnoreNew（防止任务叠加）。
 */
function taskXml(sid, launcherPath) {
  const startBoundary = new Date().toISOString().slice(0, 10) + "T00:00:00";
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>拾念：每 5 分钟检查代码改动，走安全闸门自动发布到腾讯云。由 npm run auto:publish:install 创建。</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT${INTERVAL_MINUTES}M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>${startBoundary}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${sid}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>//nologo //B "${launcherPath}"</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

// ── 子命令 ───────────────────────────────────────────────────

async function install() {
  console.log("\n正在安装自动发布…\n");

  const launcher = await writeLauncher();
  console.log(`  1/4 已生成隐藏启动器：${path.relative(project, launcher.launcher)}`);

  const sid = currentUserSid();
  if (!sid) {
    console.error("  ✗ 无法取得当前用户标识，安装中止。");
    process.exitCode = 1;
    return;
  }

  const xmlPath = path.join(STATE_DIR, "task-definition.xml");
  await writeFile(xmlPath, Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(taskXml(sid, launcher.launcher), "utf16le"),
  ]));
  console.log(`  2/4 已生成任务定义（已关闭"电池时停用"，笔记本拔电源也会继续工作）。`);

  // 先删旧的，保证重复安装不会出现两个任务。
  schtasks(["/delete", "/tn", TASK_NAME, "/f"]);

  const created = schtasks(["/create", "/tn", TASK_NAME, "/xml", xmlPath, "/f"]);
  if (created.code !== 0) {
    console.error(`\n  ✗ 计划任务创建失败：${created.err || created.out}`);
    console.error("\n  （如果提示权限不足，请用管理员身份运行一次安装命令。）\n");
    process.exitCode = 1;
    return;
  }
  console.log(`  3/4 已注册计划任务「${TASK_NAME}」，每 ${INTERVAL_MINUTES} 分钟检查一次。`);

  const state = queryTask();
  if (!state.installed) {
    console.error("  ✗ 任务注册后查询不到，请手动确认。");
    process.exitCode = 1;
    return;
  }
  schtasks(["/change", "/tn", TASK_NAME, "/enable"]);
  console.log(`  4/4 已启用：${state.enabled ? "是" : "状态待确认"}${state.batterySafe ? "，且不受电池状态影响" : ""}`);

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  ✓ 自动发布已装好                                        ║
╚══════════════════════════════════════════════════════════╝

从现在起：
  · 你改完代码，安静 5 分钟后会自动走检查 → 发布 → 健康检查。
  · 检查不通过（类型错误 / 构建失败 / 测试不过）→ 线上完全不动。
  · 新版本上线后如果打不开 → 自动回滚到上一个好版本。
  · 全程在后台，不弹窗口，不需要你点任何东西。

想立刻看到效果，不用等：双击「自动发布.cmd」选"立即发布一次"。
查看状态：
  node scripts/auto-publish.mjs --status
`);
}

function uninstall() {
  const result = schtasks(["/delete", "/tn", TASK_NAME, "/f"]);
  if (result.code === 0) {
    console.log(`\n✓ 已卸载「${TASK_NAME}」。代码和线上网站都没有被改动。\n`);
  } else {
    console.log(`\n计划任务不存在或已删除（${result.err || result.out}）。\n`);
  }
}

function status() {
  const state = queryTask();
  if (!state.installed) {
    console.log("\n自动发布：未安装。\n安装：node scripts/auto-publish-install.mjs install\n");
    return;
  }
  console.log("\n自动发布：已安装");
  console.log(`  计划任务：${TASK_NAME}`);
  console.log(`  检查频率：每 ${state.interval || INTERVAL_MINUTES} 分钟`);
  console.log(`  是否启用：${state.enabled ? "已启用" : "已停用（不会自动发布）"}`);
  console.log(`  隐藏启动器：${path.relative(project, LAUNCHER_VBS)}\n`);
}

/** 立即执行一次，输出直接打到当前终端，方便人工确认。 */
function runNow() {
  console.log("\n立即执行一次自动发布检查（有输出，方便确认）…\n");
  const child = spawn(nodePath(), [path.join(project, "scripts", "auto-publish.mjs"), "--force"], {
    cwd: project,
    stdio: "inherit",
    windowsHide: false,
  });
  child.once("close", code => {
    console.log(code === 0 ? "\n完成。\n" : `\n完成，退出码 ${code}（可能有检查未通过，详见上面输出）。\n`);
    process.exitCode = code ?? 0;
  });
}

async function probe() {
  const child = spawn(nodePath(), [path.join(project, "scripts", "auto-publish.mjs"), "--probe"], {
    cwd: project,
    stdio: "inherit",
    windowsHide: false,
  });
  child.once("close", code => { process.exitCode = code ?? 0; });
}

switch (command) {
  case "install": await install(); break;
  case "uninstall": uninstall(); break;
  case "status": status(); break;
  case "run": runNow(); break;
  case "probe": await probe(); break;
  default:
    console.log(`
自动发布安装器

用法：
  node scripts/auto-publish-install.mjs install     安装并启用（推荐）
  node scripts/auto-publish-install.mjs uninstall   卸载
  node scripts/auto-publish-install.mjs status      查看状态
  node scripts/auto-publish-install.mjs run         立即执行一次
  node scripts/auto-publish-install.mjs probe       线上健康检查
`);
}
