/**
 * 拾念 · 页面体检（监工用）
 *
 * 只读：不改任何文件、不发布、不写数据库。它做的事是——
 * 在真实浏览器里打开每个页面（手机尺寸 + 电脑尺寸），
 * 自动检测"肉眼容易忽略但看着别扭"的布局问题，并把截图存下来。
 *
 * 用法：
 *   node scripts/page-inspect.mjs                   手机 + 电脑，全部页面
 *   node scripts/page-inspect.mjs --device=mobile   只查手机
 *   node scripts/page-inspect.mjs --device=desktop  只查电脑
 *   node scripts/page-inspect.mjs --origin=https://...  查线上而不是本地
 *
 * 输出：
 *   test-results/inspect/<日期时间>/  截图 + report.json + report.md
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath 会正确解码中文路径；不要自己拿 URL 字符串做正则替换。
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const deviceArg = args.find(a => a.startsWith("--device="))?.split("=")[1] ?? "both";
const origin = args.find(a => a.startsWith("--origin="))?.split("=")[1] ?? "http://localhost:3000";
const port = 9341;

const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const edgePath = edgeCandidates.find(p => fs.existsSync(p));
if (!edgePath) {
  console.error("找不到 Microsoft Edge，无法进行页面体检。");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(project, "test-results", "inspect", stamp);
await mkdir(outDir, { recursive: true });

const VIEWPORTS = {
  mobile: { width: 390, height: 844, label: "手机 390×844" },
  desktop: { width: 1440, height: 900, label: "电脑 1440×900" },
};
const devices = deviceArg === "both" ? ["mobile", "desktop"] : [deviceArg];

/** 页面清单。hash 决定进入哪个视图，滚动到指定位置便于截图。 */
const PAGES = [
  { name: "record", path: "/design-preview#capture", label: "记录页" },
  { name: "record-source-open", path: "/design-preview#capture", label: "记录页·来源展开",
    setup: ["Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('添加来源'))?.click()"] },
  { name: "collection", path: "/design-preview#library", label: "回声屿列表" },
  { name: "collection-tickets", path: "/design-preview#library", label: "回声屿·待办票根",
    setup: ["Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('待办'))?.click()"] },
  { name: "flashcards", path: "/design-preview#flashcard", label: "闪卡橱窗" },
  { name: "checkin", path: "/design-preview#capture", label: "摘星打卡",
    setup: ["document.querySelector('[aria-label=\"打开星空打卡牌\"]')?.click()"] },
  { name: "settings", path: "/design-preview#settings", label: "设置页" },
];

/**
 * 在页面里跑的检测脚本。全部返回结构化问题，不做任何写入。
 * 检测项对应"肉眼容易漏掉"的布局缺陷。
 */
