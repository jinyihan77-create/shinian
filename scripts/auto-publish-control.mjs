/**
 * 「自动发布.cmd」菜单的实际执行体（中文全部放在这里，不放 .cmd 里）。
 *
 * 为什么不把中文写进批处理：cmd.exe 读 UTF-8 批处理会按字节错位解析中文，
 * 出现「'xx' 不是内部或外部命令」。这个坑项目里踩过一次，已固化约定：
 * .cmd 只做 ASCII 启动器，所有中文由 Node 输出。
 *
 * 菜单里每一项都是日常真的会用到的；危险动作（回退）只允许手动触发。
 */
import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { LOG_FILE, STATE_FILE, formatTime, loadState, projectRoot } from "./publish-state.mjs";

const project = projectRoot;
const TASK_NAME = "拾念-自动发布";

// ── 工具 ─────────────────────────────────────────────────────

function decode(buffer) {
  if (!buffer?.length) return "";
  const isUtf16 = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe;
  try {
    return new TextDecoder(isUtf16 ? "utf-16le" : "gbk").decode(isUtf16 ? buffer.subarray(2) : buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

function schtasks(taskArgs) {
  const result = spawnSync("schtasks", taskArgs, { encoding: "buffer", windowsHide: true });
  return { code: result.status, out: decode(result.stdout).trim(), err: decode(result.stderr).trim() };
}

function taskState() {
  const result = schtasks(["/query", "/tn", TASK_NAME, "/xml"]);
  if (result.code !== 0) return { installed: false, enabled: false };
  return { installed: true, enabled: /<Enabled>true<\/Enabled>/i.test(result.out) };
}

/** 在当前窗口里跑一个脚本并等它结束，输出直接继承（用户能实时看到进度）。 */
function runVisible(scriptArgs) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(project, "scripts", "auto-publish.mjs"), ...scriptArgs], {
      cwd: project,
      stdio: "inherit",
      windowsHide: false,
    });
    child.once("close", code => resolve(code ?? 0));
  });
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

async function pause() {
  await ask("\n按回车键返回菜单…");
}

// ── 菜单项 ───────────────────────────────────────────────────

async function showStatus() {
  const state = await loadState();
  const task = taskState();

  console.log("\n" + "═".repeat(60));
  console.log("  拾念 · 自动发布状态");
  console.log("═".repeat(60) + "\n");

  if (!task.installed) {
    console.log("  ⚠️ 自动发布还没有安装。");
    console.log("     请选菜单里的「安装并开启自动发布」。\n");
    return;
  }

  console.log(`  自动发布：${task.enabled ? "✅ 工作中（每 5 分钟检查一次）" : "⏸️ 已暂停"}`);

  if (state.lastCheckAt) {
    const minutes = Math.floor((Date.now() - Date.parse(state.lastCheckAt)) / 60_000);
    const label = {
      idle: "没有需要发布的东西",
      clean: "没有需要发布的东西",
      "waiting-quiet": "有新改动，正在等你改完",
      publishing: "正在发布中",
      "same-as-failed": "这批改动上次没通过检查（内容没变，暂不重试）",
      cooldown: "上次未成功，正在冷却",
      busy: "当时有别的发布在跑，已跳过",
      disabled: "自动发布是关闭的",
      "invalid-config": "配置不完整",
    }[state.lastCheckResult] || state.lastCheckResult;
    console.log(`  上次检查：${formatTime(state.lastCheckAt)}（${minutes} 分钟前）`);
    console.log(`             检查结果：${label}`);
  } else {
    console.log("  上次检查：还没有记录（任务刚装好，最多 5 分钟后会有第一次）");
  }

  if (state.lastPublishedAt) {
    console.log(`\n  上次成功上线：${formatTime(state.lastPublishedAt)}`);
    if (state.lastOnlineVersion) console.log(`  线上版本号：${state.lastOnlineVersion}`);
  }

  const resultText = {
    success: "✅ 上次发布成功",
    "checks-failed": "⚠️ 上次检查没通过，线上没有被改动",
    "deploy-failed": "⚠️ 上次上传失败，线上没有被改动",
    "health-failed-rolled-back": "🔴 新版本有问题，已自动回退，线上是好的",
    "health-failed-manual": "🔴 新版本有问题，且自动回退没成功，需要处理",
    "invalid-config": "⚠️ 配置不完整，没有发布",
    "lock-busy": "⏳ 当时有别的发布在跑，已跳过",
  }[state.lastAttemptResult];
  if (resultText) {
    console.log(`\n  ${resultText}`);
    if (state.lastAttemptDetail) console.log(`     说明：${state.lastAttemptDetail}`);
  }

  if (state.history?.length) {
    console.log("\n  最近的记录：");
    for (const item of state.history.slice(-5).reverse()) {
      console.log(`     ${formatTime(item.at)}  ${item.summary}`);
    }
  }

  console.log("\n  小提示：改完代码不用管，安静 5 分钟后会自动上线。");
  console.log("          想立刻上线，选菜单里的「立即发布一次」。\n");
}

