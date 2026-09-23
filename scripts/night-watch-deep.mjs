/**
 * 夜间监工 · 深挖（只读 + 真实交互）
 *
 * 走一遍真实用户流程：输入念头 → 保存 → 观察语音按钮 → 检查资料库，
 * 并对可疑区域做元素级放大截图，方便肉眼判断。
 *
 * 用法：node scripts/night-watch-deep.mjs
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT_DIR = path.resolve("test-results", "night-watch");
const PROFILE = path.join(OUT_DIR, ".edge-profile-deep");
const PORT = 9342;

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
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时 ${method}`)); }, 30000);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { edge, socket, call };
}

const evaluate = async (call, expr) => {
  const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error("页面异常: " + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails));
  return r.result?.value;
};

const shot = async (call, name) => {
  const s = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(OUT_DIR, name), Buffer.from(s.data, "base64"));
  console.log(`[深挖] 截图 ${name}`);
};

/** 截取某个元素区域（自动放大到指定宽度便于肉眼判断） */
const shotElement = async (call, name, selectorJs, targetWidth = 900) => {
  const box = await evaluate(call, `(() => {
    const el = ${selectorJs};
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const pad = 12;
    return { x: Math.max(0, r.left - pad), y: Math.max(0, r.top - pad), width: r.width + pad * 2, height: r.height + pad * 2 };
  })()`);
  if (!box) { console.log(`[深挖] 跳过 ${name}（元素未找到）`); return null; }
  await sleep(600);
  const scale = Math.min(4, Math.max(1, targetWidth / box.width));
  const s = await call("Page.captureScreenshot", {
    format: "png",
    clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale },
  });
  await writeFile(path.join(OUT_DIR, name), Buffer.from(s.data, "base64"));
  console.log(`[深挖] 元素截图 ${name} (${Math.round(box.width)}×${Math.round(box.height)} @${scale.toFixed(1)}x)`);
  return box;
};

await mkdir(OUT_DIR, { recursive: true });
const { email, password, origin } = await loadCredentials();
const { edge, socket, call } = await connect(PORT, PROFILE);
const findings = [];

