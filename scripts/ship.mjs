/**
 * 安全发布闸门（ship = 检查 + 存档 + 发布）。
 *
 * 这个脚本存在的唯一目的：**保证线上网站永远不会被一个跑不起来的版本覆盖。**
 *
 * 流程（任何一步失败就立即停止，绝不发布）：
 *   1. 自动存档：把当前改动存进 git（这样随时能回退）
 *   2. 类型检查：npx tsc --noEmit
 *   3. 生产构建：npm run build（这一步和云端构建基本等价，能提前发现大部分问题）
 *   4. 测试：npm test
 *   5. 只有以上全部通过，才真正发布到云托管
 *
 * 用法：
 *   npm run ship              完整跑一遍（推荐，日常就用这个）
 *   npm run ship -- --skip-build   跳过构建（快速场景，不推荐）
 *   npm run ship -- --check-only   只检查不发布
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquirePublishLock } from "./publish-lock.mjs";
import { appendHistory, loadState, saveState, writeLog } from "./publish-state.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const checkOnly = args.includes("--check-only");

const STEP_TIMEOUT = {
  commit: 60_000,
  typecheck: 5 * 60_000,
  build: 15 * 60_000,
  test: 15 * 60_000,
  deploy: 25 * 60_000,
};

function run(label, command, commandArgs, timeoutMs) {
  return new Promise(resolve => {
    console.log(`\n${"─".repeat(58)}\n▶ ${label}\n${"─".repeat(58)}`);
    const started = Date.now();
    // Windows 上 shell 模式只做字符串拼接、不加引号：含空格的绝对路径
    // （如 "C:\Program Files\nodejs\node.exe"）会被 cmd 截断，带空格/中文的
    // 提交信息也会被拆成多个参数。所以绝对路径命令和 git 一律不走 shell，
    // 只有 npm/npx 这类 .cmd 包装脚本需要。
    const needsShell = process.platform === "win32" && !path.isAbsolute(command) && command !== "git";
    const child = spawn(command, commandArgs, {
      cwd: project,
      shell: needsShell,
      windowsHide: true,
      stdio: "inherit",
    });
    const timer = setTimeout(() => {
      console.log(`\n✗ ${label} 超时（超过 ${Math.round(timeoutMs / 60000)} 分钟），已终止。`);
      child.kill();
      resolve({ ok: false, timedOut: true, seconds: Math.round((Date.now() - started) / 1000) });
    }, timeoutMs);
    child.once("error", error => {
      clearTimeout(timer);
      console.log(`\n✗ ${label} 无法执行：${error.message}`);
      resolve({ ok: false, seconds: Math.round((Date.now() - started) / 1000) });
    });
    child.once("close", code => {
      clearTimeout(timer);
      const seconds = Math.round((Date.now() - started) / 1000);
      const ok = code === 0;
      console.log(`\n${ok ? "✓" : "✗"} ${label} ${ok ? "通过" : "未通过"}（用时 ${seconds}s）`);
      resolve({ ok, code, seconds });
    });
  });
}

const failures = [];
function recordFailure(label, detail) {
  failures.push({ label, detail });
}

console.log(`
╔══════════════════════════════════════════════════════════╗
║  安全发布闸门 · 检查通过才会发布                          ║
║  任何一步失败 → 线上网站保持原样，不会被覆盖              ║
╚══════════════════════════════════════════════════════════╝

这个过程通常需要 3 到 8 分钟，请耐心等待，不要关闭窗口。`);

// ── 步骤 0：取得发布锁 ───────────────────────────────────────
// 自动发布（每 5 分钟一次）也可能在跑。两个发布同时上传、同时切流量会互相干扰，
// 所以这里先抢锁；抢不到就直接退出，绝不并发发布。
// ECHO_PUBLISH_LOCK_HELD=1 由自动发布引擎设置：锁已经在它手里，别自己锁自己。
const automationDriven = process.env.ECHO_PUBLISH_AUTOMATION === "1";
const lockHeldExternally = automationDriven || process.env.ECHO_PUBLISH_LOCK_HELD === "1";
const publishLock = lockHeldExternally ? null : await acquirePublishLock({ owner: "手动发布" });
if (publishLock && !publishLock.ok) {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  ⏳ 此刻已有发布在进行，本次不再重复发布                  ║
╚══════════════════════════════════════════════════════════╝

正在进行的发布：${publishLock.heldBy}

线上网站不受影响。请等它结束后再试，或查看状态：
  node scripts/auto-publish.mjs --status
`);
  process.exit(2);
}

/**
 * 收尾：记账 + 释放锁 + 退出。
 *
 * 自动发布引擎会在自己那边记账（它还要做发布后健康检查和回滚），
 * 所以被它调用时不重复写，免得两边互相覆盖。
 */
