/**
 * 「查看夜间监工报告」双击入口的执行体。
 *
 * 中文一律在这里输出（cmd.exe 按字节解析 UTF-8 批处理会把中文当命令名）。
 * 只读：不发布、不改代码、不改线上。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(project, "test-results", "night-watch");

const line = "─".repeat(60);
console.log("");
console.log(line);
console.log("  拾念 · 夜间监工报告");
console.log(line);
console.log("");

if (!fs.existsSync(dir)) {
  console.log("  还没有跑过夜间监工。");
  console.log("");
  console.log("  先手动跑一次：");
  console.log("    node scripts\\night-watch-auto.mjs");
  console.log("");
  process.exit(0);
}

const reportPath = path.join(dir, "auto-report.md");
const runPath = path.join(dir, "auto-run.json");

if (fs.existsSync(reportPath)) {
  console.log(fs.readFileSync(reportPath, "utf8").trim());
} else {
  console.log("  还没有生成报告。");
}

console.log("");
console.log(line);

// 附上运行历史摘要
try {
  const history = JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8"));
  if (history.length) {
    console.log("  最近几次巡检：");
    for (const entry of history.slice(-6)) {
      const when = new Date(entry.at).toLocaleString("zh-CN", { hour12: false });
      const { high = 0, medium = 0 } = entry.counts ?? {};
      console.log(`    ${when}   严重 ${high} / 中等 ${medium}`);
    }
  }
} catch {
  /* 没有历史记录就先不显示 */
}

// 列出最近的截图存档
const archive = path.join(dir, "archive");
if (fs.existsSync(archive)) {
  const shots = fs.readdirSync(archive).filter((f) => f.endsWith(".png")).sort().slice(-6);
  if (shots.length) {
    console.log("");
    console.log("  最近的截图存档（可用看图软件打开）：");
    for (const shot of shots) console.log(`    test-results\\night-watch\\archive\\${shot}`);
  }
}

console.log(line);
console.log("");

// 打开截图存档目录，方便直接看图
const archiveDir = path.join(dir, "archive");
if (fs.existsSync(archiveDir)) {
  spawn("explorer", [archiveDir], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  console.log("  已打开截图文件夹。");
  console.log("");
}

const reportFile = path.join(project, "视频素材", "验收报告.md");
if (fs.existsSync(reportFile)) {
  console.log("  完整验收报告（含每个问题的证据与复现方式）：");
  console.log("    视频素材\\验收报告.md");
  console.log("");
}
