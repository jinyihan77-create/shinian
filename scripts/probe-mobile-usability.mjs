/**
 * 手机端「完全用不了」定位探针
 *
 * 用探针法逐个检查手机端（390×844）各页面、各交互元素是否真的可点：
 *   - 用 elementFromPoint 判断某点最上层是谁（能否真点到）
 *   - 找出被遮挡、被裁切、尺寸为 0 的元素
 *   - 抓取控制台报错（JS 崩了也会导致"用不了"）
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
const PORT = 9566;
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

// 通用可点性检查：列出所有看起来可交互的元素，逐个用探针验证能否点到
const CLICKABILITY = `(() => {
  const sel = 'button, a[href], input, textarea, select, [role="button"], [role="radio"], [role="tab"], summary';
  const els = Array.from(document.querySelectorAll(sel));
  const problems = [];
  const seen = new Set();
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.bottom < 0 || r.top > innerHeight) continue;  // 不在视口内的先跳过
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (cs.pointerEvents === 'none') {
      problems.push({ issue: 'pointer-events:none', el: el.tagName + '.' + String(el.className||'').split(/\\s+/)[0], label: (el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,24) });
      continue;
    }
    // 在元素中心放探针
    const cx = r.left + r.width/2, cy = r.top + Math.min(r.height/2, 20);
    if (cx < 0 || cx > innerWidth || cy < 0 || cy > innerHeight) continue;
    const top = document.elementFromPoint(cx, cy);
    const reachable = top === el || el.contains(top) || (top && top.contains(el));
    if (!reachable && top) {
      const key = el.tagName + '|' + String(el.className||'').split(/\\s+/)[0] + '|' + (top.tagName+'.'+String(top.className||'').split(/\\s+/)[0]);
      if (seen.has(key)) continue;
      seen.add(key);
      problems.push({
        issue: '被其他元素遮挡',
        el: el.tagName + '.' + String(el.className||'').split(/\\s+/)[0],
        label: (el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,24),
        blockedBy: top.tagName + '.' + String(top.className||'').split(/\\s+/)[0],
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      });
    }
    // 可点区域过小
    if (r.height < 32 && (el.tagName === 'BUTTON' || el.tagName === 'A')) {
      problems.push({ issue: '过小(<32px高)', el: el.tagName + '.' + String(el.className||'').split(/\\s+/)[0], label: (el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,24), h: Math.round(r.height) });
    }
  }
  return { count: els.length, problems };
})()`;

const PAGE_STATE = `(() => {
  const t = document.body.innerText || '';
  return {
    path: location.pathname + location.hash,
    title: document.title,
    textHead: t.slice(0, 160).replace(/\\n+/g, ' | '),
    hasTextarea: !!document.querySelector('textarea'),
    buttons: document.querySelectorAll('button').length,
    cards: document.querySelectorAll('.note-card').length,
  };
})()`;

async function main() {
  const { email, password, origin } = await loadCredentials();
  console.log("目标：", origin);
  await mkdir(OUT, { recursive: true });

  const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(project, "test-results", "edge-mobile-usability")}`, "about:blank"],
    { stdio: "ignore", windowsHide: true });

  await sleep(2500);
  const targets = await fetch(`http://127.0.0.1:${PORT}/json`).then(r => r.json());
  const socket = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  const pending = new Map();
  const consoleErrors = [];
  let id = 1;
  socket.addEventListener("message", async e => {
    const raw = typeof e.data === "string" ? e.data : await e.data.text();
    const msg = JSON.parse(raw);
    if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params?.type)) {
      const txt = (msg.params.args || []).map(a => a.value ?? a.description ?? "").join(" ").slice(0, 200);
      if (txt) consoleErrors.push({ type: msg.params.type, text: txt });
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push({ type: "exception", text: String(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || "").slice(0, 300) });
    }
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

  const report = { origin, at: new Date().toISOString(), pages: [], consoleErrors: [] };

  const routes = [
    { name: "记录页", url: "/workspace", hash: "" },
    { name: "回声屿", url: "/workspace", hash: "#library" },
    { name: "闪卡橱窗", url: "/workspace", hash: "#flashcard" },
    { name: "设置", url: "/workspace", hash: "#settings" },
  ];

  for (const rt of routes) {
    await call("Page.navigate", { url: `${origin}${rt.url}${rt.hash}` });
    await sleep(5500);
    const state = await evaluate(PAGE_STATE);
    const click = await evaluate(CLICKABILITY);
    console.log(`\n=== ${rt.name}（${rt.url}${rt.hash}）===`);
    console.log("  状态：", JSON.stringify(state));
    if (click && click.problems) {
      console.log(`  交互元素 ${click.count} 个，发现 ${click.problems.length} 个问题：`);
      for (const p of click.problems.slice(0, 12)) console.log("   -", JSON.stringify(p));
    } else {
      console.log("  （无问题或页面未就绪）");
    }
    await shot(`usability-${rt.name}.png`);
    report.pages.push({ name: rt.name, route: rt.url + rt.hash, state, click });
  }

  report.consoleErrors = consoleErrors.slice(0, 40);
  console.log("\n=== 控制台报错 ===");
  if (!consoleErrors.length) console.log("  无");
  else for (const e of consoleErrors.slice(0, 15)) console.log(`  [${e.type}] ${e.text}`);

  // 滚到记录页底部，检查底部遮挡
  await call("Page.navigate", { url: `${origin}/workspace` });
  await sleep(5000);
  await evaluate(`(() => { const m = document.querySelector('.main-wrap'); if (m) m.scrollTop = m.scrollHeight; return m ? m.scrollTop : -1; })()`);
  await sleep(2500);
  const bottomProbe = await evaluate(`(() => {
    const m = document.querySelector('.main-wrap');
    const nav = document.querySelector('.mobile-nav');
    const out = { scrolledTo: m ? Math.round(m.scrollTop) : null, canScroll: m ? m.scrollHeight > m.clientHeight + 4 : null };
    if (!nav) { out.nav = null; return out; }
    const nr = nav.getBoundingClientRect();
    out.nav = { top: Math.round(nr.top), bottom: Math.round(nr.bottom) };
    // 在导航栏上沿往上 2px 处放探针，看那里是不是内容
    const probes = [];
    for (const x of [60, 195, 330]) {
      const el = document.elementFromPoint(x, nr.top - 3);
      probes.push({ x, top: el ? el.tagName + '.' + String(el.className||'').split(/\\s+/)[0] : null,
                    isNav: el === nav || (el && nav.contains(el)) });
    }
    out.probesAboveNav = probes;
    // 最底部内容元素与导航栏是否重叠
    const cards = Array.from(document.querySelectorAll('.note-card, .last-thought, .entryCompact, [class*="entry"]'));
    let maxBottom = 0, lowest = null;
    for (const c of cards) {
      const cr = c.getBoundingClientRect();
      if (cr.height > 0 && cr.bottom > maxBottom) { maxBottom = cr.bottom; lowest = c; }
    }
    out.lowestElement = lowest ? {
      cls: String(lowest.className || '').split(/\\s+/)[0],
      bottom: Math.round(maxBottom),
      overlapWithNav: Math.round(Math.max(0, maxBottom - nr.top)),
    } : null;
    return out;
  })()`);
  console.log("\n=== 记录页滚到底：底部遮挡 ===");
  console.log(JSON.stringify(bottomProbe, null, 1));
  report.bottomProbe = bottomProbe;
  await shot("usability-记录页-滚到底.png");

  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
  console.log("\n报告已写入：", path.join(OUT, "report.json"));

  socket.close();
  edge.kill();
}

main().catch(e => { console.error("失败：", e.message); process.exit(1); });
