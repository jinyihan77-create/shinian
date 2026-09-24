/**
 * 决定性验证：底部导航到底有没有遮住内容？
 *
 * 用探针法（elementFromPoint）——在内容元素的位置放一个"探针"，
 * 问浏览器"这个点最上层是谁"。如果最上层是内容本身，说明没被遮住。
 * 这比"矩形相交"可靠，能排除误报。
 *
 * 只读，不改任何文件。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const edge = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless=new", "--disable-gpu", "--remote-debugging-port=9361",
  `--user-data-dir=${path.join(project, "test-results", "edge-probe-profile")}`, "about:blank",
], { stdio: "ignore", windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const PAGES = [
  { name: "记录页", url: "http://localhost:3000/design-preview#capture", setup: [] },
  { name: "来源展开", url: "http://localhost:3000/design-preview#capture",
    setup: ["Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('添加来源'))?.click()"] },
  { name: "回声屿", url: "http://localhost:3000/design-preview#library", setup: [] },
  { name: "闪卡橱窗", url: "http://localhost:3000/design-preview#flashcard", setup: [] },
];

try {
  await sleep(2500);
  const targets = await fetch("http://127.0.0.1:9361/json").then(r => r.json());
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

  console.log("探针法验证：底部导航是否真的挡住内容\n");

  for (const page of PAGES) {
    await call("Page.navigate", { url: page.url });
    await sleep(3000);
    for (const expr of page.setup) {
      await call("Runtime.evaluate", { expression: expr, awaitPromise: true });
      await sleep(1200);
    }

    // 滚到底：同时尝试 window 和可能的自定义滚动容器
    await call("Runtime.evaluate", { expression: `
      (() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        document.querySelectorAll('div').forEach(d => {
          if (d.scrollHeight > d.clientHeight + 20 && d.clientHeight > 200) {
            d.scrollTop = d.scrollHeight;
          }
        });
        return 'scrolled';
      })()
    ` });
    await sleep(1500);

    const probe = await call("Runtime.evaluate", { expression: `
      (() => {
        const nav = document.querySelector('.mobile-nav, [aria-label="移动端主导航"]');
        if (!nav) return JSON.stringify({ page: '${page.name}', result: '没有找到底部导航' });
        const navBox = nav.getBoundingClientRect();
        if (navBox.height === 0) return JSON.stringify({ page: '${page.name}', result: '底部导航不可见' });

        // 收集页面里所有可见的文字/按钮元素，排除导航自身
        const targets = [...document.querySelectorAll('button, p, h2, h3, strong, small, span, a, li')]
          .filter(el => {
            if (nav.contains(el)) return false;
            const t = (el.textContent || '').trim();
            if (!t) return false;
            const r = el.getBoundingClientRect();
            return r.width > 24 && r.height > 10;
          });

        const hits = [];
        for (const el of targets) {
          const r = el.getBoundingClientRect();
          // 取元素底部的中心点做探针
          const px = r.left + r.width / 2;
          const py = r.bottom - 3;
          if (py < 0 || py > window.innerHeight) continue;
          if (px < 0 || px > window.innerWidth) continue;
          const top = document.elementFromPoint(px, py);
          if (!top) continue;
          // 如果最上层是导航栏本身 → 这个点被遮住了
          const blockedByNav = nav.contains(top);
          if (blockedByNav) {
            const overlap = Math.round(Math.min(r.bottom, navBox.bottom) - Math.max(r.top, navBox.top));
            hits.push({ el: el.tagName.toLowerCase() + '「' + (el.textContent||'').trim().slice(0,16) + '」',
                        coveredPx: overlap, percent: Math.round(overlap / r.height * 100) + '%' });
          }
        }
        return JSON.stringify({
          page: '${page.name}',
          navHeight: Math.round(navBox.height),
          navTop: Math.round(navBox.top),
          scrolledTo: Math.round(window.scrollY),
          docHeight: document.documentElement.scrollHeight,
          probePoints: targets.length,
          blockedCount: hits.length,
          verdict: hits.length === 0 ? '✓ 未被遮挡' : '⚠ 有 ' + hits.length + ' 处被导航遮住',
          blocked: hits.slice(0, 5)
        }, null, 2);
      })()
    `, returnByValue: true });
    console.log(probe.result.value);
    console.log("");
  }

  socket.close();
} catch (e) {
  console.error("失败：", e.message);
} finally {
  edge.kill();
}