async function publishNow() {
  console.log("\n正在发布（会先检查类型、构建、跑测试，全程 3~8 分钟）…\n");
  const code = await runVisible(["--force"]);
  console.log(code === 0 ? "\n✅ 发布流程结束（成功会同时更新线上）。" : "\n⚠️ 发布没有完成，请看上面提示的原因。");
  await pause();
}

async function checkOnly() {
  console.log("\n只做检查，不发布（类型 + 构建 + 测试）…\n");
  const child = spawn("npm", ["run", "ship", "--", "--check-only"], {
    cwd: project,
    stdio: "inherit",
    shell: true,
    windowsHide: false,
  });
  await new Promise(resolve => child.once("close", resolve));
  await pause();
}

async function probeSite() {
  await runVisible(["--probe"]);
  await pause();
}

async function toggle() {
  const task = taskState();
  if (!task.installed) {
    console.log("\n自动发布还没安装，请先选「安装并开启自动发布」。\n");
    await pause();
    return;
  }
  const action = task.enabled ? "/disable" : "/enable";
  const result = schtasks(["/change", "/tn", TASK_NAME, action]);
  if (result.code === 0) {
    console.log(task.enabled
      ? "\n⏸️ 已暂停自动发布。代码和线上都保持原样，你随时可以再开启。\n"
      : "\n▶️ 已重新开启自动发布。\n");
  } else {
    console.log(`\n操作失败：${result.err || result.out}\n`);
  }
  await pause();
}

async function installOrRepair() {
  const task = taskState();
  console.log(task.installed ? "\n正在重新安装（修复）…\n" : "\n正在安装自动发布…\n");
  const child = spawn(process.execPath, [path.join(project, "scripts", "auto-publish-install.mjs"), "install"], {
    cwd: project,
    stdio: "inherit",
    windowsHide: false,
  });
  await new Promise(resolve => child.once("close", resolve));
  await pause();
}

async function uninstall() {
  const answer = await ask("\n这会卸载自动发布（只删计划任务，不动代码和线上）。确定吗？(y/N) ");
  if (answer.toLowerCase() !== "y") { console.log("已取消。\n"); await pause(); return; }
  const child = spawn(process.execPath, [path.join(project, "scripts", "auto-publish-install.mjs"), "uninstall"], {
    cwd: project,
    stdio: "inherit",
    windowsHide: false,
  });
  await new Promise(resolve => child.once("close", resolve));
  await pause();
}

async function showLog() {
  const lines = await readFile(LOG_FILE, "utf8").catch(() => "");
  console.log("\n" + "═".repeat(60));
  console.log("  自动发布日志（最近 40 行）");
  console.log("═".repeat(60) + "\n");
  if (!lines.trim()) {
    console.log("  还没有日志。安装后最多 5 分钟就会有记录。\n");
  } else {
    for (const line of lines.trim().split("\n").slice(-40)) console.log("  " + line);
    console.log("");
  }
  console.log(`  （完整文件：${path.relative(project, LOG_FILE)}）`);
  console.log(`  （台账文件：${path.relative(project, STATE_FILE)}）\n`);
  await pause();
}

async function rollback() {
  const state = await loadState();
  console.log("\n回退会把线上切回上一个版本。");
  console.log("只在「线上真的坏了、但自动回退没生效」时才需要用它。\n");
  const target = await ask("请输入要回退到的版本名（例如 inspiration-echo-006），直接回车取消：");
  if (!target) { console.log("已取消。\n"); await pause(); return; }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(target)) { console.log("版本名格式看起来不对，已取消。\n"); await pause(); return; }
  await runVisible(["--rollback-to", target]);
  await pause();
}

// ── 菜单循环 ─────────────────────────────────────────────────

const MENU = `
════════════════════════════════════════════════════════════
  拾念 · 自动发布
════════════════════════════════════════════════════════════

  1  查看当前状态          （线上是不是最新、上次检查什么情况）
  2  立即发布一次          （不想等 5 分钟就用这个）
  3  只检查、不发布        （想确认代码 OK 又不想动线上）
  4  检查线上网站是否正常
  5  暂停 / 重新开启自动发布
  6  安装 / 修复自动发布
  7  查看自动发布日志
  8  回退线上到指定版本    （线上坏了才用）
  9  卸载自动发布
  0  退出

`;

async function main() {
  const once = process.argv[2];
  if (once === "--status") return void await showStatus();

  for (;;) {
    process.stdout.write(MENU);
    const choice = await ask("请输入数字后回车：");
    switch (choice) {
      case "1": await showStatus(); await pause(); break;
      case "2": await publishNow(); break;
      case "3": await checkOnly(); break;
      case "4": await probeSite(); break;
      case "5": await toggle(); break;
      case "6": await installOrRepair(); break;
      case "7": await showLog(); break;
      case "8": await rollback(); break;
      case "9": await uninstall(); break;
      case "0": case "": console.log("\n再见。\n"); return;
      default: console.log("\n请输入 0 到 9 之间的数字。\n");
    }
  }
}

await main();
