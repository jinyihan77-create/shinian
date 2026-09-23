import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const outputDirectory = path.resolve("test-results");
const profileDirectory = path.join(outputDirectory, "edge-star-3d-profile");
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

await mkdir(outputDirectory, { recursive: true });
const edge = spawn(edgePath, ["--headless", "--enable-webgl", "--ignore-gpu-blocklist", "--remote-debugging-port=9336", `--user-data-dir=${profileDirectory}`, "about:blank"], { stdio: "ignore", windowsHide: true });
let socket;

try {
  await sleep(1800);
  const pages = await fetch("http://127.0.0.1:9336/json").then(response => response.json());
  socket = new WebSocket(pages[0].webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", async event => {
    const raw = typeof event.data === "string" ? event.data : await event.data.text();
    const message = JSON.parse(raw);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      pending.set(id, message => { clearTimeout(timer); message.error ? reject(message.error) : resolve(message.result); });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  await call("Page.enable");
  await call("Runtime.enable");

  for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
    await call("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 600 });
    await call("Page.navigate", { url: `http://localhost:3000/design-preview?star3d=${viewport.name}#capture` });
    await sleep(2800);
    await call("Runtime.evaluate", { expression: `document.querySelector('[aria-label="打开星空打卡牌"]')?.click()` });
    await sleep(4200);
    const check = await call("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const canvas = document.querySelector('dialog canvas');
        if (!canvas) return { canvas: false, litPixels: 0 };
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) return { canvas: true, context: false, litPixels: 0 };
        const width = Math.min(96, canvas.width);
        const height = Math.min(96, canvas.height);
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(Math.max(0, Math.floor(canvas.width / 2 - width / 2)), Math.max(0, Math.floor(canvas.height / 2 - height / 2)), width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let litPixels = 0;
        for (let index = 0; index < pixels.length; index += 4) if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 24) litPixels++;
        return { canvas: true, context: true, litPixels, width: canvas.width, height: canvas.height };
      })()`,
    });
    const screenshot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(outputDirectory, `star-3d-${viewport.name}.png`), Buffer.from(screenshot.data, "base64"));
    const canvasRect = await call("Runtime.evaluate", { returnByValue: true, expression: `(() => { const rect = document.querySelector('dialog canvas')?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null; })()` });
    await call("Runtime.evaluate", { expression: `(() => { const style = document.createElement('style'); style.textContent = 'dialog,dialog [class*=modal]{background:#000!important} dialog [class*=atmosphere],dialog [class*=heading],dialog [class*=footer],dialog [class*=cords],dialog [class*=starHalo],dialog [class*=crystalHitGlint]{visibility:hidden!important}'; document.head.append(style); })()` });
    await sleep(200);
    const rect = canvasRect.result.value;
    const isolated = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 } });
    const isolatedBuffer = Buffer.from(isolated.data, "base64");
    await writeFile(path.join(outputDirectory, `star-3d-${viewport.name}-canvas.png`), isolatedBuffer);
    const { data, info } = await sharp(isolatedBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let coloredPixels = 0;
    for (let index = 0; index < data.length; index += info.channels) if (data[index] + data[index + 1] + data[index + 2] > 45) coloredPixels++;
    console.log(`${viewport.name}: ${JSON.stringify({ ...check.result.value, screenshotColoredPixels: coloredPixels })}`);
  }
} finally {
  socket?.close();
  edge.kill();
}
