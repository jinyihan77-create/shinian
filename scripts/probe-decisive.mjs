/**
 * 决定性验证：这几处到底能不能点到？
 *
 * 对每个可疑元素多点采样（而不是只看中心点），计算"真正可点的比例"。
 * 这样能区分"完全点不到"和"只是中心点被盖、旁边还能点"。
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
const PORT = 9570;
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

// 对指定选择器的元素做密集探针采样
const makeProbe = (selector, label) => `(() => {
  const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
  const out = [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    // 网格采样：横向 5 点、纵向 5 点
    let total = 0, hit = 0, blockedBy = {};
    const N = 5;
    for (let i = 1; i <= N; i++) {
      for (let j = 1; j <= N; j++) {
        const x = r.left + r.width * (i / (N + 1));
        const y = r.top + r.height * (j / (N + 1));
        if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) continue;
        total++;
        const top = document.elementFromPoint(x, y);
        if (!top) continue;
        if (top === el || el.contains(top)) { hit++; continue; }
        const key = top.tagName + '.' + String(top.className || '').split(/\\s+/).slice(0,1).join('');
        blockedBy[key] = (blockedBy[key] || 0) + 1;
      }
    }
    const clickableRatio = total ? Math.round(hit / total * 100) : 0;
    out.push({
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
      cls: String(el.className || '').split(/\\s+/).slice(0,2).join('.'),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) },
      clickableRatio,
      verdict: clickableRatio === 0 ? '完全点不到' : clickableRatio < 60 ? '大部分点不到' : '可点',
      blockedBy,
    });
  }
  return out;
})()`;

// 滚动容器状态
const SCROLL_STATE = `(() => {
  const m = document.querySelector('.main-wrap');
  const nav = document.querySelector('.mobile-nav');
  return {
    mainScrollTop: m ? Math.round(m.scrollTop) : null,
    mainScrollH: m ? Math.round(m.scrollHeight) : null,
    mainClientH: m ? Math.round(m.clientHeight) : null,
    maxScrollTop: m ? Math.round(m.scrollHeight - m.clientHeight) : null,
    navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
  };
})()`;

async function main() {
  const { email, password, origin } = await loadCredentials();
  console.log("目标：", origin);
  await mkdir(OUT, { recursive: true });

  const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(project, "test-results", "edge-decisive")}`, "about:blank"],
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

  await call("Page.enable");
  await call("Runtime.enable");
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

  const report = { origin, at: new Date().toISOString(), findings: [] };

  // ① 回声屿：空状态下的「留下第一句话」
  console.log("\n" + "=".repeat(60));
  console.log("① 回声屿：空状态按钮");
  await call("Page.navigate", { url: `${origin}/workspace#library` });
  await sleep(6000);
  let scroll = await evaluate(SCROLL_STATE);
  console.log("滚动状态：", JSON.stringify(scroll));
  let probe = await evaluate(makeProbe('button[class*="create"]', 'create'));
  console.log("未滚动时的可点性：");
  for (const p of (probe || [])) console.log("  ", JSON.stringify(p));
  await shot("decisive-回声屿-未滚动.png");

  // 滚到底再测
  await evaluate(`(() => { const m=document.querySelector('.main-wrap'); if(m) m.scrollTop = m.scrollHeight; return m?m.scrollTop:-1; })()`);
  await sleep(2500);
  scroll = await evaluate(SCROLL_STATE);
  console.log("滚到底后：", JSON.stringify(scroll));
  probe = await evaluate(makeProbe('button[class*="create"]', 'create'));
  console.log("滚到底后的可点性：");
  for (const p of (probe || [])) console.log("  ", JSON.stringify(p));
  await shot("decisive-回声屿-滚到底.png");

  // ② 设置页：输入框与按钮
  console.log("\n" + "=".repeat(60));
  console.log("② 设置页");
  await call("Page.navigate", { url: `${origin}/workspace#settings` });
  await sleep(6000);
  scroll = await evaluate(SCROLL_STATE);
  console.log("滚动状态：", JSON.stringify(scroll));
  for (const [sel, name] of [['input.input', '输入框'], ['button.backup-action', '备份按钮'], ['button.text-button', '文字按钮']]) {
    const r = await evaluate(makeProbe(sel, name));
    console.log(`  --- ${name} (${sel}) ---`);
    for (const p of (r || [])) console.log("   ", JSON.stringify(p));
  }
  await shot("decisive-设置页-未滚动.png");

  await evaluate(`(() => { const m=document.querySelector('.main-wrap'); if(m) m.scrollTop = m.scrollHeight; return m?m.scrollTop:-1; })()`);
  await sleep(2500);
  scroll = await evaluate(SCROLL_STATE);
  console.log("滚到底后：", JSON.stringify(scroll));
  for (const [sel, name] of [['input.input', '输入框'], ['button.backup-action', '备份按钮'], ['button.text-button', '文字按钮']]) {
    const r = await evaluate(makeProbe(sel, name));
    console.log(`  --- ${name} ---`);
    for (const p of (r || [])) console.log("   ", JSON.stringify(p));
  }
  await shot("decisive-设置页-滚到底.png");

  report.findings = [];
  await writeFile(path.join(OUT, "decisive-report.json"), JSON.stringify(report, null, 1));

  socket.close();
  edge.kill();
}

main().catch(e => { console.error("失败：", e.message); process.exit(1); });
