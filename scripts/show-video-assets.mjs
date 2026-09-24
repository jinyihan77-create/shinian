/**
 * 「打开剪辑素材」双击入口的执行体。
 * 中文一律在这里输出（cmd.exe 按字节解析 UTF-8 批处理会把中文当命令名）。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(project, "视频素材");
const line = "─".repeat(60);

console.log("");
console.log(line);
console.log("  拾念 · 剪辑素材");
console.log(line);
console.log("");

const shots = path.join(dir, "剪辑素材-手机端");
if (fs.existsSync(shots)) {
  const files = fs.readdirSync(shots).filter((f) => f.endsWith(".png")).sort();
  console.log(`  手机端剪辑素材：${files.length} 张（统一 390×844，按序号即剪辑顺序）`);
  console.log("");
  for (const f of files) console.log(`    ${f.replace(/\.png$/, "")}`);
  console.log("");
  spawn("explorer", [shots], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  console.log("  已打开素材文件夹。");
} else {
  console.log("  还没有剪辑素材。先生成：");
  console.log("    node scripts\\shoot-video-assets.mjs");
}

console.log("");
console.log(line);
console.log("  配套文档（同在「视频素材」文件夹）：");
console.log("");
console.log("    视频脚本.md      — 分镜、时长、配文、三种时长版本");
console.log("    剪辑清单.md      — 每张素材对应哪个页面、剪辑建议");
console.log("    验收报告.md      — 发现的问题、证据、修复前后对比");
console.log("");

// 顺带打开文档目录
if (fs.existsSync(dir)) {
  spawn("explorer", [dir], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}
console.log(line);
console.log("");