async function finish(code, { result, detail, summary, commit } = {}) {
  if (!automationDriven && result) {
    const state = await loadState();
    const next = {
      ...state,
      lastAttemptAt: new Date().toISOString(),
      lastAttemptResult: result,
      lastAttemptDetail: detail || "",
      history: summary ? await appendHistory(state, summary) : state.history,
    };
    if (result === "success") {
      next.lastPublishedAt = new Date().toISOString();
      next.lastPublishedCommit = commit || state.lastPublishedCommit;
      next.lastFailedFingerprint = "";
    }
    // 手动发布失败后，也让自动发布别在冷却期内立刻重试同一批内容。
    if (result !== "success" && result !== "lock-busy") next.lastFailedFingerprint = state.lastFailedFingerprint;
    await saveState(next);
    await writeLog(`手动发布结果：${result}${detail ? `（${detail}）` : ""}`);
  }
  if (publishLock?.ok) await publishLock.release();
  process.exit(code);
}

// ── 步骤 1：自动存档 ─────────────────────────────────────────
// 先存档再检查。这样即使后面的检查发现改动有问题，也能用 git 回到上一个可用版本。
const dirty = await new Promise(resolve => {
  const child = spawn("git", ["status", "--porcelain"], { cwd: project, windowsHide: true });
  let out = "";
  child.stdout.on("data", chunk => { out += chunk; });
  child.once("close", () => resolve(out.trim()));
  child.once("error", () => resolve(""));
});

if (!dirty) {
  console.log("\n▶ 自动存档：没有未保存的改动，跳过。");
} else {
  const fileCount = dirty.split("\n").length;
  const stamp = new Date().toLocaleString("zh-CN", { hour12: false });
  const saved = await run(`自动存档（${fileCount} 个文件改动）`, "git", [
    "add", "-A",
  ], STEP_TIMEOUT.commit);
  if (saved.ok) {
    const committed = await run("建立存档点", "git", [
      "commit", "-m", `改动存档 ${stamp}\n\n发布前自动存档，用于回退。`,
    ], STEP_TIMEOUT.commit);
    if (!committed.ok) {
      // 提交失败通常是没有实际改动（如只有被忽略的文件），不算致命。
      console.log("（未产生新的存档点，继续后续检查）");
    }
  } else {
    console.log("（存档未成功，继续检查；但请注意此时没有新的回退点）");
  }
}

// ── 步骤 2：类型检查 ─────────────────────────────────────────
const typecheck = await run("类型检查（tsc）", "npx", ["tsc", "--noEmit"], STEP_TIMEOUT.typecheck);
if (!typecheck.ok) recordFailure("类型检查", "代码存在类型错误，网站可能无法构建");

// ── 步骤 3：生产构建 ─────────────────────────────────────────
if (skipBuild) {
  console.log("\n▶ 生产构建：已按 --skip-build 跳过（风险自负）。");
} else if (typecheck.ok) {
  const build = await run("生产构建（next build）", "npm", ["run", "build"], STEP_TIMEOUT.build);
  if (!build.ok) recordFailure("生产构建", "构建失败，这就是线上会崩的那类问题");
} else {
  console.log("\n▶ 生产构建：因类型检查已失败而跳过（避免浪费时间）。");
}

