/**
 * 剪辑素材批量截取（只读）
 *
 * 统一按手机端 390×844 @2x 截取，输出到 test-results/剪辑素材/，
 * 文件名带序号前缀（01-、02-…）保证按时间顺序排列，方便直接拖进剪辑软件。
 *
 * 只截"最出彩的画面"——页面级、卡片级；不截孤立的按钮小图。
 *
 * 用法：
 *   node scripts/shoot-video-assets.mjs           # 全部场景
 *   node scripts/shoot-video-assets.mjs --list    # 只列场景清单
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT_DIR = path.resolve("test-results", "剪辑素材");
const PROFILE = path.join(OUT_DIR, ".edge-profile");
const PORT = 9360;
// 统一手机端尺寸（iPhone 14 Pro 逻辑分辨率）
const W = 390;
const H = 844;
const DPR = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadCredentials() {
  const values = {};
  for (const file of [".env.local", ".env.tencent-owner.local"]) {
    let text;
    try { text = await readFile(path.resolve(file), "utf8"); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const raw = m[2].trim();
      values[m[1]] = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
    }
  }
  return {
    email: values.OWNER_EMAIL,
    password: values.OWNER_PASSWORD || values.OWNER_INITIAL_PASSWORD,
    origin: (values.APP_ORIGIN || "https://inspiration-echo-318255-10-1492602203.sh.run.tcloudbase.com").replace(/\/+$/, ""),
  };
}

async function connect(port, profile) {
  const edge = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  let target;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
      target = list.find((t) => t.type === "page");
      if (target) break;
    } catch { /* 等待 */ }
  }
  if (!target) { edge.kill(); throw new Error("Edge 端口未就绪"); }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", async (event) => {
    const raw = typeof event.data === "string" ? event.data : await event.data.text();
    const msg = JSON.parse(raw);
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
    else entry.resolve(msg.result);
  });
  await new Promise((res, rej) => {
    socket.addEventListener("open", res, { once: true });
    socket.addEventListener("error", rej, { once: true });
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时 ${method}`)); }, 45000);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { edge, socket, call };
}

const evaluate = async (call, expr) => {
  const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error("页面异常: " + (r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)));
  return r.result?.value;
};

async function navigate(call, url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try { await call("Page.navigate", { url }); return; }
    catch (error) { lastError = error; await sleep(2500); }
  }
  throw new Error(`导航失败：${url} — ${lastError?.message ?? lastError}`);
}

// ───────────────────────────────────────────────────────────
// 滚动辅助：返回实际位移，用来自检"画面是否真的变了"
// ───────────────────────────────────────────────────────────
/** 把某个元素滚到视口中间，返回位移量。找不到时返回 scroll:0。 */
const scrollToEl = (finder) => `(() => {
  const el = ${finder};
  if (!el) return "scroll:0";
  const before = document.scrollingElement.scrollTop + (document.querySelector('.main-wrap')?.scrollTop ?? 0);
  el.scrollIntoView({ block: "center", behavior: "instant" });
  const after = document.scrollingElement.scrollTop + (document.querySelector('.main-wrap')?.scrollTop ?? 0);
  return "scroll:" + Math.abs(after - before);
})()`;

// ───────────────────────────────────────────────────────────
// 场景清单：按视频叙事顺序排列
// ───────────────────────────────────────────────────────────
const SCENES = [
  {
    n: "01", file: "01-落地页-给念头一点柔和的光",
    desc: "开场。暗紫星空 + 发光标题，第一眼气质",
    url: "/", wait: 6000,
  },
  {
    n: "02", file: "02-落地页-卡片与入口",
    desc: "向下滚一点，展示 SHINIAN/01 卡片与「进入拾念灵感空间」入口",
    url: "/", wait: 6000,
    act: `(() => { const before = window.scrollY; window.scrollTo(0, window.innerHeight * 0.55); return "scroll:" + Math.abs(window.scrollY - before); })()`,
    after: 3000,
  },
  {
    n: "03", file: "03-记录页-此刻想记下什么",
    desc: "核心页面。滚动提问式标题 + 捕捉卡片（登录后）",
    url: "/workspace", wait: 8000, needReady: true,
  },
  {
    n: "04", file: "04-记录页-语音底座特写",
    desc: "「说给拾念听」Siri 式语音底座，含声波纹理",
    url: "/workspace", wait: 8000, needReady: true,
    act: scrollToEl(`document.querySelector('.voice-siri-dock')`),
    after: 3000,
  },
  {
    n: "05", file: "05-记录页-放进哪里与添加来源",
    desc: "「放在哪里」三个分类胶囊 + 添加来源，展示捕捉的仪式感",
    url: "/workspace", wait: 8000, needReady: true,
    act: scrollToEl(`Array.from(document.querySelectorAll('*')).find(e => (e.textContent||'').trim() === '放在哪里')`),
    after: 3000,
  },
  {
    n: "06", file: "06-记录页-今日星河卡",
    desc: "Q7 · 一念入星河 卡片 + 摘星按钮，产品记忆点",
    url: "/workspace", wait: 8000, needReady: true,
    act: scrollToEl(`Array.from(document.querySelectorAll('*')).find(e => /一念入星河/.test(e.textContent||'') && e.children.length < 4)`),
    after: 3000,
  },
  {
    n: "07", file: "07-星空打卡牌-今夜跃迁",
    desc: "打开星空打卡牌：星语星笺 + 跃迁仪式感（产品最强记忆点）",
    url: "/workspace", wait: 8000, needReady: true,
    act: `(() => { const b = document.querySelector('[aria-label="打开星空打卡牌"]'); if (!b) return "click:miss"; b.click(); return "click:ok"; })()`,
    after: 5000,
  },
  {
    n: "08", file: "08-回声屿-资料库概览",
    desc: "回声屿（资料库）：收藏的念头一览",
    url: "/workspace", wait: 7000, needReady: true,
    act: `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('回声屿')); b?.click(); return 'ok'; })()`,
    after: 3500,
  },
  {
    n: "09", file: "09-闪卡-油画显影",
    desc: "油画闪卡：半调显影技术，视觉最出彩的一屏",
    url: "/design-preview#flashcard", wait: 7000,
    act: scrollToEl(`document.querySelector('[aria-label^="正在显影的闪卡"], [aria-label^="油画闪卡"]')`),
    after: 4000,
  },
  {
    n: "10", file: "10-闪卡-画作细节",
    desc: "闪卡下半屏：画作信息与「查看 4K 画作」入口，靠近看清细节",
    url: "/design-preview#flashcard", wait: 7000,
    act: `(() => {
      // 先滚到闪卡，再继续往下推一段，露出底部信息层（与 09 画面不同）
      const el = document.querySelector('[aria-label^="正在显影的闪卡"], [aria-label^="油画闪卡"]');
      if (!el) return "scroll:0";
      const wrap = document.querySelector('.main-wrap') || document.scrollingElement;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const before = wrap.scrollTop;
      wrap.scrollTop = before + 320;
      return "scroll:" + Math.abs(wrap.scrollTop - before);
    })()`,
    after: 4000,
  },
  {
    n: "11", file: "11-预览-记录页全貌",
    desc: "免登录界面预览：完整记录页（可给别人看的那版）",
    url: "/design-preview#capture", wait: 6000,
  },
  {
    n: "12", file: "12-预览-回声屿筛选",
    desc: "免登录预览：回声屿 + 筛选与搜索入口",
    url: "/design-preview#library", wait: 6000,
  },
  {
    n: "13", file: "13-预览-设置页",
    desc: "设置页：私人账号、资料安心保存、备份导出入口",
    url: "/design-preview#settings", wait: 6000,
  },
  {
    n: "14", file: "14-星球预览-视觉资产",
    desc: "星球/光球视觉预览页，适合做转场空镜",
    url: "/orb-preview", wait: 6000,
  },
  {
    n: "15", file: "15-像素卡预览-视觉资产",
    desc: "像素卡视觉预览页，做节奏变化用",
    url: "/pixel-card-preview", wait: 6000,
  },
  {
    n: "16", file: "16-布局预览-全览",
    desc: "布局预览页：设计系统全貌，收尾或做章节过渡",
    url: "/layout-preview", wait: 6000,
  },
];

if (process.argv.includes("--list")) {
  console.log("\n剪辑素材场景清单（统一手机端 " + W + "×" + H + " @3x）\n");
  for (const s of SCENES) console.log(`  ${s.n}  ${s.file}.png\n      ${s.desc}\n`);
  process.exit(0);
}

await mkdir(OUT_DIR, { recursive: true });
const { email, password, origin } = await loadCredentials();
const { edge, socket, call } = await connect(PORT, PROFILE);
const shotList = [];
const failures = [];

try {
  await call("Page.enable");
  await call("Runtime.enable");

  // 统一手机端设备参数
  await call("Emulation.setDeviceMetricsOverride", {
    width: W, height: H, deviceScaleFactor: DPR, mobile: true,
  });
  // 关闭动效降级，保留完整视觉（但避免持续动画导致截图抖动）
  await call("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });

  // 先过腾讯云访问提示，再登录（cookie 会保留在同一 profile）
  await navigate(call, `${origin}/`);
  await sleep(3500);
  await evaluate(call, `(() => { const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent && x.textContent.includes("确定访问")); if (b) b.click(); return "ok"; })()`);
  await sleep(3500);

  await navigate(call, `${origin}/workspace`);
  await sleep(4500);
  const login = await evaluate(call, `(async () => {
    const inputs = Array.from(document.querySelectorAll("input"));
    const e = inputs.find(i => i.type === "email"); const p = inputs.find(i => i.type === "password");
    if (!e || !p) return "already-in";
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value"); d.set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    set(e, ${JSON.stringify(email)}); set(p, ${JSON.stringify(password)});
    Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").includes("进入我的空间"))?.click();
    return "submitted";
  })()`);
  console.log(`[剪辑素材] 登录状态：${login}`);
  await sleep(8000);

  for (const scene of SCENES) {
    const outName = `${scene.file}.png`;
    try {
      await navigate(call, `${origin}${scene.url}`);
      await sleep(scene.wait ?? 5000);

      // 需要登录态的页面：等应用真正就绪，避免拍到"正在打开你的空间"
      if (scene.needReady) {
        let ready = false;
        for (let i = 0; i < 30; i += 1) {
          ready = await evaluate(call, `(() => {
            if (document.querySelector("textarea")) return true;
            const t = document.body.innerText || "";
            if (/回声屿|上一次记下|此刻，想记下什么/.test(t)) return true;
            if (/给念头一点柔和的光|一闪，便有回响|私人灵感空间/.test(t)) return true;
            return false;
          })()`);
          if (ready) break;
          await sleep(1500);
        }
        if (!ready) throw new Error("应用未就绪（停在加载态）");
      }

      if (scene.act) {
        const acted = await evaluate(call, scene.act);
        await sleep(scene.after ?? 2500);
        // 记录滚动是否真的发生，避免截出与上一张完全相同的重复画面
        if (typeof acted === "string" && acted.startsWith("scroll:")) {
          const moved = Number(acted.split(":")[1]);
          if (!moved) throw new Error("滚动未生效，画面与上一张重复");
        }
      }

      // 截图前等一小会儿，让入场动画落定
      await sleep(1200);
      const s = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(path.join(OUT_DIR, outName), Buffer.from(s.data, "base64"));
      shotList.push({ order: scene.n, file: outName, desc: scene.desc, url: scene.url, viewport: `${W}×${H}@${DPR}x` });
      console.log(`[剪辑素材] ${scene.n} ✓ ${outName}`);
    } catch (error) {
      failures.push({ order: scene.n, file: outName, error: String(error?.message ?? error) });
      console.log(`[剪辑素材] ${scene.n} ✗ ${outName} — ${error?.message ?? error}`);
    }
  }
} finally {
  socket.close();
  edge.kill();
}

// ── 生成剪辑清单（拍摄脚本）──
const lines = [];
lines.push("# 拾念 · 剪辑素材清单", "");
lines.push(`截取时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`);
lines.push(`统一规格：手机端 **${W}×${H} @${DPR}x**（竖屏，可直接放进视频轨道）`);
lines.push(`存放位置：\`test-results/剪辑素材/\``);
lines.push("");
lines.push("> 文件名以 `01-` ~ `16-` 开头，按序号排列即剪辑顺序。");
lines.push("");
lines.push("## 素材顺序表", "");
lines.push("| 序号 | 文件 | 画面内容 | 来源页面 |");
lines.push("|---|---|---|---|");
for (const s of shotList) {
  lines.push(`| **${s.order}** | \`${s.file}\` | ${s.desc} | \`${s.url}\` |`);
}
if (failures.length) {
  lines.push("", "## ⚠️ 未取到的画面", "");
  for (const f of failures) lines.push(`- ${f.order} \`${f.file}\`：${f.error}`);
}
lines.push("");
lines.push("---", "", "## 剪辑建议（可直接照做）", "");
lines.push("### 结构：问题 → 过程 → 结果", "");
lines.push("| 段落 | 用哪些素材 | 时长建议 | 配文方向 |");
lines.push("|---|---|---|---|");
lines.push("| **开场** | 01 → 02 | 6–8s | 「我想做一个能收好念头的地方」 |");
lines.push("| **我怎么做的** | 14 → 15 → 16（视觉资产，做快切） | 8–10s | 「没有设计稿，全靠对话把视觉聊出来」 |");
lines.push("| **成品展示** | 03 → 04 → 05 → 06 | 15–20s | 逐屏讲记录、语音、分类、星卡 |");
lines.push("| **高光时刻** | 07（星空打卡） → 09 → 10（油画闪卡） | 12–15s | 停久一点，这两屏最抓人 |");
lines.push("| **回看与整理** | 08 → 12 | 8–10s | 回声屿、筛选、跨设备同步 |");
lines.push("| **收尾** | 11 → 13 | 6–8s | 界面预览 / 私人账号，收一句感想 |");
lines.push("");
lines.push("### 剪的时候注意", "");
lines.push("- **07、09、10 别切太快**：星空打卡和油画显影是产品最强的记忆点，各留 3 秒以上让人看清。");
lines.push("- **03 vs 11 是同一页的两种状态**：03 是登录后的真实页，11 是免登录预览页。做「真实可用」的证据用 03，对外展示用 11。");
lines.push("- **16 可以当章节间隔板**：布局预览页画面干净，适合打标题字。");
lines.push("- 想要更有说服力的话，把这张清单也放进视频：**「AI 说这里坏了 → 我复验 → 发现是假警报 → 修掉检测逻辑」**，这条线比只展示成品更真实。");
lines.push("");
lines.push("### 已知的画面瑕疵（剪的时候避开或剪掉）", "");
lines.push("- 所有页面顶部右上角的同步状态在手机上**只有一个孤立小圆点**（文字被隐藏），特写时容易显得空。");
lines.push("- `「上一次记下」` 卡片目前线上版本**没有样式**（布局散），预计下一版修好。别给它特写。");
lines.push("- 网站是腾讯云测试域名，**首次访问有 3 秒风险提示中间页**，素材里不含这一页。");

await writeFile(path.join(OUT_DIR, "剪辑清单.md"), lines.join("\n"));

console.log("\n" + lines.slice(0, 3).join("\n"));
console.log(`\n成功 ${shotList.length} / 共 ${SCENES.length} 张`);
if (failures.length) {
  console.log("\n未取到：");
  for (const f of failures) console.log(`  ${f.order} ${f.file} — ${f.error}`);
}
console.log(`\n素材目录：${OUT_DIR}`);
console.log(`剪辑清单：${path.join(OUT_DIR, "剪辑清单.md")}`);
