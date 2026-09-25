/**
 * 夜间监工 · 最终验证（只读）
 * 1) `.last-thought` 是否真的没有 CSS（对比计算样式）
 * 2) 手机端底部导航的精确几何
 * 3) 右上角图标组
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT_DIR = path.resolve("test-results", "night-watch");
const PROFILE = path.join(OUT_DIR, ".edge-profile-final");
const PORT = 9344;
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
  if (!values.APP_ORIGIN) throw new Error("缺少 APP_ORIGIN：请在 .env.local 中配置本地地址。");
  return {
    email: values.OWNER_EMAIL,
    password: values.OWNER_PASSWORD || values.OWNER_INITIAL_PASSWORD,
    origin: values.APP_ORIGIN.replace(/\/+$/, ""),
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
  console.log(`[验证] 截图 ${name}`);
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

  // ============ 1) .last-thought 计算样式 ============
  out.lastThought = await evaluate(call, `(() => {
    const el = document.querySelector(".last-thought");
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const spans = Array.from(el.querySelectorAll("span")).map(s => {
      const sr = s.getBoundingClientRect();
      const scs = getComputedStyle(s);
      return { text: (s.textContent||"").trim().slice(0,24), rect: [Math.round(sr.left), Math.round(sr.top), Math.round(sr.width), Math.round(sr.height)], display: scs.display, fontSize: scs.fontSize, fontWeight: scs.fontWeight };
    });
    const parent = el.parentElement;
    const pcs = getComputedStyle(parent);
    return {
      found: true,
      className: el.className,
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      computed: {
        display: cs.display, flexDirection: cs.flexDirection, alignItems: cs.alignItems, justifyContent: cs.justifyContent,
        gap: cs.gap, padding: cs.padding, background: cs.background.slice(0, 80), borderRadius: cs.borderRadius,
        color: cs.color, fontSize: cs.fontSize, textAlign: cs.textAlign, width: cs.width, height: cs.height, border: cs.border,
      },
      // 若该类无 CSS，这些属性会是与父级一致的默认值
      parentComputed: { textAlign: pcs.textAlign, fontSize: pcs.fontSize, color: pcs.color },
      inheritedFromParent: { textAlign: cs.textAlign === pcs.textAlign, fontSize: cs.fontSize === pcs.fontSize, color: cs.color === pcs.color },
      spans,
      // 直接检查样式表里有没有这条规则
      ruleFound: (() => {
        let found = [];
        for (const sheet of Array.from(document.styleSheets)) {
          let rules; try { rules = sheet.cssRules; } catch { continue; }
          for (const rule of Array.from(rules || [])) {
            if (rule.selectorText && rule.selectorText.includes("last-thought")) found.push(rule.selectorText + " {" + rule.style.cssText.slice(0, 120) + "}");
          }
        }
        return found;
      })(),
    };
  })()`);

  // 滚到底截取这张卡片
  await evaluate(call, `(() => {
    const el = document.querySelector(".last-thought");
    if (el) el.scrollIntoView({ block: "center" });
    return "ok";
  })()`);
  await sleep(1500);
  const lc = out.lastThought;
  if (lc.found) {
    await shot(call, "final-last-thought.png", {
      x: Math.max(0, lc.rect[0] - 8), y: Math.max(0, lc.rect[1] - 12),
      width: lc.rect[2] + 16, height: lc.rect[3] + 24, scale: 2,
    });
  }

  // ============ 2) 底部导航几何（放宽条件）============
  out.bottomNav = await evaluate(call, `(() => {
    const vh = window.innerHeight, vw = window.innerWidth;
    const fixedEls = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      const r = el.getBoundingClientRect();
      if (r.height < 30 || r.width < 100) continue;
      fixedEls.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === "string" ? el.className : "").split(/\\s+/).slice(0,3).join("."),
        pos: cs.position,
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        bottomVsVh: Math.round(r.bottom - vh),
        zIndex: cs.zIndex,
        text: (el.textContent||"").trim().slice(0,30),
      });
    }
    // 主滚动容器
    const scroller = Array.from(document.querySelectorAll("body *")).find(el => {
      const cs = getComputedStyle(el);
      return el.scrollHeight > el.clientHeight + 4 && (cs.overflowY === "auto" || cs.overflowY === "scroll");
    });
    let scrollerInfo = null;
    if (scroller) {
      const cs = getComputedStyle(scroller);
      const r = scroller.getBoundingClientRect();
      scrollerInfo = {
        cls: (typeof scroller.className === "string" ? scroller.className : "").split(/\\s+/).slice(0,3).join("."),
        clientH: scroller.clientHeight, scrollH: scroller.scrollHeight,
        paddingBottom: cs.paddingBottom,
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        maxScroll: scroller.scrollHeight - scroller.clientHeight,
      };
      scroller.scrollTop = scroller.scrollHeight;
    }
    return { viewport: vw + "x" + vh, fixedEls, scroller: scrollerInfo };
  })()`);

  await sleep(2500);
  // 滚到底后，最后元素与导航的关系
  out.afterScrollBottom = await evaluate(call, `(() => {
    const vh = window.innerHeight;
    const nav = Array.from(document.querySelectorAll("body *")).find(el => {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      return (cs.position === "fixed" || cs.position === "sticky") && r.height > 30 && r.bottom > vh - 30 && r.width > window.innerWidth * 0.7;
    });
    const navTop = nav ? nav.getBoundingClientRect().top : null;
    const scroller = Array.from(document.querySelectorAll("body *")).find(el => {
      const cs = getComputedStyle(el);
      return el.scrollHeight > el.clientHeight + 4 && (cs.overflowY === "auto" || cs.overflowY === "scroll");
    });
    if (!scroller) return { navTop: navTop ? Math.round(navTop) : null, noScroller: true };
    // 滚动容器里最后一个可见子元素的底边
    const kids = Array.from(scroller.querySelectorAll("*")).map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height > 8 && r.width > 8 && r.bottom <= vh + 4);
    const last = kids.sort((a, b) => b.r.bottom - a.r.bottom)[0];
    return {
      navTop: navTop ? Math.round(navTop) : null,
      scrollerBottom: Math.round(scroller.getBoundingClientRect().bottom),
      scrollerPaddingBottom: getComputedStyle(scroller).paddingBottom,
      lastChild: last ? {
        tag: last.el.tagName.toLowerCase(),
        cls: (typeof last.el.className === "string" ? last.el.className : "").split(/\\s+/).slice(0,2).join("."),
        text: (last.el.textContent||"").trim().slice(0, 30),
        bottom: Math.round(last.r.bottom),
        hiddenBehindNav: navTop ? Math.round(last.r.bottom - navTop) : null,
        clippedByScroller: Math.round(last.r.bottom - scroller.getBoundingClientRect().bottom),
      } : null,
    };
  })()`);
  await shot(call, "final-mobile-scrolled-bottom.png");

  // ============ 3) 右上角图标 ============
  out.topRight = await evaluate(call, `(() => {
    const vw = window.innerWidth;
    const out = [];
    for (const el of Array.from(document.querySelectorAll("button, a, [role=button]"))) {
      const r = el.getBoundingClientRect();
      if (r.top > 80 || r.left < vw * 0.6 || r.width < 1) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        aria: el.getAttribute("aria-label"),
        title: el.getAttribute("title"),
        text: (el.textContent||"").trim().slice(0,20),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        visible: r.width > 0 && r.height > 0,
      });
    }
    return out;
  })()`);
  await shot(call, "final-mobile-topright.png", { x: 240, y: 0, width: 150, height: 70, scale: 4 });

  await writeFile(path.join(OUT_DIR, "final-findings.json"), JSON.stringify({ at: new Date().toISOString(), out }, null, 2));
} finally {
  socket.close();
  edge.kill();
}

console.log("\n===== 最终验证 =====");
console.log(JSON.stringify(out, null, 2));
