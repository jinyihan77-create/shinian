/**
 * 决定性测试：在手机宽度下把文字写长，看是否真的会被「摘星」按钮压住。
 * 只读，不改任何文件。
 */
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(project, "test-results", "verify-nav");
await mkdir(outDir, { recursive: true });

const edge = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless=new", "--disable-gpu", "--remote-debugging-port=9352",
  `--user-data-dir=${path.join(project, "test-results", "edge-verify2-profile")}`, "about:blank",
], { stdio: "ignore", windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
  await sleep(2500);
  const targets = await fetch("http://127.0.0.1:9352/json").then(r => r.json());
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
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Page.navigate", { url: "http://localhost:3000/design-preview#capture" });
  await sleep(3200);

  // 关键：用很长的单行文字填满第一行，看它是否延伸到按钮下方
  await call("Runtime.evaluate", { expression: `
    (() => {
      const ta = document.querySelector('#capture-thought');
      ta.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      // 一行写满：不加换行符，靠自动换行
      setter.call(ta, '这是一段很长的测试文字用来检查输入框的第一行文字会不会被右上角的摘星按钮给压住遮挡住看不见');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  ` });
  await sleep(1500);

  const probe = await call("Runtime.evaluate", { expression: `
    (() => {
      const ta = document.querySelector('#capture-thought');
      const star = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '摘下今天的星');
      if (!ta || !star) return JSON.stringify({ error: 'element missing' });

      const cs = getComputedStyle(ta);
      const t = ta.getBoundingClientRect();
      const s = star.getBoundingClientRect();

      // 文字实际可用宽度
      const contentLeft = t.left + parseFloat(cs.paddingLeft);
      const contentRight = t.right - parseFloat(cs.paddingRight);
      const usableWidth = contentRight - contentLeft;

      // 按钮占据的横向区间
      const buttonZoneLeft = s.left - t.left;      // 相对输入框左边
      const buttonZoneRight = s.right - t.left;

      // 用 canvas 测量文字实际渲染宽度，判断第一行会不会伸进按钮区
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = cs.fontSize + ' ' + cs.fontFamily;
      const firstLine = ta.value.slice(0, 20);
      const textWidth = ctx.measureText(firstLine).width;

      return JSON.stringify({
        textareaWidth: Math.round(t.width),
        paddingLeft: cs.paddingLeft,
        paddingRight: cs.paddingRight,
        usableTextWidth: Math.round(usableWidth),
        buttonZone: { from: Math.round(buttonZoneLeft), to: Math.round(buttonZoneRight), width: Math.round(s.width) },
        overlapWithTextArea: Math.round(Math.abs(Math.min(0, contentRight - s.left))),
        textExtendsIntoButtonZone: contentRight > s.left,
        note: contentRight > s.left
          ? '确认：文字第一行可以写到按钮底下（冲突 ' + Math.round(contentRight - s.left) + 'px）'
          : '未发现问题',
        measuredLineWidth: Math.round(textWidth),
        willWrapUnderButton: textWidth > (s.left - contentLeft)
      }, null, 2);
    })()
  `, returnByValue: true });
  console.log(probe.result.value);

  const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(outDir, "mobile-long-text.png"), Buffer.from(shot.data, "base64"));
  console.log("\n截图：test-results/verify-nav/mobile-long-text.png");

  socket.close();
} catch (e) {
  console.error("失败：", e.message);
} finally {
  edge.kill();
}
