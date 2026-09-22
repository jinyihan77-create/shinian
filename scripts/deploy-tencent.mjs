/**
 * 腾讯云 CloudRun 发布脚本（本项目此前缺失的最后一环）。
 *
 * 用法：
 *   node scripts/deploy-tencent.mjs --check        只检查本地配置，不联网、不发布
 *   node scripts/deploy-tencent.mjs                生成干净上传目录，然后发布 CloudRun
 *   node scripts/deploy-tencent.mjs --no-prepare   跳过生成步骤，直接用现有上传目录发布
 *   node scripts/deploy-tencent.mjs --detail       只查询线上服务详情（用于取得正式地址）
 *
 * 设计约束（与项目其余脚本一致）：
 *   - 运行变量不属于镜像，也不通过本脚本上传；须在云托管控制台「服务设置 → 环境变量」配置。
 *     新版 `tcb cloudrun deploy` 没有 --envParams 参数，因此这里不尝试设置它们。
 *   - 发布源固定为 prepare-tencent-deploy.mjs 产出的净化目录，不发布项目根目录。
 *   - 只显示变量名和状态，不打印任何配置值、密码或凭据；CLI 输出经过裁剪后才回显。
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeConfigReport } from "./prepare-tencent-deploy.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const STAGING = "test-results/tencent-deploy-staging";
const DEFAULT_SERVICE_NAME = "inspiration-echo";

const messages = {
  NOT_LOGGED_IN: "尚未完成腾讯云授权。请先在本项目目录执行 `npx tcb login`，用微信扫码登录后重试。",
  ENV_ID_MISSING: "未找到环境 ID。请先在腾讯云控制台创建 PostgreSQL 环境，把环境 ID 写入 .env.local 的 CLOUDBASE_ENV_ID。",
  STAGING_MISSING: "干净上传目录不存在。请先执行 `npm run prepare:tencent`，或运行本脚本时不加 --no-prepare。",
  RUNTIME_INCOMPLETE: "运行变量尚未齐备。仍可发布，但网站会显示“你的空间正在准备中”，直到在控制台补齐环境变量。",
  DEPLOY_FAILED: "云托管发布未成功完成。响应详情已隐藏以保护凭据；请检查登录状态、环境 ID、服务名与套餐权限后重试。",
  DETAIL_FAILED: "查询云托管服务详情未成功。请确认服务已部署、环境 ID 与服务名正确。",
  PREPARE_FAILED: "本地部署目录生成未完成。请检查构建源文件，未执行远程发布。",
  INVALID_ARGS: "参数无效。可用参数：--check、--no-prepare、--detail、--yes。",
};

function fail(code) {
  throw new Error(code);
}

/** 读取 .env.local 等文件到 process.env（缺失即跳过），再汇总出本次发布所需配置。 */
async function loadProjectConfig() {
  for (const file of [".env.local", ".env.tencent-owner.local"]) {
    try { process.loadEnvFile(path.join(project, file)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  let cloudbaserc = {};
  try { cloudbaserc = JSON.parse(await readFile(path.join(project, "cloudbaserc.json"), "utf8")); }
  catch { /* 缺失时仅依赖 .env.local。 */ }
  return {
    envId: (process.env.CLOUDBASE_ENV_ID || cloudbaserc.envId || "").trim(),
    region: (process.env.CLOUDBASE_REGION || "ap-shanghai").trim(),
    serviceName: (cloudbaserc?.cloudrun?.name || DEFAULT_SERVICE_NAME).trim(),
  };
}

/** 等待子进程结束并拿到退出码；绝不把 stderr 内容回显出来。 */
function runNode(args, { inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: project,
      windowsHide: true,
      stdio: inherit ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    if (!inherit) { child.stdout.on("data", chunk => { if (stdout.length < 1024 * 1024) stdout += chunk; }); child.stderr.resume(); }
    child.once("error", reject);
    child.once("close", code => resolve({ code, stdout }));
  });
}

function runCli(cliEntry, args, { withStderr = false, timeoutMs = 25 * 60 * 1000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: project,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", TCB_SITE: "domestic", ...env },
    });
    let stdout = ""; let stderr = ""; let bytes = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error("TIMEOUT")); }, timeoutMs);
    child.stdout.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) { child.kill(); return; }
      stdout += chunk;
    });
    // 默认丢弃 stderr；CLI 出错时它可能包含平台响应，仅在明确需要时保留。
    if (withStderr) child.stderr.on("data", chunk => { if (stderr.length < 64 * 1024) stderr += chunk; });
    else child.stderr.resume();
    child.once("error", () => { clearTimeout(timer); reject(new Error("SPAWN_FAILED")); });
    child.once("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

function printConfigStatus() {
  const report = runtimeConfigReport(process.env);
  console.log("\n运行变量名称检查（只显示名称与状态，不显示值）：");
  for (const key of report.runtimeKeys) {
    const state = report.missing.includes(key) ? "未填写" : report.invalid.includes(key) ? "格式不符合要求" : "已填写";
    console.log(`  ${key}：${state}`);
  }
  console.log(report.ready ? "\n配置名称齐备。" : `\n${messages.RUNTIME_INCOMPLETE}`);
}

async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(["--check", "--no-prepare", "--detail", "--yes"]);
  if (args.some(arg => !allowed.has(arg))) {
    console.error(messages.INVALID_ARGS);
    process.exitCode = 1;
    return;
  }
  const checkOnly = args.includes("--check");
  const detailOnly = args.includes("--detail");
  const skipPrepare = args.includes("--no-prepare");
  const assumeYes = args.includes("--yes");

  try {
    const config = await loadProjectConfig();
    console.log("腾讯云 CloudRun 发布助手");
    console.log(`  环境 ID：${config.envId || "（未填写）"}`);
    console.log(`  地域：${config.region}`);
    console.log(`  服务名：${config.serviceName}`);

    if (checkOnly) {
      printConfigStatus();
      console.log("\n检查模式：未联网、未发布、未修改任何远程资源。");
      return;
    }

    if (!config.envId) fail("ENV_ID_MISSING");
    const cliEntry = path.join(path.dirname(require.resolve("@cloudbase/cli/package.json")), "bin", "tcb");

    if (detailOnly) {
      const { code, stdout } = await runCli(cliEntry, ["cloudrun", "detail", "--env-id", config.envId, "--region", config.region, "--service-name", config.serviceName, "--json"]);
      if (code !== 0) fail("DETAIL_FAILED");
      // 服务详情只含配置与访问地址，不含凭据；原样输出，便于核对正式域名。
      console.log("\n云托管服务详情（在其中查找正式访问地址）：");
      console.log(stdout.trim());
      return;
    }

    if (!skipPrepare) {
      console.log("\n[1/3] 生成干净上传目录（本地操作，不联网）…");
      const prepare = await runNode([path.join(project, "scripts", "prepare-tencent-deploy.mjs")], { inherit: true });
      if (prepare.code !== 0) fail("PREPARE_FAILED");
    } else {
      console.log("\n[1/3] 已跳过生成步骤（--no-prepare）。");
    }

    console.log("\n[2/3] 发布到 CloudRun（云端用 Dockerfile 构建镜像，通常需要几分钟）…");
    const deployArgs = [
      // -y 必须是全局选项：CLI 的灰度发布提示只认 globalOptions.yes，不认 isYesMode。
      ...(assumeYes ? ["--yes"] : []),
      "cloudrun", "deploy",
      "--env-id", config.envId,
      "--region", config.region,
      "--service-name", config.serviceName,
      "--source", STAGING,
      "--port", "3000",
      "--min-num", "0",
      "--max-num", "1",
      "--open-access-types", "PUBLIC",
      "--wait",
      "--force",
    ];
    const { code, stdout } = await runCli(cliEntry, deployArgs, {
      withStderr: true,
      // 无 TTY 且未指定 -y 时，CLI 会停下来等待确认而卡住；这里给一个可读的失败提示。
      env: assumeYes ? {} : { CLOUDBASE_CI: "1" },
    });
    if (code !== 0) {
      if (/login|登录|未授权|credential/i.test(stdout)) fail("NOT_LOGGED_IN");
      fail("DEPLOY_FAILED");
    }
    console.log("发布命令已完成。云端构建结果：");
    console.log(stdout.trim());

    console.log("\n[3/3] 必须在控制台完成的步骤（本脚本无法代做）：");
    console.log("  1. 云托管 → 服务 → 你的服务 → 服务设置 → 环境变量，新建版本并填入 7 个变量：");
    console.log("     CLOUD_PROVIDER=cloudbase");
    console.log("     CLOUDBASE_ENV_ID=" + config.envId);
    console.log("     CLOUDBASE_REGION=" + config.region);
    console.log("     CLOUDBASE_AI_MODEL=（控制台 AI → 生文模型里开启的模型名）");
    console.log("     OWNER_USERNAME=echo-owner");
    console.log("     OWNER_EMAIL=（你自己的真实邮箱）");
    console.log("     APP_ORIGIN=（正式地址，不含结尾斜杠和路径）");
    console.log("  2. 控制台 AI → 生文模型，开启要用的模型，模型名要与 CLOUDBASE_AI_MODEL 完全一致。");
    console.log("  3. 环境变量保存后需再发布一次才生效：npm run deploy:tencent -- --no-prepare --yes");
    console.log("  4. 查看正式地址：node scripts/deploy-tencent.mjs --detail");
    console.log("  5. 真实验收：node scripts/verify-live-deployment.mjs --origin https://你的地址");
    printConfigStatus();
    console.log("\n本脚本只完成代码上传，不代表网站已可登录、同步或 AI 已可用。");
  } catch (error) {
    console.error(messages[error.message] || "发布流程未完成。响应内容已隐藏以保护凭据；可核对状态后重试。");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
