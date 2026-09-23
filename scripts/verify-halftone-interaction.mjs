import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputDirectory = path.resolve("test-results");
await mkdir(outputDirectory, { recursive: true });
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless", "--disable-gpu", "--remote-debugging-port=9336",
  `--user-data-dir=${path.join(outputDirectory, "edge-halftone-interaction")}`, "about:blank",
], { stdio: "ignore", windowsHide: true });
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

let socket;
try {
  await sleep(1600);
  const pages = await fetch("http://127.0.0.1:9336/json").then(response => response.json());
  socket = new WebSocket(pages[0].webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  socket.addEventListener("message", async event => {
    const message = JSON.parse(typeof event.data === "string" ? event.data : await event.data.text());
    pending.get(message.id)?.(message);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const callId = ++id;
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20000);
    pending.set(callId, message => {
      clearTimeout(timer); pending.delete(callId);
      message.error ? reject(message.error) : resolve(message.result);
    });
    socket.send(JSON.stringify({ id: callId, method, params }));
  });
  const evaluate = expression => call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: "http://localhost:3000/design-preview#flashcard" });
  await sleep(2400);
  await evaluate(`new Promise(resolve => {
    const started = Date.now();
    const timer = setInterval(() => {
      const ready = document.querySelector('.halftone-reveal[data-render-state="ready"] canvas');
      if (ready || Date.now() - started > 12000) { clearInterval(timer); resolve(Boolean(ready)); }
    }, 120);
  })`);
  await evaluate("document.querySelector('.halftone-reveal')?.scrollIntoView({ block: 'center' })");
  await sleep(700);
  const target = await evaluate(`(() => {
    const host = document.querySelector('.halftone-reveal');
    const canvas = host?.querySelector('canvas');
    if (!host || !canvas) return null;
    const rect = host.getBoundingClientRect();
    return { x: rect.left + rect.width * .5, y: rect.top + rect.height * .48, before: canvas.toDataURL() };
  })()`);
  if (!target.result.value) throw new Error("Halftone canvas was not ready.");
  const { x, y, before } = target.result.value;
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", pointerType: "mouse" });
  await sleep(700);
  const after = await evaluate("document.querySelector('.halftone-reveal canvas')?.toDataURL() || ''");
  if (!after.result.value || after.result.value === before) throw new Error("Pointer movement did not change the halftone canvas.");
  const screenshot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(outputDirectory, "flashcard-halftone-spotlight.png"), Buffer.from(screenshot.data, "base64"));
  console.log("halftone interaction: pointer movement changed the rendered canvas");
} finally {
  socket?.close();
  browser.kill();
}
