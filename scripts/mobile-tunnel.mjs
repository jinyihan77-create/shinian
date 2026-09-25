/**
 * 「手机也能用」双击入口的实际执行体。
 *
 * 中文一律在这里输出，不写在 .cmd 里：cmd.exe 读取 UTF-8 批处理文件时
 * 会按字节错位解析，中文可能被当成命令名报错。详见「自检.cmd」的说明。
 *
 * 为什么要这个脚本：
 * 校园网（BLCU-2.4 这类）默认禁止同一 WiFi 下的设备互相访问——实测 ARP 表里
 * 只能看到网关，手机和电脑互相看不见，所以手机上打不开 localhost。
 * 这里用 Cloudflare 的临时隧道（quick tunnel）开一个公网网址，
 * 手机用 4G/5G 就能打开，不需要注册账号、不需要买域名。
 *
 * 代价与风险（必须让使用者知道）：
 * 1. 网址是公网可达的，拿到网址的人都能打开这个网站（本地模式已自动登录，
 *    所以也就是能看到并修改你的资料）。不用时请关掉这个窗口。
 * 2. 每次启动网址都不一样，手机书签会失效，以窗口里显示的为准。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 3000;
const localUrl = `http://localhost:${port}`;
const children = [];

function findCloudflared() {
  const candidates = [
    "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
    "C:\\Program Files\\cloudflared\\cloudflared.exe",
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  return "cloudflared";
}

function run(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: project,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: options.stdio ?? "inherit",
      ...options,
    });
    child.once("error", () => resolve(false));
    child.once("close", code => resolve(code === 0));
  });
}

async function siteIsUp() {
  try {
    const response = await fetch(localUrl + "/", { signal: AbortSignal.timeout(4000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

function stopAll() {
  for (const child of children) {
    try { child.kill(); } catch { /* 已经退出了 */ }
  }
}

process.on("SIGINT", () => { stopAll(); process.exit(0); });
process.on("exit", stopAll);

const cloudflared = findCloudflared();

console.log(`
──────────────────────────────────────────────────────────
  手机也能用 · 正在准备
──────────────────────────────────────────────────────────
`);

// 网站没在跑就先帮你跑起来。
if (await siteIsUp()) {
  console.log("  网站已经在运行，直接开通道。\n");
} else {
  console.log("  网站还没启动，正在帮你启动（首次可能要等一下）……\n");
  const dev = spawn("npm", ["run", "dev"], {
    cwd: project,
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: "ignore",
  });
  children.push(dev);

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    if (await siteIsUp()) { ready = true; break; }
  }
  if (!ready) {
    console.log("  网站启动超时了。请先双击「启动灵感回声.cmd」，等它显示可以打开之后再试这个。\n");
    stopAll();
    process.exit(1);
  }
  console.log("  网站已启动。\n");
}

console.log("  正在开公网通道，请稍等十几秒……\n");

const tunnel = spawn(cloudflared, ["tunnel", "--url", localUrl, "--no-autoupdate"], {
  cwd: project,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
children.push(tunnel);

let announced = false;
// 只认真正的隧道地址。cloudflared 的输出里还会出现 api.trycloudflare.com
// 之类的固定域名，那些不是你的网站地址，不能拿去生成二维码。
// 真实隧道地址形如 https://rain-delivery-montreal.trycloudflare.com，
// 主机名里必定带连字符，且不以 api./www. 开头。
const pattern = /https:\/\/(?!api\.|www\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/;

async function scan(chunk) {
  if (announced) return;
  const match = pattern.exec(String(chunk));
  if (!match) return;
  announced = true;

  console.log(`
──────────────────────────────────────────────────────────
  好了！用手机扫下面这个二维码
──────────────────────────────────────────────────────────
`);

  try {
    const qrcode = (await import("qrcode-terminal")).default;
    await new Promise(resolve => {
      qrcode.generate(match[0], { small: true }, code => { console.log(code); resolve(); });
    });
  } catch {
    console.log("  （二维码没画出来，用下面的网址也一样）\n");
  }

  console.log(`
  手机相机对着二维码照一下 → 点弹出的链接 → 就打开了。

  如果扫码不方便，也可以手动输入这个网址：

      ${match[0]}

  用流量（4G/5G）或任何 WiFi 都行，不用连学校 WiFi。

  ⚠️ 两点要知道：
     · 这个网址是公网可达的，谁拿到都能打开你的网站。
       不用的时候，关掉这个窗口就断开了。
     · 每次启动网址都不一样，二维码也会变，
       以这个窗口里显示的为准。

  想停止：关掉这个窗口即可。
──────────────────────────────────────────────────────────
`);
}

tunnel.stdout.on("data", chunk => { void scan(chunk); });
tunnel.stderr.on("data", chunk => { void scan(chunk); });

tunnel.once("close", code => {
  if (!announced) {
    console.log("\n  通道没能建立起来。请检查网络后重试。\n");
    stopAll();
    process.exit(code === 0 ? 0 : 1);
  }
  console.log("\n  通道已关闭。\n");
  stopAll();
});
