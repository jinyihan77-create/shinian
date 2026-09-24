/**
 * 视觉确认：记录页底部的摘星入口卡片，是否真的被底部导航压住。
 * 只读。
 */
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(project, "test-results", "verify-nav");
await mkdir(outDir, { recursive: true });

const edge = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless=new", "--disable-gpu", "--remote-debugging-port=9362",
  `--user-data-dir=${path.join(project, "test-results", "edge-shot-profile")}`, "about:blank",
], { stdio: "ignore", windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
  await sleep(2500);
  const targets = await fetch("http://127.0.0.1:9362/json").then(r => r.json());
  const socket = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  const pending = new Map();
  let id = 1;
  socket.addEventListener("message", async e => {
    const raw = typeof e.data === "string" ? e.data : await e.data.text();
    const msg = JSON.parse(raw);
    const res = pending.get(msg.id);
    if (res) { pending.delete(msg.id); res(msg); }
  });
  await new Promise((res, rej) => { socket.addEventListener("open", res, { once: true }); socket.addEventListener("error", rej, { once: true }); });

  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const cid = id++;
    const t = setTimeout(() => { pending.delete(cid); reject(new Error("timeout " + method)); }, 60000);
    pending.set(cid, m => { clearTimeout(t); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); });
    socket.send(JSON.stringify({ id: cid, method, params }));
  });

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: "http://localhost:3000/design-preview#capture" });
  await sleep(3200);

  // 记录页整体截图（不滚动，因为内容刚好一屏）
  const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(outDir, "record-page-full.png"), Buffer.from(shot.data, "base64"));

  // 精确测量摘星入口卡片 vs 底部导航
  const measure = await call("Runtime.evaluate", { expression: `
    (() => {
      const nav = document.querySelector('.mobile-nav, [aria-label="移动端主导航"]');
      const entry = document.querySelector('[class*="entryCompact"]');
      if (!nav || !entry) return JSON.stringify({ error: 'missing', nav: !!nav, entry: !!entry });
      const n = nav.getBoundingClientRect();
      const e = entry.getBoundingClientRect();
      const overlapTop = Math.max(n.top, e.top);
      const overlapBottom = Math.min(n.bottom, e.bottom);
      const overlapPx = Math.max(0, overlapBottom - overlapTop);

      // 探针：在卡片底部中心点，最上层是谁？
      const px = e.left + e.width / 2;
      const py = e.bottom - 5;
      const topEl = document.elementFromPoint(px, py);

      return JSON.stringify({
        nav: { top: Math.round(n.top), bottom: Math.round(n.bottom), height: Math.round(n.height) },
        entry: { top: Math.round(e.top), bottom: Math.round(e.bottom), height: Math.round(e.height) },
        overlapPx: Math.round(overlapPx),
        probeAt: { x: Math.round(px), y: Math.round(py) },
        topElementAtProbe: topEl ? topEl.tagName.toLowerCase() + '.' + (typeof topEl.className === 'string' ? topEl.className.split(' ')[0] : '') : 'none',
        probeHitsNav: topEl ? nav.contains(topEl) : null,
        viewportH: window.innerHeight,
        docH: document.documentElement.scrollHeight,
        canScroll: document.documentElement.scrollHeight > window.innerHeight
      }, null, 2);
    })()
  `, returnByValue: true });
  console.log(measure.result.value);

  socket.close();
} catch (e) {
  console.error("失败：", e.message);
} finally {
  edge.kill();
}
