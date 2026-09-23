/**
 * 夜间监工 · 安装（把巡检挂成 Windows 计划任务）
 *
 * 每 2 小时唤醒一次，真实登录线上站截图 + 检测几何问题，
 * 结果写入 test-results/night-watch/auto-report.md。
 *
 * 与「拾念-自动发布」的区别：本任务**只读**，绝不发布、不改线上、不改源码。
 *
 * 用法：
 *   node scripts/night-watch-install.mjs install    安装并启用
 *   node scripts/night-watch-install.mjs uninstall  卸载
 *   node scripts/night-watch-install.mjs status     查看状态
 */

import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TASK_NAME = "拾念-夜间监工";
const INTERVAL_HOURS = 2;
const project = process.cwd();
const LOG_DIR = path.join(project, "test-results", "night-watch");

/** schtasks 输出在中文 Windows 上是 GBK，必须按 buffer 读再转。 */
function schtasks(args) {
  const result = spawnSync("schtasks", args, { encoding: "buffer", windowsHide: true });
  const decode = (buf) => {
    if (!buf) return "";
    try { return new TextDecoder("gbk").decode(buf); } catch { return buf.toString("utf8"); }
  };
  return {
    code: result.status ?? 1,
    out: decode(result.stdout),
    err: decode(result.stderr),
  };
}

function currentUserSid() {
  const result = spawnSync("powershell", [
    "-NoProfile", "-Command",
    `([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value`,
  ], { encoding: "utf8", windowsHide: true });
  const sid = (result.stdout || "").trim();
  return /^S-\d-\d+-/.test(sid) ? sid : null;
}

function queryTask() {
  const result = schtasks(["/query", "/tn", TASK_NAME, "/xml"]);
  if (result.code !== 0) return { installed: false };
  return {
    installed: true,
    enabled: !/Enabled>false/i.test(result.out),
    batterySafe: /DisallowStartIfOnBatteries>false/i.test(result.out),
  };
}

/**
 * 写出启动器（.cmd）。
 *
 * 为什么不用 .vbs：中文路径 + 引号拼接在 VBScript 里极易触发
 * 「未结束的字符串常量」（实测已踩到），而且 .vbs 里 sh.Run 不经过 cmd.exe，
 * 重定向 `>>` 不生效。改用 .cmd 最直接，计划任务以隐藏窗口方式调它即可。
 *
 * 编码注意：cmd.exe 在中文 Windows 上按 GBK 解析批处理文件，
 * 所以这个 .cmd 必须是纯 ASCII 内容，路径里的中文靠 Node 侧传入，
 * 不能把中文写死在批处理里（见项目里的 windows-cmd-utf8-launcher-bug）。
 */
async function writeLauncher() {
  await mkdir(LOG_DIR, { recursive: true });
  // 启动器放在项目根（纯 ASCII 路径的替代方案：用相对路径调用，避免中文绝对路径进批处理）
  const launcher = path.join(project, "夜间监工.cmd");
  const cmd = [
    "@echo off",
    "chcp 65001 >nul 2>&1",
    "cd /d \"%~dp0\"",
    "node \"scripts\\night-watch-auto.mjs\" >> \"test-results\\night-watch\\auto-log.txt\" 2>&1",
    "exit /b %errorlevel%",
  ].join("\r\n");
  await writeFile(launcher, cmd + "\r\n", "ascii");
  return launcher;
}

function taskXml(sid, launcherPath) {
  const startBoundary = new Date().toISOString().slice(0, 10) + "T00:00:00";
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>拾念：每 ${INTERVAL_HOURS} 小时真实登录线上站截图巡检（只读，不发布不改代码）。</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT${INTERVAL_HOURS}H</Interval>
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
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>cmd.exe</Command>
      <Arguments>/c "${launcherPath}"</Arguments>
      <WorkingDirectory>${project}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

async function install() {
  console.log("\n正在安装夜间监工…\n");

  const launcher = await writeLauncher();
  console.log(`  1/3 已生成隐藏启动器：${path.relative(project, launcher)}`);

  const sid = currentUserSid();
  if (!sid) {
    console.error("  ✗ 无法取得当前用户标识，安装中止。");
    process.exitCode = 1;
    return;
  }

  const xmlPath = path.join(LOG_DIR, "night-watch-task.xml");
  await writeFile(xmlPath, Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(taskXml(sid, launcher), "utf16le"),
  ]));
  console.log("  2/3 已生成任务定义（已关闭「电池时停用」，拔电源也会继续）。");

  schtasks(["/delete", "/tn", TASK_NAME, "/f"]);
  const created = schtasks(["/create", "/tn", TASK_NAME, "/xml", xmlPath, "/f"]);
  if (created.code !== 0) {
    console.error(`\n  ✗ 计划任务创建失败：${created.err || created.out}`);
    console.error("\n  （如果提示权限不足，请用管理员身份运行一次。）\n");
    process.exitCode = 1;
    return;
  }

  const state = queryTask();
  schtasks(["/change", "/tn", TASK_NAME, "/enable"]);
  console.log(`  3/3 已注册并启用：每 ${INTERVAL_HOURS} 小时跑一次。`);

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  ✓ 夜间监工已装好                                        ║
╚══════════════════════════════════════════════════════════╝

从现在起，只要电脑开着：
  · 每 ${INTERVAL_HOURS} 小时自动登录线上站 → 手机端 + 桌面端截图 → 检测布局问题
  · 结果写到：test-results/night-watch/auto-report.md
  · 截图存档：test-results/night-watch/archive/
  · 只在问题"新增"或"已修复"时才有变化，不会每晚重复念同一份清单

它只读，绝不发布、不改线上、不改代码。
想立刻跑一次：node scripts/night-watch-auto.mjs
`);
}

function uninstall() {
  const result = schtasks(["/delete", "/tn", TASK_NAME, "/f"]);
  if (result.code === 0) console.log(`\n✓ 已卸载「${TASK_NAME}」。\n`);
  else console.log(`\n（任务不存在或已卸载）\n`);
}

function status() {
  const state = queryTask();
  if (!state.installed) {
    console.log(`\n「${TASK_NAME}」尚未安装。\n`);
    return;
  }
  console.log(`\n「${TASK_NAME}」`);
  console.log(`  已启用：${state.enabled ? "是" : "否"}`);
  console.log(`  不受电池影响：${state.batterySafe ? "是" : "否"}`);
  console.log(`  间隔：每 ${INTERVAL_HOURS} 小时`);
  console.log(`  报告：test-results/night-watch/auto-report.md\n`);
}

const command = process.argv[2] || "status";
if (command === "install") await install();
else if (command === "uninstall") uninstall();
else status();