const AUDIT_SCRIPT = `(() => {
  const issues = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  const de = document.documentElement;
  const scrollable = de.scrollHeight > vh + 10;
  const bodyPadBottom = parseFloat(getComputedStyle(document.body).paddingBottom || '0');

  const box = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
  const visible = el => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const desc = el => {
    const tag = el.tagName.toLowerCase();
    const cls = (typeof el.className === 'string' ? el.className : '').split(' ').filter(Boolean).slice(0, 2).join('.');
    const txt = (el.textContent || '').trim().slice(0, 18);
    return tag + (cls ? '.' + cls : '') + (txt ? '「' + txt + '」' : '');
  };

  // 1. 横向溢出（最影响观感的一类）
  if (de.scrollWidth > de.clientWidth + 1) {
    // 找出到底是哪个元素撑破了宽度
    const culprits = [];
    document.querySelectorAll('*').forEach(el => {
      if (!visible(el)) return;
      const b = box(el);
      if (b.right > vw + 1) culprits.push({ el: desc(el), right: Math.round(b.right), overflow: Math.round(b.right - vw) });
    });
    culprits.sort((a, b) => b.overflow - a.overflow);
    issues.push({ type: 'overflow-x', severity: 'high',
      detail: '页面横向溢出 ' + (de.scrollWidth - de.clientWidth) + 'px，手机上会左右晃动',
      culprits: culprits.slice(0, 5) });
  }

  // 2. 文字被别的元素盖住
  //    注意：底部固定导航在滚动中途盖住内容属于正常现象，这里排除掉，
  //    真正的导航遮挡由下面第 6 项（滚到底后）单独判断。
  const navForFilter = document.querySelector('.mobile-nav, [aria-label="移动端主导航"]');
  // 全屏弹窗打开时，底下页面被盖住属于正常，跳过遮挡检测
  const hasOverlay = [...document.querySelectorAll('*')].some(el => {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden') return false;
    const b = el.getBoundingClientRect();
    return b.width >= window.innerWidth * 0.9 && b.height >= window.innerHeight * 0.7 && parseFloat(s.zIndex || "0") > 10;
  });
  const textish = [...document.querySelectorAll('textarea, input, p, h1, h2, h3, span, strong, small, li, dd')]
    .filter(el => visible(el) && (el.value || el.textContent || '').trim().length > 0)
    .filter(el => !(navForFilter && navForFilter.contains(el)))
    .filter(el => !hasOverlay || !el.closest('[aria-hidden="true"]'));
  const overlaps = [];
  const clickables = hasOverlay ? [] : [...document.querySelectorAll('button, a, [role="button"]')]
    .filter(visible)
    .filter(el => !(navForFilter && navForFilter.contains(el)));
  for (const t of textish) {
    const tb = box(t);
    if (tb.w < 4 || tb.h < 4) continue;
    for (const c of clickables) {
      if (t.contains(c) || c.contains(t)) continue;      // 父子关系不算遮挡
      if (t.tagName === 'BUTTON') continue;
      // 只关心"真盖住"：被覆盖超过 60% 且重叠面积足够大
      const cb = box(c);
      const ox = Math.min(tb.right, cb.right) - Math.max(tb.x, cb.x);
      const oy = Math.min(tb.bottom, cb.bottom) - Math.max(tb.y, cb.y);
      if (ox > 8 && oy > 8) {
        const area = ox * oy;
        const tArea = tb.w * tb.h;
        if (area / tArea > 0.6 && area > 200) {
          overlaps.push({ text: desc(t), coveredBy: desc(c),
            overlap: { w: Math.round(ox), h: Math.round(oy) },
            coverage: Math.round(area / tArea * 100) + '%' });
        }
      }
      if (overlaps.length > 6) break;
    }
    if (overlaps.length > 6) break;
  }
  if (overlaps.length) {
    issues.push({ type: 'text-covered', severity: 'high',
      detail: '有文字被按钮或浮层盖住', items: overlaps });
  }

  // 3. 元素跑出可视区（左右超出，或顶部被裁）
  const escaped = [];
  document.querySelectorAll('button, img, h1, h2, [role="button"]').forEach(el => {
    if (!visible(el)) return;
    const b = box(el);
    const outLeft = b.x < -2, outRight = b.right > vw + 2;
    if (outLeft || outRight) {
      escaped.push({ el: desc(el), x: Math.round(b.x), right: Math.round(b.right),
        dir: outLeft ? '左边超出' : '右边超出', by: Math.round(outLeft ? -b.x : b.right - vw) });
    }
  });
  if (escaped.length) {
    issues.push({ type: 'out-of-viewport', severity: 'medium',
      detail: '元素超出屏幕边界', items: escaped.slice(0, 6) });
  }

  // 4. 触摸目标太小（手机上点不准）
  //    只报"看起来就是按钮"的元素；纯图标装饰、行内小标签不算。
  if (vw < 700) {
    const small = [];
    clickables.forEach(el => {
      const b = box(el);
      if (b.w === 0 || b.h === 0) return;
      if (b.w < 8 || b.h < 8) return;
      const s = getComputedStyle(el);
      const looksLikeButton = el.tagName === 'BUTTON' || s.borderRadius !== '0px' || s.backgroundColor !== 'rgba(0, 0, 0, 0)';
      if (!looksLikeButton) return;
      if (b.w < 44 || b.h < 44) {
        small.push({ el: desc(el), size: Math.round(b.w) + '×' + Math.round(b.h) });
      }
    });
    if (small.length) {
      issues.push({ type: 'small-touch-target', severity: 'low',
        detail: '触摸目标小于 44×44（' + small.length + ' 个），手指容易点错', items: small.slice(0, 8) });
    }
  }

  // 5. 输入框字号小于 16px（iOS 会自动放大页面，很影响体验）
  if (vw < 700) {
    const tinyInputs = [];
    document.querySelectorAll('input, textarea, select').forEach(el => {
      if (!visible(el)) return;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16) tinyInputs.push({ el: desc(el), fontSize: fs + 'px' });
    });
    if (tinyInputs.length) {
      issues.push({ type: 'small-input-font', severity: 'medium',
        detail: '输入框字号小于 16px，iPhone 上点进去会自动放大页面', items: tinyInputs.slice(0, 6) });
    }
  }

  // 5b. 悬浮在输入框上的按钮，是否留出了足够的内边距
  //     这类按钮绝对定位在输入框角落，如果没预留 padding，打字时文字会被压住。
  document.querySelectorAll('textarea, input[type="text"], input:not([type])').forEach(input => {
    if (!visible(input)) return;
    const ib = box(input);
    const cs = getComputedStyle(input);
    const contentRight = ib.right - parseFloat(cs.paddingRight || '0');
    // 找和这个输入框重叠的绝对定位按钮
    document.querySelectorAll('button').forEach(btn => {
      if (!visible(btn)) return;
      if (getComputedStyle(btn).position !== 'absolute') return;
      const bb = box(btn);
      const oy = Math.min(ib.bottom, bb.bottom) - Math.max(ib.y, bb.y);
      const ox = Math.min(ib.right, bb.right) - Math.max(ib.x, bb.x);
      if (oy <= 4 || ox <= 4) return;
      const gap = Math.round(bb.x - contentRight);
      if (gap < 4) {
        issues.push({ type: 'floating-button-over-text', severity: 'high',
          detail: '按钮悬浮在输入框上，但输入框没有预留足够空白，打字到右边时文字会被按钮压住',
          items: [{ el: desc(btn), conflict: desc(input),
            gapPx: gap, buttonLeft: Math.round(bb.x), textRightLimit: Math.round(contentRight) }] });
      }
    });
  });

  // 6. 滚到底之后，底部导航是否压住最后一段内容
  //    （必须先滚到底，否则会把"滚动中途的固定导航"误判成遮挡）
  if (vw < 700) {
    const nav = document.querySelector('.mobile-nav, [aria-label="移动端主导航"]');
    if (nav && visible(nav)) {
      window.scrollTo(0, document.documentElement.scrollHeight);
    }
  }

  return JSON.stringify({
    viewport: { w: vw, h: vh },
    docHeight: de.scrollHeight,
    scrollable,
    bodyPadBottom,
    issueCount: issues.length,
    issues,
    title: document.title,
  });
})()`;

