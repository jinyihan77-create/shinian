/**
 * 自动发布引擎：每 5 分钟被 Windows 计划任务唤醒一次，判断"有没有新改动需要上线"。
 *
 * 设计目标：让「改完代码 → 线上更新」这件事完全不需要人记住。
 * 但**绝不能**把线上搞挂，所以真正的发布仍然必须走 ship 闸门（类型检查 / 构建 / 测试），
 * 并且发布后要做健康检查，发现问题自动回滚到上一个好版本。
 *
 * 一次 tick 的决策顺序（任何一步不满足就直接安静退出，不动线上）：
 *   1. 总开关关着？          → 退出
 *   2. 已经有发布在跑？      → 退出（互斥锁）
 *   3. 没有需要发布的新改动？→ 退出
 *   4. 文件还在被改（静默期没到）？→ 退出，等下次
 *   5. 上次失败还在冷却中？  → 退出
 *   6. 以上都过 → 跑 ship 闸门 → 发布 → 健康检查 → （失败则自动回滚）
 *
 * 命令行用法：
 *   node scripts/auto-publish.mjs                 执行一次检查（计划任务用的就是这个）
 *   node scripts/auto-publish.mjs --dry-run       只判断"会不会发布"，不发布
 *   node scripts/auto-publish.mjs --status        打印当前状态（不联网、不改动）
 *   node scripts/auto-publish.mjs --probe         只做线上健康检查
 *   node scripts/auto-publish.mjs --force         忽略静默期/冷却，立刻发布
 *   node scripts/auto-publish.mjs --rollback-to <版本名>   手动回退到指定版本
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_FILES } from "./prepare-tencent-deploy.mjs";
import { acquirePublishLock, describePublishLock } from "./publish-lock.mjs";
import {
  CONFIG_FILE, LOG_FILE, appendHistory, formatTime, loadState, projectRoot,
  saveState, writeLog,
} from "./publish-state.mjs";

const project = projectRoot;
const require = createRequire(import.meta.url);

const DEFAULTS = Object.freeze({
  enabled: true,
  siteOrigin: "",
  quietMinutes: 5,
  retryCooldownMinutes: 30,
  healthCheckRetries: 3,
  autoRollback: true,
});

const args = process.argv.slice(2);
const has = flag => args.includes(flag);
const valueOf = flag => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : "";
};

// ── 基础工具 ─────────────────────────────────────────────────

/** 计划任务在后台跑，日志是唯一的记录渠道，所以这里始终落盘。 */
function log(message) {
  return writeLog(message, { echo: true });
}

async function loadConfig() {
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") await log(`配置文件无法解析，改用默认值：${error.message}`);
  }
  // 环境 ID / 服务名与发布脚本保持同一来源，避免两处配置漂移。
  let cloudbaserc = {};
  try { cloudbaserc = JSON.parse(await readFile(path.join(project, "cloudbaserc.json"), "utf8")); } catch { /* 缺失即忽略 */ }
  // APP_ORIGIN 优先从 .env.local 读，保证与实际部署目标一致。
  try { process.loadEnvFile(path.join(project, ".env.local")); } catch { /* 缺失即忽略 */ }

  const config = { ...DEFAULTS, ...fileConfig };
  config.siteOrigin = String(fileConfig.siteOrigin || process.env.APP_ORIGIN || "").trim().replace(/\/$/, "");
  config.envId = String(process.env.CLOUDBASE_ENV_ID || cloudbaserc.envId || "").trim();
  config.region = String(process.env.CLOUDBASE_REGION || "ap-shanghai").trim();
  config.serviceName = String(cloudbaserc?.cloudrun?.name || "inspiration-echo").trim();
  config.enabled = fileConfig.enabled !== false;
  return config;
}

