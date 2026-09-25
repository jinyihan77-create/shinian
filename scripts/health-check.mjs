/**
 * 「自检」双击入口的实际执行体。
 *
 * 为什么不把中文写在 .cmd 里：Windows 的 cmd.exe 读取 UTF-8 批处理文件时
 * 会按字节错位解析，中文字符串会被当成命令名，出现「'xx' 不是内部或外部命令」。
 * 把中文全部放在 Node 里输出，就绕开了这个坑。
 *
 * 这个脚本只读：不修改任何文件，不发布，不碰线上。
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envText = await readFile(path.join(project, ".env.local"), "utf8").catch(() => "");
const originMatch = envText.match(/^\s*APP_ORIGIN\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/m);
const ORIGIN = (originMatch?.[1] || originMatch?.[2] || originMatch?.[3] || "").replace(/\/+$/, "");
if (!ORIGIN) throw new Error("缺少 APP_ORIGIN：请在 .env.local 中配置本地地址。");
const line = "─".repeat(58);
const heavy = "=".repeat(58);

function banner(title) {
  console.log(`\n${heavy}\n  ${title}\n${heavy}`);
}

function step(n, total, title) {
  console.log(`\n${line}\n  第 ${n} 步 / ${total}：${title}\n${line}\n`);
}

function run(command, args, timeoutMs = 10 * 60_000) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: project,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", c => { out += c; });
    child.stderr.on("data", c => { out += c; });
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, out, timedOut: true }); }, timeoutMs);
    child.once("error", e => { clearTimeout(timer); resolve({ ok: false, out: out + "\n" + e.message }); });
    child.once("close", code => { clearTimeout(timer); resolve({ ok: code === 0, out }); });
  });
}

banner("拾念 · 项目自检（只检查，不改动，不发布）");
console.log(`\n  这个检查不会修改任何文件，也不会动线上网站。`);
console.log(`  线上永远是安全的。`);

const problems = [];
const summary = [];

// ── 1. 线上可用性 ────────────────────────────────────────────
step(1, 4, "检查线上网站是否正常");
let liveCode = "无法连接";
try {
  const response = await fetch(ORIGIN, { method: "GET", signal: AbortSignal.timeout(20_000) });
  liveCode = String(response.status);
} catch (error) {
  liveCode = `连接失败（${error instanceof Error ? error.message : "未知原因"}）`;
}
if (liveCode === "200") {
  console.log(`  ✓ 线上返回 200，网站正常可访问。`);
  summary.push(["线上网站", "正常（200）"]);
} else {
  console.log(`  ✗ 线上返回：${liveCode}`);
  problems.push(`线上网站返回 ${liveCode}`);
  summary.push(["线上网站", `异常（${liveCode}）`]);
}

// ── 2. 类型检查 ─────────────────────────────────────────────
step(2, 4, "检查代码类型是否有错");
const typecheck = await run("npx", ["tsc", "--noEmit"]);
if (typecheck.ok) {
  console.log(`  ✓ 类型检查通过，没有类型错误。`);
  summary.push(["类型检查", "通过"]);
} else {
  console.log(`  ✗ ${typecheck.timedOut ? "超时" : "发现类型错误"}：`);
  console.log(typecheck.out.trim().split("\n").slice(0, 20).map(l => "    " + l).join("\n"));
  problems.push("类型检查未通过");
  summary.push(["类型检查", "未通过"]);
}

// ── 3. 测试 ─────────────────────────────────────────────────
step(3, 4, "运行全部测试");
const test = await run("npx", ["vitest", "run"]);
const testTail = test.out.trim().split("\n").slice(-12).join("\n");
console.log(testTail.split("\n").map(l => "  " + l).join("\n"));
if (test.ok) {
  const passed = /Tests\s+(\d+) passed/.exec(test.out)?.[1];
  console.log(`\n  ✓ 所有测试都通过了${passed ? `（${passed} 项）` : ""}。`);
  summary.push(["测试", `${passed ?? "全部"} 项通过`]);
} else {
  console.log(`\n  ✗ 有测试没有通过。`);
  problems.push("有测试用例未通过");
  summary.push(["测试", "未通过"]);
}

// ── 4. 未保存的改动 ─────────────────────────────────────────
step(4, 4, "查看有哪些改动还没存档");
const status = await run("git", ["status", "--short"]);
const statusLines = status.out.trim().split("\n").filter(Boolean);
if (statusLines.length === 0) {
  console.log("  ✓ 没有未保存的改动，工作区是干净的。");
  summary.push(["未存档改动", "无"]);
} else {
  console.log(statusLines.map(l => "  " + l).join("\n"));
  console.log(`\n  共 ${statusLines.length} 个文件有改动。`);
  console.log(`  如果你或 GPT 刚改完东西，看到这里的列表是正常的。`);
  summary.push(["未存档改动", `${statusLines.length} 个文件`]);
}

// ── 结果 ────────────────────────────────────────────────────
console.log(`\n${heavy}\n  自检结果\n${heavy}\n`);
for (const [key, value] of summary) {
  // 中文在等宽字体里占两个字符宽，用全角空格补齐让冒号对齐。
  const pad = Math.max(0, 10 - [...key].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 2 : 1), 0));
  console.log(`  ${key}${"　".repeat(Math.ceil(pad / 2))} →  ${value}`);
}

if (problems.length === 0) {
  console.log(`\n  没有发现问题。线上网站不受任何影响。`);
  console.log(`  如果想把当前改动发布上线，请双击「发布上线.cmd」。`);
} else {
  console.log(`\n  需要处理的问题：`);
  for (const p of problems) console.log(`    • ${p}`);
  console.log(`\n  不用紧张 —— 线上网站没有被改动，现在仍然可以正常访问。`);
  console.log(`  发布必须手动双击「发布上线.cmd」，而且那里检查不过就不会`);
  console.log(`  覆盖线上。所以线上是安全的。`);
  console.log(`\n  接下来怎么办：`);
  console.log(`    1. 把上面标 ✗ 的报错内容复制下来`);
  console.log(`    2. 发给 GPT，让它修`);
  console.log(`    3. 修好后重新双击本文件确认没问题`);
  console.log(`\n  如果想放弃当前所有改动、回到上一个可用版本，`);
  console.log(`  请找 ZCode 帮你执行：git reset --hard HEAD~1`);
}
console.log();
