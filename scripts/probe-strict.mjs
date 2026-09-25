/**
 * 严格探针（排除假阳性）
 *
 * 上一版探针把"滚动出视口"的元素也算成"点不到"，那是误报。
 * 这一版只测「元素与滚动容器可视区的交集」内的点——
 * 只有真正可见的部分点不到，才算问题。
 *
 * 只读，不改任何文件。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9574;
const OUT = path.join(project, "test-results", "mobile-usability");

async function loadCredentials() {
  const values = {};
  for (const file of [".env.local", ".env.tencent-owner.local"]) {
    let text;
    try { text = await readFile(path.resolve(project, file), "utf8"); } catch { continue; }
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
    origin: (values.APP_ORIGIN || "").replace(/\/+$/, ""),
  };
}

const STRICT = `(() => {
  const scroller = document.querySelector('.main-wrap');
  if (!scroller) return { error: 'no .main-wrap' };
  const sr = scroller.getBoundingClientRect();
  const nav = document.querySelector('.mobile-nav');
  const nr = nav ? nav.getBoundingClientRect() : null;

  const sel = 'button, a[href], input, textarea, select, [role="button"], [role="radio"], summary';
  const out = [];
  for (const el of Array.from(document.querySelectorAll(sel))) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;

    // 只取「元素」与「滚动容器可视区」的交集
    const vx1 = Math.max(r.left, sr.left), vx2 = Math.min(r.right, sr.right);
    const vy1 = Math.max(r.top, sr.top),  vy2 = Math.min(r.bottom, sr.bottom);
    const vw = vx2 - vx1, vh = vy2 - vy1;
    if (vw < 4 || vh < 4) continue;   // 完全不在可视区 → 跳过，不是问题

    // 在可见部分里采样
    let total = 0, hit = 0, blocked = {};
    const N = 5;
    for (let i = 1; i <= N; i++) for (let j = 1; j <= N; j++) {
      const x = vx1 + vw * (i / (N + 1));
      const y = vy1 + vh * (j / (N + 1));
      if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) continue;
      total++;
      const top = document.elementFromPoint(x, y);
      if (!top) continue;
      if (top === el || el.contains(top)) { hit++; continue; }
      const k = top.tagName + (typeof top.className === 'string' && top.className ? '.' + top.className.trim().split(/\\s+/)[0] : '');
      blocked[k] = (blocked[k] || 0) + 1;
    }
    const ratio = total ? Math.round(hit / total * 100) : -1;
    if (ratio < 100) {
      out.push({
        el: el.tagName + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/)[0] : ''),
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g,' ').slice(0, 28),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        visible: { x: Math.round(vx1), y: Math.round(vy1), w: Math.round(vw), h: Math.round(vh) },
        clickableRatio: ratio, blockedBy: blocked,
        underNav: nr ? (vy2 > nr.top) : false,
      });
    }
  }
  return {
    scrollTop: Math.round(scroller.scrollTop),
    maxScroll: Math.round(scroller.scrollHeight - scroller.clientHeight),
    navTop: nr ? Math.round(nr.top) : null,
    problems: out,
  };
})()`;

async function main() {
  const { email, password, origin } = await loadCredentials();
  console.log("目标：", origin);
  await mkdir(OUT, { recursive: true });

  const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(project, "test-results", "edge-strict")}`, "about:blank"],
    { stdio: "ignore", windowsHide: true });

  await sleep(2500);
  const targets = await fetch(`http://127.0.0.1:${PORT}/json`).then(r => r.json());
  const socket = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  const pending = new Map();
  let id = 1;
  socket.addEventListener("message", async e => {
    const raw = typeof e.data === "string" ? e.data : await e.data.text();
    const msg = JSON.parse(raw);
    const res = pending.get(msg.id);
    if (res) { pending.delete(msg.id); res(msg); }
  });
  await new Promise((res, rej) => {
    socket.addEventListener("open", res, { once: true });
    socket.addEventListener("error", rej, { once: true });
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const cid = id++;
    const t = setTimeout(() => { pending.delete(cid); reject(new Error("timeout " + method)); }, 90000);
    pending.set(cid, m => { clearTimeout(t); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); });
    socket.send(JSON.stringify({ id: cid, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text };
    return r.result?.value;
  };
  const shot = async (name) => {
    const s = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(OUT, name), Buffer.from(s.data, "base64"));
  };

  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  await call("Page.navigate", { url: `${origin}/` });
  await sleep(4000);
  await evaluate(`(() => { const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent && x.textContent.includes("确定访问")); if (b) b.click(); return "ok"; })()`);
  await sleep(3000);
  await call("Page.navigate", { url: `${origin}/workspace` });
  await sleep(4000);
  await evaluate(`(async () => {
    const inputs = Array.from(document.querySelectorAll("input"));
    const e = inputs.find(i => i.type === "email"); const p = inputs.find(i => i.type === "password");
    if (!e || !p) return "already-in";
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value"); d.set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    set(e, ${JSON.stringify(email)}); set(p, ${JSON.stringify(password)});
    Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").includes("进入我的空间"))?.click();
    return "submitted";
  })()`);
  await sleep(9000);

  const results = {};
  // 等应用真正就绪再探。冷启动（免费版 MinNum=0）首次请求可能 20s+，
  // 之前不等的版本会在空壳页上探测，得出"无问题"的假结论。
  const waitReady = async () => {
    for (let i = 0; i < 40; i++) {
      const ok = await evaluate(`(() => {
        const m = document.querySelector('.main-wrap');
        if (m && m.clientHeight > 200) return true;
        const t = document.body.innerText || '';
        return /回声屿|此刻，想记下什么|账号与设置/.test(t) && !!document.querySelector('.mobile-nav');
      })()`);
      if (ok === true) return true;
      await sleep(1500);
    }
    return false;
  };

  for (const [name, hash] of [["记录页", ""], ["回声屿", "#library"], ["闪卡橱窗", "#flashcard"], ["设置", "#settings"]]) {
    await call("Page.navigate", { url: `${origin}/workspace${hash}` });
    await sleep(3000);
    const ready = await waitReady();
    if (!ready) { console.log(`\n【${name}】⚠ 页面未就绪，跳过（不给出结论）`); results[name] = { skipped: "未就绪" }; continue; }
    await sleep(1500);
    // 保证从顶部开始
    await evaluate(`(() => { const m=document.querySelector('.main-wrap'); if(m) m.scrollTop=0; return 1; })()`);
    await sleep(1500);
    const top = await evaluate(STRICT);
    console.log(`\n${"=".repeat(62)}\n【${name}】滚动在顶部（scrollTop=${top?.scrollTop}，最大可滚=${top?.maxScroll}，导航栏顶=${top?.navTop}）`);
    if (top?.problems?.length) {
      for (const p of top.problems) {
        console.log(`  ⚠ ${p.el} 「${p.label}」 可点率=${p.clickableRatio}%  元素=${JSON.stringify(p.rect)}  可见部分=${JSON.stringify(p.visible)}  被谁挡=${JSON.stringify(p.blockedBy)}${p.underNav ? '  ←与底栏重叠' : ''}`);
      }
    } else console.log("  ✅ 无问题");
    await shot(`strict-${name}-顶部.png`);

    // 滚到底再测一次
    await evaluate(`(() => { const m=document.querySelector('.main-wrap'); if(m) m.scrollTop=m.scrollHeight; return 1; })()`);
    await sleep(2000);
    const bot = await evaluate(STRICT);
    console.log(`  滚到底（scrollTop=${bot?.scrollTop}）：`);
    if (bot?.problems?.length) {
      for (const p of bot.problems) {
        console.log(`  ⚠ ${p.el} 「${p.label}」 可点率=${p.clickableRatio}%  元素=${JSON.stringify(p.rect)}  被谁挡=${JSON.stringify(p.blockedBy)}${p.underNav ? '  ←与底栏重叠' : ''}`);
      }
    } else console.log("  ✅ 无问题");
    await shot(`strict-${name}-底部.png`);

    results[name] = { top, bottom: bot };
  }

  await writeFile(path.join(OUT, "strict-report.json"), JSON.stringify(results, null, 1));
  console.log("\n报告：", path.join(OUT, "strict-report.json"));

  socket.close(); edge.kill();
}

main().catch(e => { console.error("失败：", e.message); process.exit(1); });
