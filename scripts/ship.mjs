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
    const child = spawn(command, commandArgs, {
      cwd: project,
      shell: process.platform === "win32",
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
╚══════════════════════════════════════════════════════════╝`);

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
const test = await run("测试（vitest）", "npm", ["test"], STEP_TIMEOUT.test);
if (!test.ok) recordFailure("测试", "有测试用例未通过，改动可能破坏已有功能");

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
  process.exit(1);
}

if (checkOnly) {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  ✓ 全部检查通过（--check-only，未发布）                  ║
╚══════════════════════════════════════════════════════════╝
`);
  process.exit(0);
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
     npx tsx scripts/verify-live-deployment.mjs --origin https://inspiration-echo-318255-10-1492602203.sh.run.tcloudbase.com
`);
  process.exit(1);
}

console.log(`
╔══════════════════════════════════════════════════════════╗
║  ✓ 发布完成                                               ║
╚══════════════════════════════════════════════════════════╝

建议再跑一次真实验收，确认线上功能正常：

  npx tsx scripts/verify-live-deployment.mjs --origin https://inspiration-echo-318255-10-1492602203.sh.run.tcloudbase.com

如果验收发现问题，回退到上一个存档点：
  git reset --hard HEAD~1
  npm run ship -- --skip-build
`);