function git(gitArgs) {
  return new Promise(resolve => {
    // core.quotepath=false：让中文文件名原样输出，否则 git 会转义成 \344\275... 对不上真实路径。
    const child = spawn("git", ["-c", "core.quotepath=false", ...gitArgs], { cwd: project, windowsHide: true });
    let out = "";
    child.stdout.on("data", chunk => { out += chunk; });
    child.stderr.resume();
    child.once("error", () => resolve({ ok: false, out: "" }));
    child.once("close", code => resolve({ ok: code === 0, out }));
  });
}

function runStreaming(command, commandArgs, { onLine, env = {} } = {}) {
  return new Promise(resolve => {
    // Windows 上用 shell 时，Node 只做字符串拼接、不加引号。
    // node.exe 的完整路径是 "C:\Program Files\nodejs\node.exe"（带空格），
    // 交给 cmd 会被截成 "C:\Program" 直接失败——所以绝对路径的命令一律不走 shell。
    // npm / npx 这类 .cmd 包装脚本才需要 shell。
    const needsShell = process.platform === "win32" && !path.isAbsolute(command);
    const child = spawn(command, commandArgs, {
      cwd: project,
      shell: needsShell,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...env },
    });
    let buffer = "";
    const consume = chunk => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) onLine?.(line);
    };
    child.stdout.on("data", chunk => consume(String(chunk)));
    child.stderr.on("data", chunk => consume(String(chunk)));
    child.once("error", error => resolve({ ok: false, code: -1, tail: error.message }));
    child.once("close", code => {
      if (buffer) onLine?.(buffer);
      resolve({ ok: code === 0, code });
    });
  });
}

/** 跑腾讯云 CLI，stdout/stderr 都不回显（可能含内部信息）。 */
function runTcb(cliArgs, timeoutMs = 25 * 60_000) {
  return new Promise(resolve => {
    const cliEntry = path.join(path.dirname(require.resolve("@cloudbase/cli/package.json")), "bin", "tcb");
    const child = spawn(process.execPath, [cliEntry, ...cliArgs], {
      cwd: project,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", TCB_SITE: "domestic" },
    });
    let stdout = "";
    child.stdout.on("data", chunk => { if (stdout.length < 2 * 1024 * 1024) stdout += chunk; });
    child.stderr.resume();
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once("error", () => { clearTimeout(timer); resolve({ ok: false, stdout: "" }); });
    child.once("close", code => { clearTimeout(timer); resolve({ ok: code === 0, stdout }); });
  });
}

// ── 变更检测 ─────────────────────────────────────────────────

const DEPLOY_FILE_SET = new Set(SOURCE_FILES);

/** 这个文件会不会被同步到线上？（只认准备脚本真正会打包的东西） */
function isDeployRelevant(file) {
  const normalized = file.replace(/\\/g, "/");
  if (DEPLOY_FILE_SET.has(normalized)) return true;
  return normalized.startsWith("src/") || normalized.startsWith("public/");
}

/** 工作区里尚未提交的改动 + 上次发布之后新产生的提交，一起算作"待发布"。 */
async function collectPendingChanges(lastPublishedCommit) {
  const files = new Map();

  const status = await git(["status", "--porcelain"]);
  if (status.ok) {
    for (const line of status.out.split("\n")) {
      if (!line.trim()) continue;
      const file = line.slice(3).trim().replace(/^"|"$/g, "");
      if (!file) continue;
      // 重命名条目形如 "old -> new"，取新路径。
      const target = file.includes(" -> ") ? file.split(" -> ").pop() : file;
      if (isDeployRelevant(target)) files.set(target.replace(/\\/g, "/"), { fromWorkingTree: true });
    }
  }

  const head = await git(["rev-parse", "HEAD"]);
  const headCommit = head.ok ? head.out.trim() : "";
  if (lastPublishedCommit && headCommit && headCommit !== lastPublishedCommit) {
    const diff = await git(["diff", "--name-only", `${lastPublishedCommit}..HEAD`]);
    if (diff.ok) {
      for (const file of diff.out.split("\n")) {
        const target = file.trim().replace(/\\/g, "/");
        if (target && isDeployRelevant(target)) {
          const existing = files.get(target) ?? {};
          files.set(target, { ...existing, fromCommit: true });
        }
      }
    }
  }

  return { files: [...files.keys()].sort(), headCommit };
}

