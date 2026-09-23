/**
 * 夜间监工 · 决定性验证（只读）
 * 唯一目的：确认 .last-thought 按钮在滚到底后是否真的被底部导航遮住、能否点到。
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT_DIR = path.resolve("test-results", "night-watch");
const PROFILE = path.join(OUT_DIR, ".edge-profile-decide");
const PORT = 9351;
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
  const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore", windowsHide: true });
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
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时 ${method}`)); }, 30000);
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

await mkdir(OUT_DIR, { recursive: true });
const { email, password, origin } = await loadCredentials();
const { edge, socket, call } = await connect(PORT, PROFILE);

try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });

  await call("Page.navigate", { url: `${origin}/` });
  await sleep(3500);
  await evaluate(call, `(() => { const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent && x.textContent.includes("确定访问")); if (b) b.click(); return "ok"; })()`);
  await sleep(3500);
  await call("Page.navigate", { url: `${origin}/workspace` });
  await sleep(4000);
  await evaluate(call, `(async () => {
    const inputs = Array.from(document.querySelectorAll("input"));
    const e = inputs.find(i => i.type === "email"); const p = inputs.find(i => i.type === "password");
    if (!e || !p) return "already-in";
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value"); d.set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    set(e, ${JSON.stringify(email)}); set(p, ${JSON.stringify(password)});
    Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").includes("进入我的空间"))?.click();
    return "submitted";
  })()`);
  await sleep(7000);

  // 滚到底
  await evaluate(call, `(() => {
    const sc = Array.from(document.querySelectorAll("body *")).find(el => {
      const cs = getComputedStyle(el);
      return el.scrollHeight > el.clientHeight + 4 && (cs.overflowY === "auto" || cs.overflowY === "scroll");
    });
    if (sc) { sc.scrollTop = sc.scrollHeight; return "scrolled:" + sc.scrollTop + "/" + (sc.scrollHeight - sc.clientHeight); }
    return "no-scroller";
  })()`);
  await sleep(2500);

  const result = await evaluate(call, `(() => {
    const vh = window.innerHeight;
    const btn = document.querySelector(".last-thought");
    const sc = Array.from(document.querySelectorAll("body *")).find(el => {
      const cs = getComputedStyle(el);
      return el.scrollHeight > el.clientHeight + 4 && (cs.overflowY === "auto" || cs.overflowY === "scroll");
    });
    const nav = document.querySelector("nav.mobile-nav");
    const info = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], bottom: Math.round(r.bottom), position: cs.position, zIndex: cs.zIndex, overflow: cs.overflowY, paddingBottom: cs.paddingBottom }; };
    let hit = null;
    if (btn) {
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      // 从按钮顶部往下每 8px 探一次，看哪个点能命中按钮
      const probes = [];
      for (let y = Math.round(r.top) + 4; y < Math.round(r.bottom); y += 8) {
        if (y < 0 || y > vh) continue;
        const top = document.elementFromPoint(cx, y);
        probes.push({ y, hitSelf: top === btn || btn.contains(top), hitWhat: top ? top.tagName.toLowerCase() + (typeof top.className === "string" && top.className ? "." + top.className.split(/\\s+/)[0] : "") : null });
      }
      const hitCount = probes.filter(p => p.hitSelf).length;
      hit = {
        buttonRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        buttonBottom: Math.round(r.bottom),
        visibleInViewport: r.top < vh && r.bottom > 0,
        probes,
        hitCount, totalProbes: probes.length,
        fullyClickable: hitCount === probes.length && probes.length > 0,
      };
    }
    return {
      viewport: window.innerWidth + "x" + vh,
      scroller: info(sc),
      nav: info(nav),
      button: hit,
      gapBetweenScrollerAndNav: (sc && nav) ? Math.round(nav.getBoundingClientRect().top - sc.getBoundingClientRect().bottom) : null,
      buttonOverlapsNav: (btn && nav) ? Math.round(btn.getBoundingClientRect().bottom - nav.getBoundingClientRect().top) : null,
    };
  })()`);

  const s = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(OUT_DIR, "decide-mobile-bottom.png"), Buffer.from(s.data, "base64"));

  await writeFile(path.join(OUT_DIR, "decide-findings.json"), JSON.stringify({ at: new Date().toISOString(), result }, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  socket.close();
  edge.kill();
}
