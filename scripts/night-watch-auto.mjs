/**
 * 夜间监工 · 自动化入口（只读）
 *
 * 每次运行：真实登录线上站 → 手机端与桌面端各截一批图 → 检测几何问题
 * → 与上一次报告对比，只输出"新增"的问题（避免每晚重复念同样的清单）。
 *
 * 只读：不写数据库、不改线上、不改源码。
 * 落盘位置：test-results/night-watch/
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT_DIR = path.resolve("test-results", "night-watch");
const PROFILE = path.join(OUT_DIR, ".edge-profile-auto");
const HISTORY = path.join(OUT_DIR, "history.json");
// 端口随机化：定时任务和手动运行可能同时开跑，固定端口会撞车（"Edge 端口未就绪"）。
const PORT = 9400 + Math.floor(Math.random() * 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadCredentials() {
  const originIndex = process.argv.indexOf("--origin");
  const overrideOrigin = originIndex >= 0 ? process.argv[originIndex + 1] : null;
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
  if (!values.OWNER_EMAIL || !(values.OWNER_PASSWORD || values.OWNER_INITIAL_PASSWORD)) {
    throw new Error("缺少 OWNER_EMAIL / OWNER_PASSWORD");
  }
  if (!overrideOrigin && !values.APP_ORIGIN) throw new Error("缺少 APP_ORIGIN：请在 .env.local 中配置本地地址。");
  return {
    email: values.OWNER_EMAIL,
    password: values.OWNER_PASSWORD || values.OWNER_INITIAL_PASSWORD,
    // 支持 --origin 覆盖，用于在发布前先验证本地改动（本地库用的是同一套账号）
    origin: (overrideOrigin || values.APP_ORIGIN).replace(/\/+$/, ""),
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

/** 带重试的导航：CDP 的 Page.navigate 偶发超时（冷启动/动效卡顿），重试一次再放弃。 */
async function navigate(call, url, attempts = 2) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await call("Page.navigate", { url });
      return;
    } catch (error) {
      lastError = error;
      await sleep(2000);
    }
  }
  throw new Error(`导航失败（重试 ${attempts} 次）：${url} — ${lastError?.message ?? lastError}`);
}

/** 页面内几何检测 */
const PROBE = `(() => {
  const issues = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  if (document.documentElement.scrollWidth > vw + 2) {
    issues.push({ kind: "horizontal-overflow", severity: "high", key: "horizontal-overflow", detail: "横向溢出：文档 " + document.documentElement.scrollWidth + " > 视口 " + vw });
  }
  // 无样式卡片检测：有 class 但无匹配 CSS 规则的关键组件
  for (const cls of ["last-thought"]) {
    const el = document.querySelector("." + cls);
    if (!el) continue;
    const cs = getComputedStyle(el);
    const unstyled = cs.padding === "0px" && cs.borderRadius === "0px" && cs.backgroundColor === "rgba(0, 0, 0, 0)" && cs.borderWidth === "0px";
    if (unstyled) {
      issues.push({ kind: "unstyled-component", severity: "high", key: "unstyled-" + cls, detail: "." + cls + " 无任何样式（padding/border-radius/background/border 全为 0）" });
    }
  }
  // 底部导航遮挡：主滚动容器底部留白是否够
  const scroller = Array.from(document.querySelectorAll("body *")).find(el => {
    const cs = getComputedStyle(el);
    return el.scrollHeight > el.clientHeight + 4 && (cs.overflowY === "auto" || cs.overflowY === "scroll");
  });
  if (scroller) {
    const sr = scroller.getBoundingClientRect();
    const cs = getComputedStyle(scroller);
    const pb = parseFloat(cs.paddingBottom) || 0;
    const roomBelow = vh - sr.bottom + pb;
    if (roomBelow < 24 && sr.bottom > vh - 80) {
      issues.push({ kind: "content-under-nav", severity: "high", key: "content-under-nav", detail: "滚动容器底部距视口仅 " + Math.round(roomBelow) + "px 余量，底部导航会压住最后一行内容" });
    }
  }
  // 语音按钮失败态：点击后无状态变化（这条只在被显式触发时才有意义，此处记录按钮存在性）
  const voice = Array.from(document.querySelectorAll("button, [role=button]")).find(e => /说给拾念听|开始口述/.test((e.getAttribute("aria-label")||"") + (e.textContent||"")));
  if (voice) {
    const cs = getComputedStyle(voice);
    const r = voice.getBoundingClientRect();
    if (r.height < 44) {
      issues.push({ kind: "tap-target-small", severity: "medium", key: "voice-small", detail: "语音按钮高 " + Math.round(r.height) + "px（<44px）" });
    }
    if (cs.cursor !== "pointer" && !voice.disabled) {
      issues.push({ kind: "no-pointer-cursor", severity: "low", key: "voice-cursor", detail: "语音按钮 cursor 不是 pointer，用户不确定能否点击" });
    }
  }
  // 小可点区域
  for (const el of Array.from(document.querySelectorAll("button, a[href]"))) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.height < 24) {
      const t = (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 18);
      if (!t) continue;
      issues.push({ kind: "tap-target-small", severity: "medium", key: "small-" + t.slice(0,10), detail: '"' + t + '" 可点高 ' + Math.round(r.height) + "px" });
    }
  }
  return { url: location.pathname, viewport: vw + "x" + vh, issues };
})()`;