/** 待发布文件里"最后一次被改动"的时间，用来判断是不是还在写。 */
async function newestChangeTime(files) {
  let newest = 0;
  let oldest = Number.POSITIVE_INFINITY;
  for (const file of files) {
    const info = await stat(path.join(project, file)).catch(() => null);
    if (!info) continue;
    newest = Math.max(newest, info.mtimeMs);
    oldest = Math.min(oldest, info.mtimeMs);
  }
  return { newest, oldest: Number.isFinite(oldest) ? oldest : newest };
}

/**
 * 按文件内容算指纹。
 *
 * 为什么不能只看"有没有改动"：如果一次发布因为代码问题被闸门拦下，
 * 改动会一直躺在工作区里。只看"有改动"的话，每过一个冷却周期就会重跑一遍
 * 十几分钟的构建+测试，纯属浪费。指纹相同就说明"这批内容已经试过了、没通过"，
 * 直接跳过，等你真正改了东西再试。
 */
async function fingerprintFiles(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    const content = await readFile(path.join(project, file)).catch(() => null);
    hash.update(file);
    hash.update("\0");
    if (content) hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

// ── 线上健康检查与回滚 ───────────────────────────────────────

/** 取当前线上版本名（OnlineVersionInfos[0]）。 */
async function fetchOnlineVersion(config) {
  const detail = await runTcb([
    "cloudrun", "detail",
    "--env-id", config.envId,
    "--region", config.region,
    "--service-name", config.serviceName,
    "--json",
  ], 120_000);
  if (!detail.ok) return { ok: false };
  const start = detail.stdout.indexOf("{");
  if (start < 0) return { ok: false };
  try {
    const parsed = JSON.parse(detail.stdout.slice(start));
    const info = parsed?.data?.OnlineVersionInfos?.[0];
    return { ok: true, versionName: info?.VersionName || "", flowRatio: info?.FlowRatio || "" };
  } catch {
    return { ok: false };
  }
}

/**
 * 健康检查：线上真的能打开、配置真的生效。
 * 冷启动（MinNum=0）时容器要现拉起来，所以重试几次。
 */
export async function probeSite(origin, { retries = 3, timeoutMs = 25_000 } = {}) {
  let reason = "健康检查未通过";
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const home = await fetch(origin + "/", { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      if (home.status !== 200) {
        reason = `首页返回 HTTP ${home.status}`;
      } else {
        const html = await home.text();
        if (!html.includes("拾念")) {
          reason = "首页内容不含站点标题";
        } else {
          const session = await fetch(origin + "/api/auth/session", { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
          if (session.status !== 200) {
            reason = `会话接口返回 HTTP ${session.status}`;
          } else {
            const body = await session.json().catch(() => null);
            if (body?.configured !== true) reason = "会话接口 configured 不为 true（运行变量可能没生效）";
            else return { ok: true, attempts: attempt };
          }
        }
      }
    } catch (error) {
      reason = error?.name === "TimeoutError" ? "请求超时" : "连接失败";
    }
    // 冷启动（MinNum=0）时容器要现拉起来，给下一次尝试留出时间。
    if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 6_000));
  }
  return { ok: false, attempts: retries, reason };
}

/** 把流量切回指定版本。--force 跳过交互确认（计划任务里没有终端）。 */
async function rollbackTo(config, versionName) {
  const result = await runTcb([
    "cloudrun", "version", "rollback",
    "--env-id", config.envId,
    "--service-name", config.serviceName,
    "--rollback-version-name", versionName,
    "--operator-remark", "auto-publish health check failed",
    "--force",
  ], 10 * 60_000);
  return { ok: result.ok };
}

// ── 发布 ─────────────────────────────────────────────────────

async function publishViaGate() {
  const failedSteps = [];
  // 只有这几步失败才会阻止发布。存档类步骤失败是非致命的（ship 里会继续往下走），
  // 不能算进"未通过"，否则状态页会误报。
  const fatalSteps = ["类型检查（tsc）", "生产构建（next build）", "测试（vitest）", "测试（vitest）· 重试", "发布到云托管"];
  const result = await runStreaming(process.execPath, ["scripts/ship.mjs"], {
    // 告诉 ship：锁已经在自动发布手里，别再抢一次（会自己锁死自己）；
    // 账本也由自动发布在这边统一记（它还要做健康检查和回滚）。
    env: { ECHO_PUBLISH_LOCK_HELD: "1", ECHO_PUBLISH_AUTOMATION: "1" },
    onLine: line => {
      const text = line.trimEnd();
      if (text.trim()) console.log(text);
      const match = text.match(/^✗\s+(.+?)\s+未通过（用时/);
      if (match && fatalSteps.includes(match[1])) failedSteps.push(match[1]);
    },
  });
  return { ok: result.ok, failedSteps };
}

// ── 状态展示 ─────────────────────────────────────────────────

function describeLastResult(state) {
  const map = {
    success: "✅ 上次发布成功",
    "checks-failed": "⚠️ 上次检查未通过（线上没被改动）",
    "deploy-failed": "⚠️ 上次发布命令失败（线上没被改动）",
    "health-failed-rolled-back": "🔴 上次发布后健康检查失败，已自动回滚",
    "health-failed-manual": "🔴 上次发布后健康检查失败，需要人工处理",
    "lock-busy": "⏳ 上次跳过：有发布正在进行",
    "invalid-config": "⚠️ 上次跳过：配置不完整",
  };
  return map[state.lastAttemptResult] || "（还没有发布记录）";
}

async function printStatus() {
  const config = await loadConfig();
  const state = await loadState();
  const lock = await describePublishLock();

  console.log("\n" + "═".repeat(58));
  console.log("  自动发布 · 当前状态");
  console.log("═".repeat(58) + "\n");
  console.log(`  总开关：${config.enabled ? "已开启（每 5 分钟自动检查）" : "已关闭"}`);
  console.log(`  线上地址：${config.siteOrigin || "（未配置）"}`);
  if (state.lastCheckAt) {
    const minutesAgo = Math.floor((Date.now() - Date.parse(state.lastCheckAt)) / 60_000);
    const label = {
      idle: "没有需要发布的东西",
      clean: "没有需要发布的东西",
      "waiting-quiet": "有新改动，但还在等你改完（静默期）",
      publishing: "正在进行发布",
      "same-as-failed": "这批改动上次没通过检查，内容没变就暂不重试",
      cooldown: "上次未成功，正在冷却",
      busy: "跳过：当时有别的发布在跑",
      disabled: "总开关关闭",
      "invalid-config": "配置不完整",
    }[state.lastCheckResult] || state.lastCheckResult;
    console.log(`  上次检查：${formatTime(state.lastCheckAt)}（${minutesAgo} 分钟前）— ${label}`);
  } else {
    console.log(`  上次检查：（还没有记录，任务可能刚装好）`);
  }

  if (lock) {
    console.log(`\n  ⏳ 此刻有发布正在进行：${lock.owner}`);
    console.log(`     开始于 ${formatTime(lock.startedAt)}`);
  } else {
    console.log("\n  此刻没有发布在进行。");
  }

  const { files, headCommit } = await collectPendingChanges(state.lastPublishedCommit);
  if (!files.length) {
    console.log("\n  ✨ 没有需要发布的新改动，线上已是最新。");
  } else {
    console.log(`\n  📝 有 ${files.length} 个待发布文件：`);
    for (const file of files.slice(0, 12)) console.log(`     · ${file}`);
    if (files.length > 12) console.log(`     … 另有 ${files.length - 12} 个`);
    const times = await newestChangeTime(files);
    const idleMinutes = Math.floor((Date.now() - times.newest) / 60_000);
    console.log(`\n  最后一次改动：${idleMinutes} 分钟前。`);
    console.log(`  静默期 ${config.quietMinutes} 分钟：${idleMinutes >= config.quietMinutes ? "已满足，下次检查就会发布" : `还差 ${config.quietMinutes - idleMinutes} 分钟`}`);
    if (headCommit && state.lastPublishedCommit && headCommit !== state.lastPublishedCommit) {
      console.log(`  其中包含已存档但还没上线的提交。`);
    }
  }

  console.log(`\n  ${describeLastResult(state)}`);
  if (state.lastAttemptDetail) console.log(`     说明：${state.lastAttemptDetail}`);
  if (state.lastPublishedAt) {
    console.log(`  上次成功发布：${formatTime(state.lastPublishedAt)}`);
  }
  if (state.lastOnlineVersion) console.log(`  发布后的线上版本：${state.lastOnlineVersion}`);

  if (state.history?.length) {
    console.log("\n  最近几次记录：");
    for (const item of state.history.slice(-6).reverse()) {
      console.log(`     ${formatTime(item.at)}  ${item.summary}`);
    }
  }

  console.log(`\n  日志文件：${path.relative(project, LOG_FILE)}`);
  console.log(`  配置：${path.relative(project, CONFIG_FILE)}\n`);
}

// ── 主流程 ───────────────────────────────────────────────────

async function tick({ dryRun = false, force = false } = {}) {
  const config = await loadConfig();
  const state = await loadState();

  // 心跳：每次被唤醒都记一笔"我检查过了"。
  // 没有这个的话，自动发布在"没东西要发"时完全静默，你无从判断它到底是
  // 在正常工作、还是任务根本没跑起来。状态页会显示最后一次检查时间。
  const heartbeat = { lastCheckAt: new Date().toISOString(), lastCheckResult: "idle" };
  const beat = async result => {
    if (dryRun) return;
    await saveState({ ...(await loadState()), ...heartbeat, lastCheckResult: result });
  };

  if (!config.enabled) {
    if (dryRun) console.log("总开关已关闭，不做任何事。");
    await beat("disabled");
    return 0;
  }

  if (!config.envId || !config.serviceName || !config.siteOrigin) {
    await log("配置不完整（缺少环境 ID / 服务名 / 线上地址），跳过本次检查。");
    await saveState({ ...state, ...heartbeat, lastCheckResult: "invalid-config", lastAttemptAt: new Date().toISOString(), lastAttemptResult: "invalid-config", lastAttemptDetail: "配置不完整" });
    return 0;
  }

  const held = await describePublishLock();
  if (held) {
    if (dryRun) console.log(`已有发布在进行（${held.owner}），本次跳过。`);
    await beat("busy");
    return 0;
  }

  const { files, headCommit } = await collectPendingChanges(state.lastPublishedCommit);
  if (!files.length) {
    if (dryRun) console.log("没有需要发布的新改动。");
    await beat("clean");
    return 0;
  }

  const fingerprint = await fingerprintFiles(files);
  if (!force && fingerprint === state.lastFailedFingerprint) {
    if (dryRun) console.log(`这 ${files.length} 个文件的当前内容上次已经试过、没通过检查，内容没变就再等，不重复跑。`);
    await beat("same-as-failed");
    return 0;
  }

  const times = await newestChangeTime(files);
  const idleMinutes = (Date.now() - times.newest) / 60_000;

  // 静默期是硬条件：只要有文件在最近 quietMinutes 内被碰过，就说明你可能还在改。
  // 这里刻意不加"等太久就强行发布"的兜底——那会在你写到一半时把半成品推上线。
  // 唯一的例外是 --force（你明确要求立刻发布）。
  if (!force && idleMinutes < config.quietMinutes) {
    if (dryRun) {
      console.log(`有 ${files.length} 个文件待发布，但最后一次改动在 ${Math.floor(idleMinutes)} 分钟前（静默期 ${config.quietMinutes} 分钟），本次不发布。`);
    }
    await beat("waiting-quiet");
    return 0;
  }

  if (state.lastAttemptAt && !force) {
    const sinceAttempt = (Date.now() - Date.parse(state.lastAttemptAt)) / 60_000;
    const badLastTime = ["checks-failed", "deploy-failed", "health-failed-rolled-back", "health-failed-manual", "invalid-config"].includes(state.lastAttemptResult);
    if (badLastTime && sinceAttempt < config.retryCooldownMinutes) {
      if (dryRun) {
        console.log(`上次尝试未成功（${state.lastAttemptResult}），冷却 ${config.retryCooldownMinutes} 分钟中（已过 ${Math.floor(sinceAttempt)} 分钟）。`);
      }
      await beat("cooldown");
      return 0;
    }
  }

  if (dryRun) {
    console.log(`会发布：${files.length} 个文件已稳定（最后一次改动 ${Math.floor(idleMinutes)} 分钟前）。`);
    console.log("（--dry-run 只做判断，没有真正发布）");
    return 0;
  }

  await log(`发现 ${files.length} 个待发布文件，开始走发布闸门。`);
  await saveState({ ...(await loadState()), ...heartbeat, lastCheckResult: "publishing", pendingFileCount: files.length });

  const lock = await acquirePublishLock({ owner: "自动发布" });
  if (!lock.ok) {
    await log(`已有发布在跑（${lock.heldBy}），本次跳过。`);
    await beat("busy");
    return 0;
  }

  const startedAt = Date.now();
  const versionBefore = await fetchOnlineVersion(config);
  const previousVersion = versionBefore.ok ? versionBefore.versionName : "";
  if (previousVersion) await log(`发布前的线上版本：${previousVersion}`);

  try {
    const gate = await publishViaGate();
    const seconds = Math.round((Date.now() - startedAt) / 1000);

    // ship 的第一步就是自动存档，所以发布时的工作区已经被提交成一个新 commit。
    // 必须在这里重新读 HEAD：用发布前那个 commit 记账的话，下一轮会把同一批内容
    // 当成"新改动"再发布一次，形成无意义的重复上线。
    const headAfter = await git(["rev-parse", "HEAD"]);
    const publishedCommit = headAfter.ok ? headAfter.out.trim() : headCommit;

    if (!gate.ok) {
      const detail = gate.failedSteps.length ? `未通过：${gate.failedSteps.join("、")}` : "发布流程未成功完成";
      await log(`检查未通过，线上未被改动。${detail}（用时 ${seconds}s）`);
      await saveState({
        ...state,
        lastAttemptAt: new Date().toISOString(),
        lastAttemptResult: gate.failedSteps.length ? "checks-failed" : "deploy-failed",
        lastAttemptDetail: detail,
        // 内容没变就不再重试，避免反复跑十几分钟的构建。
        lastFailedFingerprint: fingerprint,
        history: await appendHistory(state, `❌ ${detail}，线上未变动`),
      });
      return 1;
    }

    const after = await fetchOnlineVersion(config);
    const newVersion = after.ok ? after.versionName : "";

    // 新版本必须先通过健康检查才算发布成功。
    const health = await probeSite(config.siteOrigin, { retries: config.healthCheckRetries });
    const elapsed = Math.round((Date.now() - startedAt) / 1000);

    if (health.ok) {
      await log(`发布成功，健康检查通过。线上版本：${newVersion || "（未知）"}（总用时 ${elapsed}s）`);
      await saveState({
        ...state,
        lastPublishedCommit: publishedCommit || state.lastPublishedCommit,
        lastPublishedAt: new Date().toISOString(),
        lastOnlineVersion: newVersion,
        lastGoodVersion: newVersion || previousVersion,
        lastAttemptAt: new Date().toISOString(),
        lastAttemptResult: "success",
        lastAttemptDetail: "",
        lastFailedFingerprint: "",
        consecutiveFailures: 0,
        history: await appendHistory(state, `✅ 发布成功 → ${newVersion || "新版本"}`),
      });
      return 0;
    }

    await log(`发布完成但健康检查未通过：${health.reason}`);

    if (config.autoRollback && previousVersion) {
      const rolled = await rollbackTo(config, previousVersion);
      if (rolled.ok) {
        const recovered = await probeSite(config.siteOrigin, { retries: 2 });
        await log(recovered.ok
          ? `已自动回滚到 ${previousVersion}，线上恢复正常。`
          : `已回滚到 ${previousVersion}，但健康检查仍不通过，需要人工查看。`);
        await saveState({
          ...state,
          // 回滚后线上是旧版本，所以按旧版本记账，让这批内容下次还能被重试。
          lastOnlineVersion: previousVersion,
          lastAttemptAt: new Date().toISOString(),
          lastAttemptResult: "health-failed-rolled-back",
          lastAttemptDetail: `新版本 ${newVersion || "未知"} 健康检查失败（${health.reason}），已回滚到 ${previousVersion}`,
          lastFailedFingerprint: fingerprint,
          history: await appendHistory(state, `🔴 新版健康检查失败，已回滚到 ${previousVersion}`),
        });
        return 1;
      }
      await log(`自动回滚未成功，请手动处理：node scripts/auto-publish.mjs --rollback-to ${previousVersion}`);
    }

    await saveState({
      ...state,
      lastOnlineVersion: newVersion,
      lastAttemptAt: new Date().toISOString(),
      lastAttemptResult: "health-failed-manual",
      lastAttemptDetail: `新版本 ${newVersion || "未知"} 健康检查失败（${health.reason}），未回滚`,
      lastFailedFingerprint: fingerprint,
      history: await appendHistory(state, `🔴 新版健康检查失败，未自动回滚`),
    });
    return 1;
  } finally {
    await lock.release();
  }
}

async function main() {
  // --task：由计划的隐藏启动器调用。输出已经全部落到日志文件，
  // 这里不再往终端打印，避免留下任何可见窗口痕迹。
  if (has("--task")) {
    try {
      process.exitCode = await tick({});
    } catch (error) {
      await log(`自动发布异常终止：${error?.message || "未知错误"}`);
      process.exitCode = 1;
    }
    return;
  }

  if (has("--status")) return void await printStatus();

  if (has("--probe")) {
    const config = await loadConfig();
    if (!config.siteOrigin) { console.log("未配置线上地址。"); return; }
    const result = await probeSite(config.siteOrigin);
    console.log(result.ok ? `线上健康检查通过（第 ${result.attempts} 次尝试）。` : `线上健康检查未通过：${result.reason}`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const rollbackTarget = valueOf("--rollback-to");
  if (rollbackTarget) {
    const config = await loadConfig();
    const current = await fetchOnlineVersion(config);
    if (current.ok && current.versionName === rollbackTarget) {
      console.log(`线上当前就是 ${rollbackTarget}，无需回退。`);
      return;
    }
    console.log(`正在把流量切回 ${rollbackTarget} …`);
    const result = await rollbackTo(config, rollbackTarget);
    if (!result.ok) { console.log("回退命令未成功，请检查授权与版本名。"); process.exitCode = 1; return; }
    const health = await probeSite(config.siteOrigin, { retries: 2 });
    console.log(health.ok ? `已回退到 ${rollbackTarget}，线上正常。` : `已回退到 ${rollbackTarget}，但健康检查未通过。`);
    return;
  }

  const config = await loadConfig();
  if (!config.envId || !config.serviceName || !config.siteOrigin) {
    console.log("自动发布尚未完成配置（缺少环境 ID / 服务名 / 线上地址）。");
    console.log("请先运行：node scripts/auto-publish-control.mjs install");
    return;
  }
  process.exitCode = await tick({ dryRun: has("--dry-run"), force: has("--force") });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
