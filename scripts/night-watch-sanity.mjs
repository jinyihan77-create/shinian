/**
 * 夜间监工 · 校验自身方法可靠性（只读）
 * a) 统计遍历到的 CSS 规则总数，证明"没找到 .last-thought"不是遍历失败
 * b) 用一个确实存在的类做对照，证明遍历能命中
 * c) 查清底部导航的层级结构（是否覆盖内容）
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT_DIR = path.resolve("test-results", "night-watch");
const PROFILE = path.join(OUT_DIR, ".edge-profile-sanity");
const PORT = 9346;
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
const out = {};

try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
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

  // ===== a+b) 遍历可靠性 + 对照 =====
  out.cssWalkSanity = await evaluate(call, `(() => {
    let total = 0, sheetsOk = 0, sheetsBlocked = 0, lastThought = 0, control = 0;
    const sample = [];
    const walk = (rules) => {
      for (const rule of Array.from(rules || [])) {
        if (rule.cssRules && rule.cssRules.length !== undefined) { walk(rule.cssRules); continue; }
        total++;
        const sel = rule.selectorText || "";
        if (sel.includes("last-thought")) lastThought++;
        if (sel.includes("main-wrap")) { control++; if (sample.length < 3) sample.push(sel); }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      let rules; try { rules = sheet.cssRules; } catch { sheetsBlocked++; continue; }
      sheetsOk++; walk(rules);
    }
    return { totalRulesWalked: total, sheetsReadable: sheetsOk, sheetsBlocked, lastThoughtRules: lastThought, controlRulesFound: control, controlSample: sample };
  })()`);

  // ===== c) 底部导航层级结构 =====
  out.navStructure = await evaluate(call, `(() => {
    const navBtns = Array.from(document.querySelectorAll("button")).filter(b => /记录|回声屿|设置/.test(b.textContent || "") && b.closest("nav, footer, [class*=nav], [class*=tab], [class*=dock]"));
    const holder = navBtns.length ? navBtns[0].closest("nav, footer, [class*=nav], [class*=tab], [class*=dock], div") : null;
    const shell = document.querySelector(".app-shell");
    const mainWrap = document.querySelector(".main-wrap");
    const nav = document.querySelector("nav");
    const info = (el, label) => {
      if (!el) return null;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return { label, tag: el.tagName.toLowerCase(), cls: (typeof el.className === "string" ? el.className : "").slice(0, 60),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        position: cs.position, zIndex: cs.zIndex, display: cs.display };
    };
    // shell 的直接子元素顺序
    const shellChildren = shell ? Array.from(shell.children).map(c => ({ tag: c.tagName.toLowerCase(), cls: (typeof c.className === "string" ? c.className : "").slice(0, 40), rect: (() => { const r = c.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; })() })) : [];
    // 导航按钮文字
    const navLabels = navBtns.map(b => (b.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 20));
    return {
      shell: info(shell, "app-shell"),
      mainWrap: info(mainWrap, "main-wrap"),
      navElement: info(nav, "nav"),
      navHolder: info(holder, "holder"),
      navButtonCount: navBtns.length,
      navLabels,
      shellChildren,
    };
  })()`);

  await writeFile(path.join(OUT_DIR, "sanity-findings.json"), JSON.stringify({ at: new Date().toISOString(), out }, null, 2));
} finally {
  socket.close();
  edge.kill();
}

console.log("\n===== 方法可靠性校验 =====");
console.log(JSON.stringify(out, null, 2));
