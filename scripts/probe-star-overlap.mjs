/**
 * 线上探针：手机端输入框右侧的「摘星」按钮，到底压不压字？
 *
 * 用探针法（elementFromPoint）——在文字会延伸到的位置放探针，问浏览器
 * "这个点最上层是谁"。这比量矩形可靠。
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
const PORT = 9560;

async function main() {
  const { email, password, origin } = await loadCredentials();
  if (!origin) throw new Error("APP_ORIGIN 未配置");
  console.log("目标：", origin);

  const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(project, "test-results", "edge-probe-star")}`, "about:blank"],
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
    return r.result?.value;
  };

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // 过腾讯云中间页
  await call("Page.navigate", { url: `${origin}/` });
  await sleep(4000);
  await evaluate(`(() => { const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent && x.textContent.includes("确定访问")); if (b) b.click(); return "ok"; })()`);
  await sleep(3000);

  // 登录
  await call("Page.navigate", { url: `${origin}/workspace` });
  await sleep(4000);
  const loginState = await evaluate(`(async () => {
    const inputs = Array.from(document.querySelectorAll("input"));
    const e = inputs.find(i => i.type === "email"); const p = inputs.find(i => i.type === "password");
    if (!e || !p) return "already-in";
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value"); d.set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    set(e, ${JSON.stringify(email)}); set(p, ${JSON.stringify(password)});
    Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").includes("进入我的空间"))?.click();
    return "submitted";
  })()`);
  console.log("登录状态：", loginState);
  await sleep(8000);

  // 回到落地页
  await call("Page.navigate", { url: `${origin}/` });
  await sleep(6000);

  console.log("\n=== 落地页探针 ===");
  const landing = await evaluate(`(() => {
    const out = {};
    out.title = document.title;
    out.path = location.pathname;
    const ta = document.querySelector("textarea");
    out.hasTextarea = !!ta;
    const t = document.body.innerText || "";
    out.looksLanding = /给念头一点柔和的光|一闪，便有回响/.test(t);
    return out;
  })()`);
  console.log(JSON.stringify(landing, null, 1));

  // 找「摘星」入口
  console.log("\n=== 摘星入口元素 ===");
  const star = await evaluate(`(() => {
    const cands = Array.from(document.querySelectorAll("button, a"))
      .filter(el => /摘星/.test(el.textContent || "") || el.id === "daily-star-entry");
    return cands.map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { id: el.id || null, cls: el.className, text: (el.textContent||"").trim().slice(0,24),
               rect: {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)},
               pos: cs.position, zIndex: cs.zIndex, visible: r.width>0 && r.height>0 };
    });
  })()`);
  console.log(JSON.stringify(star, null, 1));

  // 输入框与摘星按钮的重叠探针
  console.log("\n=== 输入框 vs 摘星按钮：重叠探针 ===");
  const probe = await evaluate(`(() => {
    const ta = document.querySelector("textarea");
    if (!ta) return { error: "没有输入框" };
    const r = ta.getBoundingClientRect();
    const cs = getComputedStyle(ta);
    const out = {
      textarea: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      paddingRight: cs.paddingRight,
      paddingLeft: cs.paddingLeft,
      usableTextWidth: Math.round(r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
    };
    // 文字能写到的最右边界（相对输入框左边）
    const textRight = r.width - parseFloat(cs.paddingRight);
    out.textRightBoundary = Math.round(textRight);
    // 找所有会压在输入框区域上的浮层元素
    const overlays = [];
    const samples = [0.5, 0.7, 0.85, 0.95];
    for (const ratio of samples) {
      const px = r.x + r.width * ratio;
      const py = r.y + 24;
      const top = document.elementFromPoint(px, py);
      if (!top) continue;
      const insideTa = top === ta || top.tagName === "TEXTAREA";
      overlays.push({
        ratio,
        point: [Math.round(px), Math.round(py)],
        topEl: top.tagName + (top.className && typeof top.className === "string" ? "." + top.className.trim().split(/\\s+/).slice(0,2).join(".") : ""),
        isTextarea: insideTa,
      });
    }
    out.probes = overlays;
    return out;
  })()`);
  console.log(JSON.stringify(probe, null, 1));

  socket.close();
  edge.kill();
}

main().catch(e => { console.error("失败：", e.message); process.exit(1); });
