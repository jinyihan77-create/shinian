/**
 * 夜间监工 · 严谨复核（只读）
 * 递归遍历所有 CSS 规则（含 @layer / @media / @supports 嵌套），确认
 * `.last-thought` 到底有没有样式；同时记录语音按钮的 DOM 与行为、
 * 以及顶部同步点的实际渲染宽度。
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT_DIR = path.resolve("test-results", "night-watch");
const PROFILE = path.join(OUT_DIR, ".edge-profile-verify");
const PORT = 9345;
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

  // ===== 1) 递归遍历全部 CSS 规则，找 .last-thought =====
  out.lastThoughtRules = await evaluate(call, `(() => {
    const hits = [];
    const walk = (rules, depth, pathStr) => {
      for (const rule of Array.from(rules || [])) {
        // 分组规则（@layer/@media/@supports/@container）递归下去
        if (rule.cssRules && rule.cssRules.length !== undefined) {
          let label = rule.constructor.name;
          if (rule.name) label += " " + rule.name;
          if (rule.conditionText) label += " " + rule.conditionText;
          walk(rule.cssRules, depth + 1, pathStr + " > @" + label);
          continue;
        }
        const sel = rule.selectorText || "";
        if (sel.includes("last-thought")) {
          hits.push({ path: pathStr, selector: sel, css: (rule.style ? rule.style.cssText : "").slice(0, 300) });
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      let rules; try { rules = sheet.cssRules; } catch { hits.push({ path: "(无法读取)", selector: "CORS 限制", css: sheet.href || "inline" }); continue; }
      walk(rules, 0, sheet.href ? sheet.href.split("/").pop() : "inline-style");
    }
    return { hitCount: hits.length, hits: hits.slice(0, 10) };
  })()`);

  // ===== 2) 语音按钮 DOM 与行为 =====
  out.voiceButton = await evaluate(call, `(() => {
    const el = Array.from(document.querySelectorAll("button, [role=button]")).find(e => /说给拾念听|开始口述/.test((e.getAttribute("aria-label")||"") + (e.textContent||"")));
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // 找同区域内所有文本，看是否有提示语
    const section = el.closest("section, div");
    const nearbyText = section ? (section.innerText || "").split("\\n").map(s=>s.trim()).filter(Boolean).slice(0, 12) : [];
    return {
      found: true,
      aria: el.getAttribute("aria-label"),
      className: el.className,
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      cursor: cs.cursor, disabled: el.disabled,
      childButtons: el.querySelectorAll("button").length,
      // 这个"按钮"内部是否还有别的可点元素
      innerClickables: Array.from(el.querySelectorAll("button, [role=button], a")).map(x => ({ tag: x.tagName.toLowerCase(), aria: x.getAttribute("aria-label"), text: (x.textContent||"").trim().slice(0,20) })),
      nearbyText,
      // 它自己是否就是个按钮，还是容器
      isNativeButton: el.tagName === "BUTTON",
    };
  })()`);

  // 语音点击后的完整状态变化（含 DOM 前后对比）
  out.voiceClickBehavior = await evaluate(call, `(async () => {
    const find = () => Array.from(document.querySelectorAll("button, [role=button]")).find(e => /说给拾念听|开始口述|聆听|停止|结束|正在/.test((e.getAttribute("aria-label")||"") + (e.textContent||"")));
    const before = find();
    const beforeHtml = before ? before.outerHTML.slice(0, 400) : null;
    const beforeText = document.body.innerText;
    if (!before) return { found: false };
    before.click();
    await new Promise(r => setTimeout(r, 3000));
    const after = find();
    const afterText = document.body.innerText;
    // 找出新增的提示文本
    const beforeLines = new Set(beforeText.split("\\n").map(s=>s.trim()));
    const added = afterText.split("\\n").map(s=>s.trim()).filter(s => s && !beforeLines.has(s));
    return {
      found: true,
      beforeAria: before.getAttribute("aria-label"),
      afterAria: after ? after.getAttribute("aria-label") : null,
      afterHtmlChanged: after ? after.outerHTML.slice(0, 400) !== beforeHtml : null,
      addedLines: added.slice(0, 8),
      // 按钮是否有"聆听中"的视觉状态
      listeningStatePresent: /聆听|正在听|识别中|停止/.test(afterText),
    };
  })()`);

  // ===== 3) 顶部同步指示器的实际渲染大小 =====
  out.syncIndicator = await evaluate(call, `(() => {
    const el = document.querySelector(".sync-indicator") || Array.from(document.querySelectorAll("button")).find(b => /已同步|同步中|同步中断/.test(b.getAttribute("aria-label")||""));
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const dot = el.querySelector(".sync-dot, span");
    const dr = dot ? dot.getBoundingClientRect() : null;
    const textSpan = Array.from(el.querySelectorAll("span")).find(s => (s.textContent||"").trim().length > 0);
    const tr = textSpan ? textSpan.getBoundingClientRect() : null;
    const tsCs = textSpan ? getComputedStyle(textSpan) : null;
    return {
      found: true,
      buttonRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      aria: el.getAttribute("aria-label"),
      dotRect: dr ? [Math.round(dr.left), Math.round(dr.top), Math.round(dr.width), Math.round(dr.height)] : null,
      textRect: tr ? [Math.round(tr.left), Math.round(tr.top), Math.round(tr.width), Math.round(tr.height)] : null,
      textContent: textSpan ? (textSpan.textContent||"").trim() : null,
      textStyle: tsCs ? { fontSize: tsCs.fontSize, display: tsCs.display, opacity: tsCs.opacity, visibility: tsCs.visibility, width: tsCs.width, overflow: tsCs.overflow } : null,
      textClipped: tr ? (tr.width < 10) : null,
    };
  })()`);

  await writeFile(path.join(OUT_DIR, "verify-findings.json"), JSON.stringify({ at: new Date().toISOString(), out }, null, 2));
} finally {
  socket.close();
  edge.kill();
}

console.log("\n===== 严谨复核 =====");
console.log(JSON.stringify(out, null, 2));
