/**
 * 「启动灵感回声」双击入口的实际执行体。
 *
 * 中文一律在这里输出，不写在 .cmd 里：cmd.exe 读取 UTF-8 批处理文件时
 * 会按字节错位解析，中文可能被当成命令名报错。详见「自检.cmd」的说明。
 *
 * 用途：在本地电脑上跑起网站（只有你自己能看到，不影响线上）。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, timeoutMs) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: project,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: "inherit",
    });
    let timer = null;
    if (timeoutMs) timer = setTimeout(() => { child.kill(); resolve(false); }, timeoutMs);
    child.once("error", () => { if (timer) clearTimeout(timer); resolve(false); });
    child.once("close", code => { if (timer) clearTimeout(timer); resolve(code === 0); });
  });
}

if (!fs.existsSync(path.join(project, "node_modules", "next"))) {
  console.log("\n正在安装网站需要的依赖，首次启动可能需要几分钟……\n");
  const installed = await run("npm", ["ci"], 20 * 60_000);
  if (!installed) {
    console.log("\n安装没有完成，请检查网络后重试。");
    process.exit(1);
  }
}

console.log(`
──────────────────────────────────────────────────────────
  灵感回声即将启动
──────────────────────────────────────────────────────────

  请保留这个窗口，不要关闭它。
  启动完成后，在浏览器打开下方显示的地址，通常是：

      http://localhost:3000

  日常使用请保持同一个地址，这样资料才能连续。

  想停止：关掉这个窗口即可。这不会影响线上网站。
──────────────────────────────────────────────────────────
`);

await run("npm", ["run", "dev"]);
