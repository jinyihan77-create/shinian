/**
 * 夜间监工 · 定点复检（只读）
 * 针对已发现的可疑点做精确量测：
 *  1) 手机端底部导航与最后一张卡片的遮挡关系
 *  2) "上一次记下…"卡片的排版异常（文字居中 + 游离箭头）
 *  3) 语音按钮的真实点击行为
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT_DIR = path.resolve("test-results", "night-watch");
const PROFILE = path.join(OUT_DIR, ".edge-profile-check");
const PORT = 9343;
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
const shot = async (call, name, clip) => {
  const s = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, ...(clip ? { clip } : {}) });
  await writeFile(path.join(OUT_DIR, name), Buffer.from(s.data, "base64"));
  console.log(`[复检] 截图 ${name}`);
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

  // ============ 1) 底部导航与滚动容器 ============
  out.navMeasurement = await evaluate(call, `(() => {
    const vh = window.innerHeight, vw = window.innerWidth;
    // 找底栏
    let nav = null;
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if ((cs.position === "fixed" || cs.position === "sticky") && r.height > 50 && r.width > vw * 0.7 && r.bottom > vh - 30) {
        if (!nav || r.height > nav.getBoundingClientRect().height) nav = el;
      }
    }
    const navRect = nav ? nav.getBoundingClientRect() : null;
    // 找主滚动容器
    const scrollers = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const cs = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 4 && (cs.overflowY === "auto" || cs.overflowY === "scroll")) {
        const r = el.getBoundingClientRect();
        scrollers.push({
          tag: el.tagName.toLowerCase(),
          cls: (typeof el.className === "string" ? el.className : "").split(/\\s+/).slice(0, 3).join("."),
          clientH: el.clientHeight, scrollH: el.scrollHeight,
          paddingBottom: cs.paddingBottom,
          top: Math.round(r.top), bottom: Math.round(r.bottom),
          distanceToNav: navRect ? Math.round(navRect.top - r.bottom) : null,
          navOverlapsIt: navRect ? Math.round(r.bottom - navRect.top) : null,
        });
      }
    }
    return {
      viewport: vw + "x" + vh,
      nav: navRect ? { top: Math.round(navRect.top), height: Math.round(navRect.height), bottom: Math.round(navRect.bottom), text: (nav.textContent||"").trim().slice(0,30), position: getComputedStyle(nav).position } : null,
      navBottomVsViewport: navRect ? Math.round(navRect.bottom - vh) : null,
      scrollers,
    };
  })()`);

  // 滚到底，看最后一张卡片与导航的关系
  await evaluate(call, `(() => {
    const el = Array.from(document.querySelectorAll("body *")).find(e => e.scrollHeight > e.clientHeight + 4 && (getComputedStyle(e).overflowY === "auto" || getComputedStyle(e).overflowY === "scroll"));
    if (el) el.scrollTop = el.scrollHeight; else window.scrollTo(0, document.body.scrollHeight);
    return "ok";
  })()`);
  await sleep(2500);

  out.lastCard = await evaluate(call, `(() => {
    const vh = window.innerHeight, vw = window.innerWidth;
    let nav = null;
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      if ((cs.position === "fixed" || cs.position === "sticky") && r.height > 50 && r.width > vw * 0.7 && r.bottom > vh - 30) {
        if (!nav || r.height > nav.getBoundingClientRect().height) nav = el;
      }
    }
    const navTop = nav ? nav.getBoundingClientRect().top : vh;
    // 找最后一张内容卡片：含"上一次记下"或"记下"的块
    const cards = Array.from(document.querySelectorAll("div, article, li, section")).filter(el => {
      const t = (el.textContent || "");
      const r = el.getBoundingClientRect();
      return /上一次记下/.test(t) && r.height > 40 && r.width > vw * 0.6;
    });
    const card = cards.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    if (!card) return { found: false };
    const cr = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    // 卡片内文本与箭头的位置
    const inner = [];
    for (const el of Array.from(card.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const t = (el.textContent || "").trim();
      if (!t && el.tagName !== "SVG") continue;
      const ecs = getComputedStyle(el);
      inner.push({
        tag: el.tagName.toLowerCase(),
        text: t.slice(0, 30),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        textAlign: ecs.textAlign,
        position: ecs.position,
        fontSize: ecs.fontSize,
        lineHeight: ecs.lineHeight,
        overflow: ecs.overflow,
      });
    }
    return {
      found: true,
      card: { rect: [Math.round(cr.left), Math.round(cr.top), Math.round(cr.width), Math.round(cr.height)], bottom: Math.round(cr.bottom), height: Math.round(cr.height), overflow: cs.overflow, display: cs.display },
      navTop: Math.round(navTop),
      cardBehindNav: Math.round(cr.bottom - navTop),
      cardHeightVsViewport: Math.round(cr.height / vh * 100) + "%",
      inner: inner.slice(0, 14),
    };
  })()`);

  const last = out.lastCard;
  if (last && last.found && last.card) {
    await shot(call, "check-mobile-lastcard.png", {
      x: last.card.rect[0], y: Math.max(0, last.card.rect[1] - 10),
      width: last.card.rect[2], height: Math.min(844 - Math.max(0, last.card.rect[1] - 10), last.card.rect[3] + 20), scale: 2,
    });
  }

  // ============ 2) 语音按钮真实交互 ============
  await evaluate(call, `(() => { const el = Array.from(document.querySelectorAll("body *")).find(e => e.scrollHeight > e.clientHeight + 4 && (getComputedStyle(e).overflowY === "auto" || getComputedStyle(e).overflowY === "scroll")); if (el) el.scrollTop = 0; else window.scrollTo(0,0); return "ok"; })()`);
  await sleep(1500);

  const voiceBefore = await evaluate(call, `(() => {
    const el = Array.from(document.querySelectorAll("button, [role=button]")).find(e => /说给拾念听|开始口述/.test((e.getAttribute("aria-label")||"") + (e.textContent||"")));
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], aria: el.getAttribute("aria-label"), disabled: el.disabled, innerText: (el.textContent||"").trim() };
  })()`);
  out.voiceBefore = voiceBefore;

  out.voiceAfterClick = await evaluate(call, `(async () => {
    const el = Array.from(document.querySelectorAll("button, [role=button]")).find(e => /说给拾念听|开始口述/.test((e.getAttribute("aria-label")||"") + (e.textContent||"")));
    if (!el) return { found: false };
    const before = { aria: el.getAttribute("aria-label"), text: (el.textContent||"").trim() };
    el.click();
    await new Promise(r => setTimeout(r, 2500));
    const el2 = Array.from(document.querySelectorAll("button, [role=button]")).find(e => /说给拾念听|开始口述|聆听|停止|结束/.test((e.getAttribute("aria-label")||"") + (e.textContent||"")));
    const alerts = Array.from(document.querySelectorAll("[role=alert]")).map(a => (a.textContent||"").trim().slice(0, 60));
    return {
      before,
      afterAria: el2 ? el2.getAttribute("aria-label") : null,
      afterText: el2 ? (el2.textContent||"").trim() : null,
      stateChanged: el2 ? (el2.getAttribute("aria-label") !== before.aria || (el2.textContent||"").trim() !== before.text) : false,
      alerts,
      supportsSpeech: typeof window.SpeechRecognition !== "undefined" || typeof window.webkitSpeechRecognition !== "undefined",
      // 是否出现权限请求/错误提示
      pageMentions: /麦克风|权限|允许|浏览器不支持/.test(document.body.innerText) ? document.body.innerText.match(/.{0,40}(麦克风|权限|允许|浏览器不支持).{0,40}/g)?.slice(0,3) : null,
    };
  })()`);
  await sleep(1200);
  await shot(call, "check-mobile-voice-after-click.png");

  // ============ 3) 桌面端语音按钮与保存区 ============
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: `${origin}/workspace` });
  await sleep(6000);
  out.desktopVoice = await evaluate(call, `(() => {
    const el = Array.from(document.querySelectorAll("button, [role=button]")).find(e => /说给拾念听|开始口述/.test((e.getAttribute("aria-label")||"") + (e.textContent||"")));
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { found: true, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], bg: cs.backgroundColor, border: cs.border, cursor: cs.cursor, aria: el.getAttribute("aria-label") };
  })()`);
  // 桌面端"记下"按钮
  out.desktopSave = await evaluate(call, `(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").trim().includes("记下"));
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect(); const cs = getComputedStyle(btn);
    return { found: true, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], bg: cs.backgroundColor, opacity: cs.opacity, disabled: btn.disabled };
  })()`);

  await writeFile(path.join(OUT_DIR, "check-findings.json"), JSON.stringify({ at: new Date().toISOString(), out }, null, 2));
} finally {
  socket.close();
  edge.kill();
}

console.log("\n===== 定点复检结论 =====");
console.log(JSON.stringify(out, null, 2));
