/**
 * 探测落地页在手机端是否可滚动（只读，一次性排障用）
 */
import { spawn } from "node:child_process";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const ORIGIN = "https://inspiration-echo-318255-10-1492602203.sh.run.tcloudbase.com";
const PORT = 9370;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  `--remote-debugging-port=${PORT}`,
  "--user-data-dir=C:\\Users\\qiqi\\Desktop\\我的第一个项目\\test-results\\剪辑素材\\.probe",
  "about:blank",
], { stdio: "ignore", windowsHide: true });

let target;
for (let i = 0; i < 40; i += 1) {
  await sleep(500);
  try {
    const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
    target = list.find((x) => x.type === "page");
    if (target) break;
  } catch { /* 等待 */ }
}
if (!target) { edge.kill(); throw new Error("Edge 未就绪"); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
const pend = new Map();
let id = 1;
ws.addEventListener("message", async (e) => {
  const raw = typeof e.data === "string" ? e.data : await e.data.text();
  const m = JSON.parse(raw);
  const p = pend.get(m.id);
  if (!p) return;
  pend.delete(m.id);
  m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
});
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
const call = (method, params = {}) => new Promise((res, rej) => {
  const i = id++;
  const tm = setTimeout(() => { pend.delete(i); rej(new Error("timeout " + method)); }, 30000);
  pend.set(i, { resolve: (v) => { clearTimeout(tm); res(v); }, reject: (err) => { clearTimeout(tm); rej(err); } });
  ws.send(JSON.stringify({ id: i, method, params }));
});

await call("Page.enable");
await call("Runtime.enable");
await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await call("Page.navigate", { url: ORIGIN + "/" });
await sleep(6000);

const probe = await call("Runtime.evaluate", {
  expression: `(() => {
    const cands = [
      ["body", document.body],
      ["documentElement", document.documentElement],
      [".main-wrap", document.querySelector(".main-wrap")],
      [".app-shell", document.querySelector(".app-shell")],
    ];
    return {
      viewportH: window.innerHeight,
      windowScrollY: window.scrollY,
      maxWindowScroll: document.documentElement.scrollHeight - window.innerHeight,
      candidates: cands.map(([name, el]) => el ? {
        name,
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
        canScroll: el.scrollHeight > el.clientHeight + 4,
        overflowY: getComputedStyle(el).overflowY,
      } : { name, missing: true }),
      hasWorkspaceLink: !!document.querySelector('a[href="/workspace"]'),
      textHead: (document.body.innerText || "").slice(0, 120),
    };
  })()`,
  returnByValue: true,
});
console.log("=== 结构探测 ===");
console.log(JSON.stringify(probe.result.value, null, 2));

const before = await call("Runtime.evaluate", { expression: "window.scrollY", returnByValue: true });
await call("Runtime.evaluate", { expression: "window.scrollTo(0, 400)", returnByValue: true });
await sleep(1000);
const after = await call("Runtime.evaluate", { expression: "window.scrollY", returnByValue: true });
console.log(`\nwindow.scrollTo(0,400)：${before.result.value} → ${after.result.value}`);

ws.close();
edge.kill();