await mkdir(OUT_DIR, { recursive: true });
const { email, password, origin } = await loadCredentials();
const { edge, socket, call } = await connect(PORT, PROFILE);
const run = { at: new Date().toISOString(), origin, screens: [], errors: [] };

try {
  await call("Page.enable");
  await call("Runtime.enable");

  // 先预热：免费体验版 MinNum=0，冷启动首次请求可能 20s 以上，
  // 而 Page.navigate 的等待窗口有限，会直接判为"未就绪"。
  // 先连续请求几次把容器唤醒，再开始正式巡检。
  console.log(`[夜间监工] 预热 ${origin} …`);
  const warm = await fetch(origin + "/", { signal: AbortSignal.timeout(90000) }).catch(() => null);
  console.log(`[夜间监工] 预热返回 HTTP ${warm ? warm.status : "超时/失败"}`);

  for (const round of [
    { label: "mobile", width: 390, height: 844, mobile: true },
    { label: "desktop", width: 1440, height: 900, mobile: false },
  ]) {
    await call("Emulation.setDeviceMetricsOverride", {
      width: round.width, height: round.height, deviceScaleFactor: round.mobile ? 2 : 1, mobile: round.mobile,
    });
    await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });

    // 过访问提示 + 登录（同一 profile 会复用 cookie）
    await navigate(call, `${origin}/`);
    await sleep(3500);
    await evaluate(call, `(() => { const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent && x.textContent.includes("确定访问")); if (b) b.click(); return "ok"; })()`);
    await sleep(3500);
    await navigate(call, `${origin}/workspace`);
    await sleep(4000);
    const loginState = await evaluate(call, `(async () => {
      const inputs = Array.from(document.querySelectorAll("input"));
      const e = inputs.find(i => i.type === "email"); const p = inputs.find(i => i.type === "password");
      if (!e || !p) return "already-in";
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value"); d.set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
      set(e, ${JSON.stringify(email)}); set(p, ${JSON.stringify(password)});
      Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").includes("进入我的空间"))?.click();
      return "submitted";
    })()`);
    await sleep(7000);

    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    for (const route of ["", "/workspace"]) {
      const label = route === "" ? "landing" : "workspace";
      const name = `auto-${round.label}-${label}.png`;
      if (route) {
        await navigate(call, `${origin}${route}`);
        await sleep(5000);
      }
      // 确认页面真的载入了本应用，否则这张"截图"毫无意义，直接记为失败
      const title = await evaluate(call, `document.title || ""`);
      if (!title || !/拾念|echo/i.test(title + (await evaluate(call, `location.pathname`)))) {
        throw new Error(`页面标题不对：${route || "/"}（title="${title}"）`);
      }
      // 等应用真正就绪：记录页看输入框，落地页看标题文案。
      // 冷启动（免费版 MinNum=0）首次请求可能 20s 以上，这里给足等待。
      let ready = false;
      for (let i = 0; i < 40; i += 1) {
        ready = await evaluate(call, `(() => {
          if (document.querySelector("textarea")) return true;
          const t = document.body.innerText || "";
          if (/回声屿|上一次记下|此刻，想记下什么/.test(t)) return true;
          if (/给念头一点柔和的光|一闪，便有回响|私人灵感空间|先看看界面预览/.test(t)) return true;
          // 登录页也算就绪（未登录时看到的是它，同样值得巡检）
          if (/回到你的灵感空间|进入我的空间/.test(t)) return true;
          return false;
        })()`);
        if (ready) break;
        await sleep(1500);
      }
      if (!ready) throw new Error(`应用未就绪（仍停在加载态）：${route || "/"}`);

      const s = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(path.join(OUT_DIR, name), Buffer.from(s.data, "base64"));
      // 同时留一份带时间戳的存档，便于做视频时间线
      await mkdir(path.join(OUT_DIR, "archive"), { recursive: true });
      await writeFile(path.join(OUT_DIR, "archive", `${stamp}-${round.label}-${label}.png`), Buffer.from(s.data, "base64")).catch(() => {});
      const probe = await evaluate(call, PROBE);
      run.screens.push({ round: round.label, screen: name, login: loginState, ...(probe ?? {}) });
    }
  }
} catch (error) {
  run.errors.push(String(error && error.message ? error.message : error));
} finally {
  socket.close();
  edge.kill();
}

