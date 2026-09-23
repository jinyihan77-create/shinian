/**
 * 夜间监工（只读）
 *
 * 真实登录线上站，按桌面端 1440×900 与手机端 390×844 两组尺寸逐屏截图，
 * 并在页面内做几何检测：横向溢出、元素互相压盖、按钮是否歪斜/旋转、
 * 底部导航是否挡住正文、可点区域是否过小。
 *
 * 只读：不写数据库、不改线上、不改源码。只往 test-results/night-watch/ 落盘截图与报告。
 *
 * 用法：
 *   node scripts/night-watch.mjs            # 默认两轮（桌面+手机）
 *   node scripts/night-watch.mjs --round 2  # 只跑第 2 轮（手机端）
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT_DIR = path.resolve("test-results", "night-watch");
const PROFILE = path.join(OUT_DIR, ".edge-profile");
const PORT = 9341;
const DEFAULT_ORIGIN = "https://inspiration-echo-318255-10-1492602203.sh.run.tcloudbase.com";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 读取登录凭据（只从本机 .env 文件，绝不打印） ----------
async function loadCredentials() {
  const values = {};
  for (const file of [".env.local", ".env.tencent-owner.local"]) {
    let text;
    try {
      text = await readFile(path.resolve(file), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      // .env 里的值可能是 "带引号" 的，去掉外层引号再存
      const raw = m[2].trim();
      values[m[1]] = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
    }
  }
  const email = values.OWNER_EMAIL;
  const password = values.OWNER_PASSWORD || values.OWNER_INITIAL_PASSWORD;
  const origin = values.APP_ORIGIN || DEFAULT_ORIGIN;
  if (!email || !password) throw new Error("缺少 OWNER_EMAIL / OWNER_PASSWORD");
  return { email, password, origin: origin.replace(/\/+$/, "") };
}

// ---------- 页面内几何检测（注入到浏览器执行） ----------
const PROBE = `
(() => {
  const issues = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const docWidth = document.documentElement.scrollWidth;

  // 1) 横向溢出
  if (docWidth > vw + 2) {
    issues.push({
      kind: "horizontal-overflow",
      severity: "high",
      detail: "页面可横向滚动：文档宽 " + docWidth + "px > 视口 " + vw + "px",
    });
  }

  // 收集可见元素
  const all = Array.from(document.querySelectorAll("body *"));
  const visible = [];
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    visible.push({ el, r, cs });
  }

  // 2) 超出视口左右边界的元素（真正的溢出源）
  const overflowers = [];
  for (const { el, r } of visible) {
    if (r.right > vw + 2 || r.left < -2) {
      // 忽略纯装饰的、pointer-events none 的、以及 fixed 全屏背景
      if (getComputedStyle(el).pointerEvents === "none") continue;
      const tag = el.tagName.toLowerCase();
      const cls = (typeof el.className === "string" ? el.className : "").split(/\\s+/).slice(0, 3).join(".");
      overflowers.push(tag + (cls ? "." + cls : "") + "  L" + Math.round(r.left) + " R" + Math.round(r.right) + " W" + Math.round(r.width));
    }
  }
  if (overflowers.length) {
    issues.push({
      kind: "element-out-of-viewport",
      severity: "high",
      detail: overflowers.slice(0, 6).join(" | "),
      count: overflowers.length,
    });
  }

  // 3) 交互元素歪斜（旋转导致视觉上"斜掉"）
  for (const { el, cs } of visible) {
    const role = el.getAttribute("role");
    const isInteractive = role === "button" || el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "INPUT";
    if (!isInteractive) continue;
    const t = cs.transform;
    if (!t || t === "none") continue;
    const m = t.match(/matrix\\(([^)]+)\\)/);
    if (!m) continue;
    const parts = m[1].split(",").map(Number);
    if (parts.length < 4) continue;
    const [a, b, c, d] = parts;
    const skewX = Math.abs(a) > 1e-6 ? Math.atan2(b, a) * 180 / Math.PI : 0;
    const scaleY = Math.hypot(c, d);
    const tiltDeg = Math.abs(skewX) > 0.5 ? skewX : 0;
    const nonUniform = Math.abs(scaleY - 1) > 0.06 && Math.abs(Math.hypot(a, b) - 1) < 0.06;
    if (tiltDeg !== 0 || nonUniform) {
      const text = (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 18);
      issues.push({
        kind: "button-tilted",
        severity: "medium",
        detail: '"' + text + '" 旋转 ' + tiltDeg.toFixed(1) + '°' + (nonUniform ? ' 纵向缩放 ' + scaleY.toFixed(2) + 'x' : '') + ' — ' + t,
      });
    }
  }

  // 4) 底部导航遮挡正文
  const navCandidates = visible.filter(({ el, cs, r }) =>
    (cs.position === "fixed" || cs.position === "sticky") &&
    r.bottom > vh - 4 && r.height > 40 && r.width > vw * 0.6
  );
  if (navCandidates.length) {
    const nav = navCandidates.sort((x, y) => y.r.height - x.r.height)[0];
    const navTop = nav.r.top;
    // 找被导航压住的文本节点
    const covered = [];
    for (const { el, r } of visible) {
      if (nav.el === el || nav.el.contains(el) || el.contains(nav.el)) continue;
      if (getComputedStyle(el).pointerEvents === "none") continue;
      const text = (el.textContent || "").trim();
      if (!text || el.children.length > 0) continue; // 只看叶子文本节点
      // 文本块与导航区域相交，且被压住一半以上
      const overlap = Math.min(r.bottom, nav.r.bottom) - Math.max(r.top, navTop);
      if (overlap > r.height * 0.5 && r.top < navTop) {
        covered.push('"' + text.slice(0, 22) + '" 被压 ' + Math.round(overlap) + 'px');
      }
    }
    if (covered.length) {
      issues.push({
        kind: "nav-covers-content",
        severity: "high",
        detail: "底部导航顶部 y=" + Math.round(navTop) + "，" + covered.slice(0, 4).join(" | "),
        count: covered.length,
      });
    }
    // 内容区底部留白是否 ≥ 导航高度
    issues.push({
      kind: "measured-nav",
      severity: "info",
      detail: "底栏高 " + Math.round(nav.r.height) + "px，顶部 y=" + Math.round(navTop),
    });
  }

  // 5) 可点区域过小（手机端手指点不中）
  for (const { el, r } of visible) {
    const role = el.getAttribute("role");
    const isBtn = el.tagName === "BUTTON" || role === "button" || (el.tagName === "A" && el.getAttribute("href"));
    if (!isBtn) continue;
    if (r.width < 28 || r.height < 28) {
      const text = (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 16);
      issues.push({
        kind: "tap-target-small",
        severity: "medium",
        detail: '"' + text + '" 可点区 ' + Math.round(r.width) + "×" + Math.round(r.height) + "px",
      });
    }
  }

  // 6) 元素重叠（按钮被别的元素盖住）
  const btns = visible.filter(({ el }) => el.tagName === "BUTTON" || el.getAttribute("role") === "button");
  for (const { el, r } of btns.slice(0, 40)) {
    if (r.width < 2 || r.height < 2) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue;
    const top = document.elementFromPoint(cx, cy);
    if (!top) continue;
    if (top === el || el.contains(top) || top.contains(el)) continue;
    const topCs = getComputedStyle(top);
    if (topCs.pointerEvents === "none") continue;
    const text = (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 16);
    const topTag = top.tagName.toLowerCase() + (typeof top.className === "string" && top.className ? "." + top.className.split(/\\s+/)[0] : "");
    issues.push({
      kind: "button-covered",
      severity: "high",
      detail: '"' + text + '" 中心被 ' + topTag + " 覆盖（点不到）",
    });
  }

  return {
    url: location.pathname + location.hash,
    viewport: vw + "×" + vh,
    issues,
  };
})()
`;

// ---------- CDP 连接 ----------
async function connect() {
  const edge = spawn(EDGE, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });

  let target;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
      target = list.find((t) => t.type === "page");
      if (target) break;
    } catch {
      /* 还没起来 */
    }
  }
  if (!target) {
    edge.kill();
    throw new Error("Edge 调试端口未就绪");
  }

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
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP 超时: ${method}`));
      }, 30000);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return { edge, socket, call };
}

// ---------- 主流程 ----------
const rounds = {
  1: { label: "desktop", width: 1440, height: 900, mobile: false },
  2: { label: "mobile", width: 390, height: 844, mobile: true },
};

const requested = process.argv.includes("--round")
  ? [Number(process.argv[process.argv.indexOf("--round") + 1])]
  : [1, 2];

await mkdir(OUT_DIR, { recursive: true });
const { email, password, origin } = await loadCredentials();
const { edge, socket, call } = await connect();

const report = { at: new Date().toISOString(), origin, rounds: [], screens: [] };

try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Network.enable");

  for (const roundId of requested) {
    const round = rounds[roundId];
    if (!round) continue;

    await call("Emulation.setDeviceMetricsOverride", {
      width: round.width,
      height: round.height,
      deviceScaleFactor: 1,
      mobile: round.mobile,
    });
    await call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });

    // 每个尺寸先过一遍腾讯云访问提示（会存 cookie）
    await call("Page.navigate", { url: `${origin}/` });
    await sleep(3500);
    await call("Runtime.evaluate", {
      expression: `(() => { const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent && x.textContent.includes("确定访问")); if (b) { b.click(); return "gate-passed"; } return "no-gate"; })()`,
      awaitPromise: true,
    });
    await sleep(4000);

    // 真实登录
    await call("Page.navigate", { url: `${origin}/workspace` });
    await sleep(3500);
    const loginResult = await call("Runtime.evaluate", {
      expression: `(async () => {
        const inputs = Array.from(document.querySelectorAll("input"));
        const emailInput = inputs.find(i => i.type === "email" || (i.placeholder || "").includes("邮箱"));
        const pwInput = inputs.find(i => i.type === "password");
        if (!emailInput || !pwInput) return "no-login-form";
        const set = (el, v) => {
          const proto = Object.getPrototypeOf(el);
          const desc = Object.getOwnPropertyDescriptor(proto, "value");
          desc.set.call(el, v);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        set(emailInput, ${JSON.stringify(email)});
        set(pwInput, ${JSON.stringify(password)});
        const btn = Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").includes("进入我的空间"));
        if (!btn) return "no-submit";
        btn.click();
        return "submitted";
      })()`,
      awaitPromise: true,
    });
    report.rounds.push({ round: roundId, label: round.label, login: loginResult.result?.value });
    await sleep(6000);

    // 逐屏截图 + 检测
    const screens = ["", "/workspace"];
    for (const route of screens) {
      const name = `${round.label}-${route === "" ? "landing" : route.replace(/^\//, "").replace(/\//g, "-")}.png`;
      await call("Page.navigate", { url: `${origin}${route}` });
      await sleep(5000);
      const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(path.join(OUT_DIR, name), Buffer.from(shot.data, "base64"));

      const probe = await call("Runtime.evaluate", { expression: PROBE, returnByValue: true });
      report.screens.push({ round: round.label, screen: name, ...(probe.result?.value ?? {}) });
      console.log(`[夜间监工] ${name} 截图完成`);
    }

    // 工作区里的三个标签页
    for (const [tabLabel, tabMatch] of [["library", "资料"], ["tickets", "待办"], ["checkin", "打卡"]]) {
      const name = `${round.label}-workspace-${tabLabel}.png`;
      await call("Runtime.evaluate", {
        expression: `(() => { const b = Array.from(document.querySelectorAll("button")).find(x => (x.textContent || "").includes(${JSON.stringify(tabMatch)})); if (b) { b.click(); return "ok"; } return "not-found"; })()`,
        awaitPromise: true,
      });
      await sleep(3000);
      const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(path.join(OUT_DIR, name), Buffer.from(shot.data, "base64"));
      const probe = await call("Runtime.evaluate", { expression: PROBE, returnByValue: true });
      report.screens.push({ round: round.label, screen: name, ...(probe.result?.value ?? {}) });
      console.log(`[夜间监工] ${name} 截图完成`);
    }
  }
} finally {
  socket.close();
  edge.kill();
}

