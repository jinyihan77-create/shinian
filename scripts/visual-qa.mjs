import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const outputDirectory = path.resolve("test-results");
const profileDirectory = path.join(outputDirectory, "edge-cdp-profile");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

await mkdir(outputDirectory, { recursive: true });

const edge = spawn(edgePath, [
  "--headless",
  "--disable-gpu",
  "--remote-debugging-port=9334",
  `--user-data-dir=${profileDirectory}`,
  "about:blank",
], { stdio: "ignore", windowsHide: true });

let socket;
try {
  await sleep(1800);
  const pages = await fetch("http://127.0.0.1:9334/json").then((response) => response.json());
  const page = pages.find((candidate) => candidate.type === "page" && candidate.url === "about:blank") ?? pages.find((candidate) => candidate.type === "page");
  if (!page) throw new Error("visual-qa: no browser page target");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener("message", async (event) => {
    const raw = typeof event.data === "string" ? event.data : await event.data.text();
    const message = JSON.parse(raw);
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    resolve(message);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  console.log("visual-qa: browser connected");

  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(message.error);
        else resolve(message.result);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function capture({ name, url, expressions = [], width = 390, height = 844, reduceMotion = false }) {
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 600,
    });
    await call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: reduceMotion ? "reduce" : "no-preference" }],
    });
    await call("Page.navigate", { url });
    await sleep(2600);
    for (const expression of expressions) {
      await call("Runtime.evaluate", { expression, awaitPromise: true });
      await sleep(850);
    }
    const screenshot = await call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(path.join(outputDirectory, name), Buffer.from(screenshot.data, "base64"));
    console.log(`visual-qa: captured ${name}`);
  }

  await call("Page.enable");
  await call("Runtime.enable");

  await capture({
    name: "source-mobile.png",
    url: "http://localhost:3000/design-preview#capture",
    expressions: ["Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('添加来源'))?.click()"],
  });
  await capture({
    name: "voice-mobile.png",
    url: "http://localhost:3000/design-preview#capture",
    expressions: [
      "window.SpeechRecognition = class { start() {} stop() { this.onend?.(); } }",
      "document.querySelector('[aria-label=\"开始语音输入\"]')?.click()",
    ],
  });
  await capture({
    name: "search-voice-mobile.png",
    url: "http://localhost:3000/design-preview#library",
    expressions: [
      "window.SpeechRecognition = class { start() {} stop() { this.onend?.(); } }",
      "document.querySelector('[aria-label=\"用语音搜索\"]')?.click()",
    ],
  });
  await capture({
    name: "tickets-mobile.png",
    url: "http://localhost:3000/design-preview#library",
    expressions: ["Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('待办'))?.click()"],
  });
  await capture({
    name: "flashcard-halftone-mobile.png",
    url: "http://localhost:3000/design-preview#flashcard",
    expressions: ["document.querySelector('[aria-label^=\"正在显影的闪卡\"]')?.scrollIntoView({ block: 'center' })"],
  });
  await capture({
    name: "flashcard-halftone-desktop.png",
    url: "http://localhost:3000/design-preview#flashcard",
    expressions: ["document.querySelector('[aria-label^=\"正在显影的闪卡\"]')?.scrollIntoView({ block: 'center' })"],
    width: 1440,
    height: 900,
  });
  await capture({
    name: "checkin-journey-desktop.png",
    url: "http://localhost:3000/design-preview#capture",
    width: 1440,
    height: 900,
    expressions: [
      "localStorage.clear(); document.querySelector('[aria-label=\"打开星空打卡牌\"]')?.click()",
    ],
  });
  await capture({
    name: "checkin-stars-mobile.png",
    url: "http://localhost:3000/design-preview#capture",
    expressions: [
      "localStorage.clear(); document.querySelector('[aria-label=\"打开星空打卡牌\"]')?.click()",
    ],
    reduceMotion: true,
  });
  await capture({
    name: "checkin-mobile.png",
    url: "http://localhost:3000/design-preview#capture",
    expressions: [
      "document.querySelector('[aria-label=\"打开星空打卡牌\"]')?.click()",
      "document.querySelector('[aria-label^=\"摘下第\"]')?.click()",
      "new Promise((resolve) => setTimeout(resolve, 2500))",
    ],
    reduceMotion: true,
  });
} finally {
  socket?.close();
  edge.kill();
}