/** 滚到底之后再单独检查一次底部遮挡（独立脚本，因为需要等滚动生效） */
const BOTTOM_CHECK_SCRIPT = `(() => {
  const issues = [];
  const vw = window.innerWidth;
  if (vw >= 700) return JSON.stringify({ issues: [] });

  const box = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
  const visible = el => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const desc = el => {
    const tag = el.tagName.toLowerCase();
    const cls = (typeof el.className === 'string' ? el.className : '').split(' ').filter(Boolean).slice(0, 2).join('.');
    const txt = (el.textContent || '').trim().slice(0, 18);
    return tag + (cls ? '.' + cls : '') + (txt ? '「' + txt + '」' : '');
  };

  const nav = document.querySelector('.mobile-nav, [aria-label="移动端主导航"]');
  if (!nav || !visible(nav)) return JSON.stringify({ issues: [] });

  // 如果有全屏弹窗/遮罩打开，底下的内容被盖住是正常的，跳过检查。
  const fullscreenOverlay = [...document.querySelectorAll('*')].some(el => {
    if (!visible(el)) return false;
    const s = getComputedStyle(el);
    if (s.position !== 'fixed') return false;
    const b = el.getBoundingClientRect();
    return b.width >= window.innerWidth * 0.9 && b.height >= window.innerHeight * 0.7
      && parseFloat(s.zIndex || "0") > 10;
  });
  if (fullscreenOverlay) return JSON.stringify({ issues: [] });

  const nb = box(nav);
  const covered = [];
  // 只检查有实际内容的元素，且要被压住超过 40% 高度才算真问题
  document.querySelectorAll('p, button, h2, h3, li, strong, small, label').forEach(el => {
    if (!visible(el) || nav.contains(el)) return;
    if (!(el.textContent || '').trim()) return;
    const b = box(el);
    if (b.w < 20 || b.h < 8) return;
    const oy = Math.min(b.bottom, nb.bottom) - Math.max(b.y, nb.y);
    const ox = Math.min(b.right, nb.right) - Math.max(b.x, nb.x);
    if (oy > 4 && ox > 4 && oy / b.h > 0.4) {
      covered.push({ el: desc(el), hiddenPx: Math.round(oy), percent: Math.round(oy / b.h * 100) + '%' });
    }
  });

  if (covered.length) {
    issues.push({ type: 'nav-overlap', severity: 'high',
      detail: '滚到页面底部时，底部导航仍压住内容（' + covered.length + " 处）",
      items: covered.slice(0, 5) });
  }
  return JSON.stringify({ issues });
})()`;