// ---------- 汇总 ----------
const summary = { high: [], medium: [], info: [] };
for (const screen of report.screens) {
  for (const issue of screen.issues ?? []) {
    const bucket = summary[issue.severity] ?? summary.info;
    bucket.push(`[${screen.round}/${screen.screen}] ${issue.kind}: ${issue.detail}`);
  }
}
report.summary = summary;

await writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

const lines = [];
lines.push(`# 夜间监工报告（${report.at}）`, "");
lines.push(`线上地址：${origin}`, "");
lines.push(`## 严重问题（${summary.high.length}）`);
lines.push(...(summary.high.length ? summary.high.map((s) => `- ${s}`) : ["- 无"]), "");
lines.push(`## 中等问题（${summary.medium.length}）`);
lines.push(...(summary.medium.length ? summary.medium.map((s) => `- ${s}`) : ["- 无"]), "");
lines.push(`## 量测信息（${summary.info.length}）`);
lines.push(...(summary.info.length ? summary.info.map((s) => `- ${s}`) : ["- 无"]), "");
await writeFile(path.join(OUT_DIR, "报告.md"), lines.join("\n"));

console.log("\n===== 夜间监工汇总 =====");
console.log(`严重 ${summary.high.length} / 中等 ${summary.medium.length}`);
for (const s of summary.high) console.log("  [严重]", s);
for (const s of summary.medium) console.log("  [中等]", s);
console.log(`\n截图与报告：${OUT_DIR}`);
