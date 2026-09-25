/**
 * 线上探针（工作区）：手机端输入框右侧按钮压不压字 + 各页真实可用性
 *
 * 只读，不改任何文件。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9562;

const PROBE_WORKSPACE = `(() => {
  const ta = document.querySelector("textarea");
  const out = { path: location.pathname, hasTextarea: !!ta };
  if (!ta) { out.bodyHead = (document.body.innerText||"").slice(0,200); return out; }
  const r = ta.getBoundingClientRect();
  const cs = getComputedStyle(ta);
  out.textarea = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  out.padding = { left: cs.paddingLeft, right: cs.paddingRight, top: cs.paddingTop };
  out.usableTextWidth = Math.round(r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  out.textRightBoundary = Math.round(r.width - parseFloat(cs.paddingRight));

  // 探针：沿输入框顶部一行，从 50% 到 98% 宽度处问"最上层是谁"
  const probes = [];
  for (const ratio of [0.5, 0.65, 0.8, 0.9, 0.96]) {
    const px = r.x + r.width * ratio, py = r.y + 22;
    const el = document.elementFromPoint(px, py);
    probes.push({
      ratio,
      pt: [Math.round(px), Math.round(py)],
      top: el ? (el.tagName + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).slice(0,2).join(".") : "")) : null,
      isTextarea: el === ta,
    });
  }
  out.probes = probes;

  // 找出所有与输入框矩形相交的浮层（可能是压在字上的按钮）
  const all = Array.from(document.querySelectorAll("button, a, span, div"));
  const overlapping = [];
  for (const el of all) {
    if (el === ta || el.contains(ta) || ta.contains(el)) continue;
    const er = el.getBoundingClientRect();
    if (er.width < 6 || er.height < 6) continue;
    const ix = Math.max(0, Math.min(r.right, er.right) - Math.max(r.left, er.left));
    const iy = Math.max(0, Math.min(r.bottom, er.bottom) - Math.max(r.top, er.top));
    if (ix > 4 && iy > 4) {
      const ecs = getComputedStyle(el);
      if (ecs.position === "static" && ecs.zIndex === "auto") continue;
      const label = (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 20);
      overlapping.push({
        el: el.tagName + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/)[0] : ""),
        label, pos: ecs.position, z: ecs.zIndex,
        rect: { x: Math.round(er.x), y: Math.round(er.y), w: Math.round(er.width), h: Math.round(er.height) },
        overlapW: Math.round(ix), overlapH: Math.round(iy),
      });
    }
  }
  out.overlappingFloating = overlapping.slice(0, 10);
  return out;
})()`;

async function main() {
  const { email, password, origin } = await loadCredentials();
  console.log("目标：", origin);

  const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(project, "test-results", "edge-probe-ws")}`, "about:blank"],
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

  console.log("\n=== /workspace 探针（录入页）===");
  let r = await evaluate(PROBE_WORKSPACE);
  console.log(JSON.stringify(r, null, 1));

  // 输入长文字，再看按钮是否压字
  console.log("\n=== 填入 30 字长文本后再探 ===");
  await evaluate(`(() => {
    const ta = document.querySelector("textarea");
    if (!ta) return "no textarea";
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), "value");
    d.set.call(ta, "这是一段很长的测试文字用来检查摘星按钮是否会压住我打的字");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    return "filled";
  })()`);
  await sleep(2000);
  r = await evaluate(PROBE_WORKSPACE);
  console.log(JSON.stringify(r, null, 1));

  // 滚到底看底部遮挡
  console.log("\n=== 底部区域探针 ===");
  const bottom = await evaluate(`(() => {
    const out = { path: location.pathname, scrollH: document.documentElement.scrollHeight, innerH: innerHeight };
    const main = document.querySelector(".main-wrap") || document.querySelector("main");
    if (main) {
      out.mainScroller = main.className;
      out.mainScrollTop = Math.round(main.scrollTop);
      out.mainScrollH = Math.round(main.scrollHeight);
      out.mainClientH = Math.round(main.clientHeight);
      out.canScroll = main.scrollHeight > main.clientHeight + 4;
    }
    const nav = document.querySelector(".mobile-nav");
    if (nav) {
      const nr = nav.getBoundingClientRect();
      out.nav = { y: Math.round(nr.y), h: Math.round(nr.height), bottom: Math.round(nr.bottom) };
    } else out.nav = null;
    return out;
  })()`);
  console.log(JSON.stringify(bottom, null, 1));

  socket.close();
  edge.kill();
}

main().catch(e => { console.error("失败：", e.message); process.exit(1); });