try {
  await call("Page.enable");
  await call("Runtime.enable");

  // ---------- 手机端 ----------
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });

  await call("Page.navigate", { url: `${origin}/` });
  await sleep(3500);
  await evaluate(call, `(() => { const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent && x.textContent.includes("确定访问")); if (b) b.click(); return "ok"; })()`);
  await sleep(4000);

  await call("Page.navigate", { url: `${origin}/workspace` });
  await sleep(4000);
  const login = await evaluate(call, `(async () => {
    const inputs = Array.from(document.querySelectorAll("input"));
    const e = inputs.find(i => i.type === "email");
    const p = inputs.find(i => i.type === "password");
    if (!e || !p) return "already-in";
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value"); d.set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    set(e, ${JSON.stringify(email)});
    set(p, ${JSON.stringify(password)});
    const btn = Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").includes("进入我的空间"));
    if (!btn) return "no-submit";
    btn.click();
    return "submitted";
  })()`);
  console.log("[深挖] 登录:", login);
  await sleep(7000);

  // --- 顶部右上角：那个看起来像 "8:" 的图标 ---
  findings.push({ area: "顶部右上角图标", data: await evaluate(call, `(() => {
    const header = document.querySelector("header") || document.body;
    const out = [];
    for (const el of Array.from(header.querySelectorAll("button, a, svg, [role=button]"))) {
      const r = el.getBoundingClientRect();
      if (r.top > 90 || r.width < 1) continue;
      const cs = getComputedStyle(el);
      out.push({
        tag: el.tagName.toLowerCase(),
        aria: el.getAttribute("aria-label"),
        text: (el.textContent || "").trim().slice(0, 20),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        fontSize: cs.fontSize,
        color: cs.color,
      });
    }
    return out;
  })()`) });
  await shotElement(call, "zoom-mobile-topright.png", `document.querySelector("header, body").querySelector("button[aria-label*='同步'], button[aria-label*='设置'], svg")`, 700);

  // --- 底部导航与正文遮挡关系 ---
  findings.push({ area: "底部导航遮挡", data: await evaluate(call, `(() => {
    const vh = window.innerHeight;
    const fixed = Array.from(document.querySelectorAll("body *")).filter(el => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return (cs.position === "fixed" || cs.position === "sticky") && r.height > 40 && r.bottom > vh - 4 && r.width > window.innerWidth * 0.6;
    });
    const nav = fixed.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    if (!nav) return { hasNav: false };
    const nr = nav.getBoundingClientRect();
    // 找出滚动容器与内容底部留白
    const scrollers = Array.from(document.querySelectorAll("body *")).filter(el => {
      const cs = getComputedStyle(el);
      return el.scrollHeight > el.clientHeight + 4 && (cs.overflowY === "auto" || cs.overflowY === "scroll");
    }).map(el => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === "string" ? el.className : "").split(/\\s+/).slice(0, 2).join("."),
        clientH: el.clientHeight, scrollH: el.scrollHeight,
        paddingBottom: cs.paddingBottom,
        scrollBottom: Math.round(r.bottom),
        gapUnderNav: Math.round(nr.top - r.bottom),
      };
    });
    return {
      hasNav: true,
      nav: { top: Math.round(nr.top), height: Math.round(nr.height), bottom: Math.round(nr.bottom) },
      innerHeight: vh,
      navBeyondViewport: Math.round(nr.bottom - vh),
      navLabel: (nav.textContent || "").trim().slice(0, 40),
      scrollers,
    };
  })()`) });

  // --- 语音按钮（用户说不好用） ---
  findings.push({ area: "语音按钮", data: await evaluate(call, `(() => {
    const cands = Array.from(document.querySelectorAll("button, [role=button]")).filter(el => {
      const a = (el.getAttribute("aria-label") || "") + (el.textContent || "");
      return /语音|说给|聆听|录音|mic|voice/i.test(a);
    });
    return cands.map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = (cx > 0 && cy > 0 && cx < innerWidth && cy < innerHeight) ? document.elementFromPoint(cx, cy) : null;
      return {
        aria: el.getAttribute("aria-label"),
        text: (el.textContent || "").trim().slice(0, 30),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        role: el.tagName.toLowerCase(),
        coveredBy: top && top !== el && !el.contains(top) && !top.contains(el)
          ? top.tagName.toLowerCase() + "." + (typeof top.className === "string" ? top.className.split(/\\s+/)[0] : "")
          : null,
        bg: cs.backgroundColor,
        radius: cs.borderRadius,
        hasSpeechRecognition: typeof window.SpeechRecognition !== "undefined" || typeof window.webkitSpeechRecognition !== "undefined",
      };
    });
  })()`) });

  await shotElement(call, "zoom-mobile-voice-button.png", `Array.from(document.querySelectorAll("button, [role=button]")).find(el => /说给|聆听|语音/.test((el.getAttribute("aria-label")||"") + (el.textContent||"")))`, 800);

  // --- 保存区与"记下"按钮 ---
  findings.push({ area: "保存区布局", data: await evaluate(call, `(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").trim().includes("记下"));
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    const cs = getComputedStyle(btn);
    const parent = btn.parentElement;
    const pr = parent.getBoundingClientRect();
    const pcs = getComputedStyle(parent);
    const hint = Array.from(parent.querySelectorAll("*")).find(el => (el.textContent || "").includes("回声屿"));
    return {
      found: true,
      button: { text: (btn.textContent||"").trim(), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], disabled: btn.disabled, bg: cs.backgroundColor, opacity: cs.opacity, cursor: cs.cursor },
      parent: { rect: [Math.round(pr.left), Math.round(pr.top), Math.round(pr.width), Math.round(pr.height)], display: pcs.display, flexDirection: pcs.flexDirection, justify: pcs.justifyContent, align: pcs.alignItems, gap: pcs.gap, wrap: pcs.flexWrap },
      hintText: hint ? (hint.textContent || "").trim().slice(0, 40) : null,
      hintRect: hint ? (() => { const hr = hint.getBoundingClientRect(); return [Math.round(hr.left), Math.round(hr.top), Math.round(hr.width), Math.round(hr.height)]; })() : null,
      horizontalOverlap: hint ? (() => { const hr = hint.getBoundingClientRect(); return Math.round(Math.min(r.right, hr.right) - Math.max(r.left, hr.left)); })() : null,
    };
  })()`) });

  await shotElement(call, "zoom-mobile-save-area.png", `Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").trim().includes("记下"))?.parentElement`, 800);

  // --- 真实用户流程：打字 → 保存 ---
  const journey = await evaluate(call, `(async () => {
    const ta = document.querySelector("textarea");
    if (!ta) return { step: "no-textarea" };
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), "value");
    d.set.call(ta, "监工测试：今晚的月光很好，我想记住这一刻。");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 1200));
    const btn = Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").trim().includes("记下"));
    return { step: "typed", buttonDisabled: btn ? btn.disabled : null, buttonEnabled: btn ? !btn.disabled : null };
  })()`);
  findings.push({ area: "输入后按钮状态", data: journey });
  await sleep(1500);
  await shot(call, "journey-mobile-typed.png");

  // 真的点保存
  const saved = await evaluate(call, `(async () => {
    const btn = Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").trim().includes("记下"));
    if (!btn || btn.disabled) return { clicked: false, reason: btn ? "disabled" : "not-found" };
    btn.click();
    await new Promise(r => setTimeout(r, 4000));
    return { clicked: true, url: location.href, bodyHasNote: document.body.innerText.includes("月光很好") };
  })()`);
  findings.push({ area: "保存结果", data: saved });
  await shot(call, "journey-mobile-after-save.png");

  // 保存后滚动到底，检查底部是否被导航吃掉
  await evaluate(call, `(() => { const s = Array.from(document.querySelectorAll("body *")).find(el => el.scrollHeight > el.clientHeight + 4 && (getComputedStyle(el).overflowY === "auto" || getComputedStyle(el).overflowY === "scroll")); if (s) s.scrollTop = s.scrollHeight; else window.scrollTo(0, document.body.scrollHeight); return "scrolled"; })()`);
  await sleep(2500);
  await shot(call, "journey-mobile-scrolled-bottom.png");

  // --- 桌面端：同一批检查 ---
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: `${origin}/workspace` });
  await sleep(6000);
  await shot(call, "journey-desktop-workspace.png");

  findings.push({ area: "桌面端布局", data: await evaluate(call, `(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    // 横向溢出源
    const out = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right > vw + 2 || r.left < -2) out.push(el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.split(/\\s+/)[0] : "") + " L" + Math.round(r.left) + " R" + Math.round(r.right));
    }
    return { viewport: vw + "x" + vh, docScrollWidth: document.documentElement.scrollWidth, overflowCount: out.length, overflowers: out.slice(0, 8) };
  })()`) });

  // 左侧边栏文字是否被裁
  await shotElement(call, "zoom-desktop-sidebar.png", `document.querySelector("aside, nav")`, 500);

  await writeFile(path.join(OUT_DIR, "deep-findings.json"), JSON.stringify({ at: new Date().toISOString(), findings }, null, 2));
} finally {
  socket.close();
  edge.kill();
}

console.log("\n===== 深挖结论 =====");
console.log(JSON.stringify(findings, null, 2));