// ── 启动无头浏览器 ──────────────────────────────────────────
const profileDir = path.join(project, "test-results", "edge-inspect-profile");
const browser = spawn(edgePath, [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`, "about:blank",
], { stdio: "ignore", windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];

try {
  await sleep(2500);
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
  const target = targets.find(t => t.type === "page");
  if (!target) throw new Error("没有找到可用的浏览器页面");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener("message", async e => {
    const raw = typeof e.data === "string" ? e.data : await e.data.text();
    const msg = JSON.parse(raw);
    const resolve = pending.get(msg.id);
    if (resolve) { pending.delete(msg.id); resolve(msg); }
  });
  await new Promise((res, rej) => {
    socket.addEventListener("open", res, { once: true });
    socket.addEventListener("error", rej, { once: true });
  });

  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    // 首次访问页面时 Next.js 要编译，可能比较慢；给足时间，避免误报超时。
    const budget = method === "Page.navigate" ? 60000 : 20000;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时: ${method}`)); }, budget);
    pending.set(id, msg => { clearTimeout(timer); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await call("Page.enable");
  await call("Runtime.enable");

  console.log(`页面体检开始 —— 目标：${origin}`);
  console.log(`截图与报告将保存到：test-results/inspect/${stamp}/\n`);

  for (const device of devices) {
    const vp = VIEWPORTS[device];
    for (const page of PAGES) {
      // 设置视口
      await call("Emulation.setDeviceMetricsOverride", {
        width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: device === "mobile",
      });
      await call("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
      });

      await call("Page.navigate", { url: origin + page.path });
      await sleep(2800);

      for (const expr of page.setup ?? []) {
        try { await call("Runtime.evaluate", { expression: expr, awaitPromise: true }); } catch { /* 某页没有这个元素是正常的 */ }
        await sleep(1100);
      }

      // 检测（先整体检测，再滚到底单独查一次底部遮挡）
      let audit = null;
      try {
        const raw = await call("Runtime.evaluate", { expression: AUDIT_SCRIPT, returnByValue: true });
        audit = JSON.parse(raw.result.value);
      } catch (error) {
        audit = { error: String(error.message || error), issues: [] };
      }
      if (audit.issues) {
        await sleep(900);
        try {
          const raw = await call("Runtime.evaluate", { expression: BOTTOM_CHECK_SCRIPT, returnByValue: true });
          const bottom = JSON.parse(raw.result.value);
          if (bottom.issues?.length) audit.issues.push(...bottom.issues);
        } catch { /* 底部检查失败不影响主流程 */ }
        audit.issueCount = audit.issues.length;
      }
      await call("Runtime.evaluate", { expression: "window.scrollTo(0,0)" });
      await sleep(500);

      // 截图（整屏 + 视口）
      const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const fileName = `${device}-${page.name}.png`;
      await writeFile(path.join(outDir, fileName), Buffer.from(shot.data, "base64"));

      const found = audit?.issues?.length ?? 0;
      results.push({ device, deviceLabel: vp.label, page: page.name, pageLabel: page.label, screenshot: fileName, audit });
      console.log(`  ${found ? "⚠" : "✓"} ${vp.label} · ${page.label} —— ${found ? found + " 个问题" : "未发现问题"}`);
    }
  }

  socket.close();
} catch (error) {
  console.error("页面体检中断：", error.message);
} finally {
  browser.kill();
}