// ---------- 与上次对比，只报新增 ----------
// 重要：如果这一轮压根没截到图（导航失败、登录失败等），绝不能宣布"问题已修复"——
// 那只是没测到，不是修好了。下面用一个"本次是否真的测了"的门槛挡住这类假阳性。
const testedScreens = run.screens.filter((s) => s && s.viewport);
const didTest = testedScreens.length > 0 && run.errors.length === 0;

let previous = null;
try {
  const history = JSON.parse(await readFile(HISTORY, "utf8"));
  previous = history.at(-1) ?? null;
} catch { /* 首次运行 */ }

const current = new Set();
for (const screen of testedScreens) for (const i of screen.issues ?? []) current.add(i.key || i.kind);
const previousKeys = previous ? new Set(previous.keys) : new Set();
const added = didTest ? [...current].filter((k) => !previousKeys.has(k)) : [];
const resolved = didTest ? [...previousKeys].filter((k) => !current.has(k)) : [];

const allIssues = [];
for (const screen of testedScreens) for (const i of screen.issues ?? []) allIssues.push({ screen: screen.screen, ...i });

run.didTest = didTest;
run.newIssues = added;
run.resolvedIssues = resolved;
run.allIssues = allIssues;

// 写入历史：只在真的测到时才记，否则会污染基线
let history = [];
try { history = JSON.parse(await readFile(HISTORY, "utf8")); } catch { /* 首次 */ }
if (didTest) {
  history.push({ at: run.at, keys: [...current], counts: { high: allIssues.filter(i=>i.severity==="high").length, medium: allIssues.filter(i=>i.severity==="medium").length } });
  if (history.length > 60) history = history.slice(-60);
  await writeFile(HISTORY, JSON.stringify(history, null, 2));
}

await writeFile(path.join(OUT_DIR, "auto-run.json"), JSON.stringify(run, null, 2));

const high = allIssues.filter((i) => i.severity === "high");
const medium = allIssues.filter((i) => i.severity === "medium");

const lines = [];
lines.push(`# 夜间监工自动巡检（${run.at}）`, "");
if (run.errors.length) { lines.push("## 运行异常"); lines.push(...run.errors.map(e => `- ${e}`), ""); }
if (!didTest) {
  lines.push("## ⚠️ 本轮没有取到有效截图，无法判断问题状态", "");
  lines.push("上面的「已修复 / 新增」在本次**不成立**（没测到 ≠ 修好了）。请先解决运行异常再重跑。", "");
} else {
  lines.push(`## 当前问题：严重 ${high.length} / 中等 ${medium.length}`, "");
  if (added.length) { lines.push("### 🆕 本次新增"); lines.push(...added.map(k => `- ${k}`), ""); }
  if (resolved.length) { lines.push("### ✅ 本次已修复"); lines.push(...resolved.map(k => `- ${k}`), ""); }
  if (high.length) { lines.push("### 严重"); lines.push(...high.map(i => `- [${i.screen}] ${i.detail}`), ""); }
  if (medium.length) { lines.push("### 中等"); lines.push(...medium.map(i => `- [${i.screen}] ${i.detail}`), ""); }
}
await mkdir(path.join(OUT_DIR, "archive"), { recursive: true });
await writeFile(path.join(OUT_DIR, "auto-report.md"), lines.join("\n"));

console.log(lines.join("\n"));
