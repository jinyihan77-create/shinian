import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve("test-results");
await mkdir(output, { recursive: true });
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless", "--disable-gpu", "--remote-debugging-port=9335",
  `--user-data-dir=${path.join(output, "edge-scroll-expand")}`, "about:blank",
], { stdio: "ignore", windowsHide: true });
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

let socket;
try {
  await sleep(1600);
  const pages = await fetch("http://127.0.0.1:9335/json").then(response => response.json());
  socket = new WebSocket(pages[0].webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  socket.addEventListener("message", async event => {
    const message = JSON.parse(typeof event.data === "string" ? event.data : await event.data.text());
    pending.get(message.id)?.(message);
  });
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const callId = ++id;
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30000);
    pending.set(callId, message => { clearTimeout(timer); pending.delete(callId); message.error ? reject(message.error) : resolve(message.result); });
    socket.send(JSON.stringify({ id: callId, method, params }));
  });
  const evaluate = expression => call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  const capture = async name => {
    const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
    await writeFile(path.join(output, name), Buffer.from(shot.data, "base64"));
  };
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: "http://localhost:3000/design-preview#library" });
  await sleep(3000);
  const selector = "[aria-label='从过去浮现的一条念头']";
  await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'start'})`);
  await sleep(800);
  await capture("scroll-expand-start.png");
  await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); window.scrollTo(0, el.offsetTop + (el.offsetHeight-innerHeight)*.55); })()`);
  await sleep(1000);
  await capture("scroll-expand-mid.png");
  await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); window.scrollTo(0, el.offsetTop + (el.offsetHeight-innerHeight)*.98); })()`);
  await sleep(1000);
  await capture("scroll-expand-end.png");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Page.navigate", { url: "http://localhost:3000/design-preview#library" });
  await sleep(2200);
  const mobile = await evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  console.log(`scroll-expand visual QA: mobile instances ${mobile.result.value}`);
} finally {
  socket?.close();
  browser.kill();
}