// ── 生成报告 ────────────────────────────────────────────────
const SEVERITY_LABEL = { high: "严重", medium: "中等", low: "轻微" };
const TYPE_LABEL = {
  "overflow-x": "横向溢出（页面会左右晃）",
  "text-covered": "文字被盖住",
  "floating-button-over-text": "悬浮按钮压住输入框文字",
  "out-of-viewport": "元素跑出屏幕",
  "small-touch-target": "触摸目标过小",
  "small-input-font": "输入框字号过小",
  "nav-overlap": "底部导航压住内容",
};

const allIssues = [];
for (const r of results) {
  for (const issue of r.audit?.issues ?? []) {
    allIssues.push({ ...issue, device: r.deviceLabel, page: r.pageLabel, screenshot: r.screenshot });
  }
}

const bySeverity = { high: [], medium: [], low: [] };
allIssues.forEach(i => (bySeverity[i.severity] ?? bySeverity.low).push(i));

const md = [];
md.push(`# 拾念 · 页面体检报告`);
md.push(``);
md.push(`时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`);
md.push(`目标：${origin}`);
md.push(`视口：${devices.map(d => VIEWPORTS[d].label).join("、")}`);
md.push(``);
md.push(`## 总览`);
md.push(``);
md.push(`| 严重程度 | 数量 |`);
md.push(`| --- | --- |`);
md.push(`| 严重 | ${bySeverity.high.length} |`);
md.push(`| 中等 | ${bySeverity.medium.length} |`);
md.push(`| 轻微 | ${bySeverity.low.length} |`);
md.push(``);

if (allIssues.length === 0) {
  md.push(`本次体检未发现布局问题。`);
} else {
  for (const level of ["high", "medium", "low"]) {
    const list = bySeverity[level];
    if (!list.length) continue;
    md.push(`## ${SEVERITY_LABEL[level]}问题（${list.length}）`);
    md.push(``);
    for (const issue of list) {
      md.push(`### ${TYPE_LABEL[issue.type] ?? issue.type}`);
      md.push(``);
      md.push(`- 位置：${issue.device} · ${issue.page}`);
      md.push(`- 截图：\`${issue.screenshot}\``);
      md.push(`- 说明：${issue.detail}`);
      const items = issue.items ?? issue.culprits ?? [];
      if (items.length) {
        md.push(``);
        md.push(`| 元素 | 细节 |`);
        md.push(`| --- | --- |`);
        for (const it of items) {
          // 不同检测项用不同的字段名，逐个判断，避免出现空白单元格。
          const who = (it.el ?? it.text ?? "").toString().replace(/\|/g, "/") || "（未命名元素）";
          let detail = "";
          if (it.coveredBy) detail = `被 ${it.coveredBy} 盖住 ${it.overlap.w}×${it.overlap.h}px（${it.coverage}）`;
          else if (it.conflict) detail = `盖在 ${it.conflict} 上；文字可用到 ${it.textRightLimit}px，按钮从 ${it.buttonLeft}px 开始（冲突 ${Math.abs(it.gapPx)}px）`;
          else if (it.overflow) detail = `超出屏幕 ${it.overflow}px`;
          else if (it.size) detail = `触摸区只有 ${it.size}`;
          else if (it.fontSize) detail = `字号 ${it.fontSize}`;
          else if (it.by) detail = `${it.dir} ${it.by}px`;
          else if (it.hiddenPx) detail = `被压住 ${it.hiddenPx}px（${it.percent ?? ""}）`;
          md.push(`| ${who} | ${detail} |`);
        }
      }
      md.push(``);
    }
  }
}

md.push(`---`);
md.push(``);
md.push(`## 截图清单`);
md.push(``);
for (const r of results) {
  md.push(`- \`${r.screenshot}\` —— ${r.deviceLabel} · ${r.pageLabel}`);
}
md.push(``);
md.push(`本报告由 \`scripts/page-inspect.mjs\` 自动生成，全程只读：未修改任何文件，未发布，未写入数据。`);

await writeFile(path.join(outDir, "report.md"), md.join("\n"), "utf8");
await writeFile(path.join(outDir, "report.json"), JSON.stringify({ stamp, origin, devices, results }, null, 2), "utf8");

console.log(`\n体检完成。`);
console.log(`  严重 ${bySeverity.high.length} 个 · 中等 ${bySeverity.medium.length} 个 · 轻微 ${bySeverity.low.length} 个`);
console.log(`  报告：test-results/inspect/${stamp}/report.md`);