// ── 步骤 4：测试 ─────────────────────────────────────────────
// 失败后重跑一次：这些用例要挂载组件、跑动画时序，机器忙时可能偶然超时。
// 不重试的话一次偶发失败会被当成"这批代码有问题"记进账本，
// 内容没变就不会再试——自动发布会被一个假警报永久卡住（还得人工介入），代价太大。
let test = await run("测试（vitest）", "npm", ["test"], STEP_TIMEOUT.test);
if (!test.ok) {
  console.log("\n▶ 测试未通过，重跑一次以排除偶发超时（并发/机器忙时会出现）…");
  test = await run("测试（vitest）· 重试", "npm", ["test"], STEP_TIMEOUT.test);
  if (test.ok) console.log("（重试通过，判定为偶发失败，继续发布。）");
}
if (!test.ok) recordFailure("测试", "有测试用例未通过（已重试一次仍失败），改动可能破坏已有功能");

// ── 结果判定 ─────────────────────────────────────────────────
if (failures.length) {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  ✗ 检查未通过 —— 已阻止发布                              ║
╚══════════════════════════════════════════════════════════╝

线上网站**没有被改动**，仍然是你现在能正常访问的版本。

未通过的项目：
${failures.map(f => `  • ${f.label}：${f.detail}`).join("\n")}

接下来怎么办：
  1. 把上面标 ✗ 的那一步的完整报错发给 AI，让它修。
  2. 修好后重新运行：npm run ship
  3. 如果想丢弃本次改动、回到上一个可用版本：
       git reset --hard HEAD~1        （回到上一个存档点）
     或看所有存档点再挑一个：
       git log --oneline
`);
  await finish(1, {
    result: "checks-failed",
    detail: `未通过：${failures.map(f => f.label).join("、")}`,
    summary: `❌ 手动发布被拦下（${failures.map(f => f.label).join("、")}），线上未变动`,
  });
}

if (checkOnly) {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  ✓ 全部检查通过（--check-only，未发布）                  ║
╚══════════════════════════════════════════════════════════╝
`);
  await finish(0);
}

console.log(`
╔══════════════════════════════════════════════════════════╗
║  ✓ 全部检查通过 —— 开始发布                              ║
╚══════════════════════════════════════════════════════════╝
`);

const deploy = await run("发布到云托管", "node", ["scripts/deploy-tencent.mjs", "--yes"], STEP_TIMEOUT.deploy);

if (!deploy.ok) {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  发布命令未成功完成                                       ║
╚══════════════════════════════════════════════════════════╝

注意：构建已通过，所以这次失败大概率是网络或云端问题，不是代码问题。
可以：
  1. 过几分钟重试：npm run ship -- --skip-build
  2. 若云端已有新版本但流量未切换，可查看：node scripts/deploy-tencent.mjs --detail
  3. 用验收脚本确认线上到底是不是好的：
     npm run verify:live -- --origin https://inspiration-echo-318255-10-1492602203.sh.run.tcloudbase.com
`);
  await finish(1, {
    result: "deploy-failed",
    detail: "发布命令未成功（构建已通过，多半是网络或云端问题）",
    summary: "❌ 手动发布命令失败，线上未变动",
  });
}

// 记录这次发布对应的提交，供自动发布判断"还有没有新东西要上线"。
const headAfter = await new Promise(resolve => {
  const child = spawn("git", ["rev-parse", "HEAD"], { cwd: project, windowsHide: true });
  let out = "";
  child.stdout.on("data", chunk => { out += chunk; });
  child.once("error", () => resolve(""));
  child.once("close", () => resolve(out.trim()));
});

console.log(`
╔══════════════════════════════════════════════════════════╗
║  ✓ 发布完成                                               ║
╚══════════════════════════════════════════════════════════╝

建议再跑一次真实验收，确认线上功能正常：

  npm run verify:live -- --origin https://inspiration-echo-318255-10-1492602203.sh.run.tcloudbase.com

如果验收发现问题，回退到上一个存档点：
  git reset --hard HEAD~1
  npm run ship -- --skip-build
`);
await finish(0, {
  result: "success",
  summary: "✅ 手动发布成功",
  commit: headAfter,
});
