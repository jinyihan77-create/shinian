/**
 * 通过腾讯云 tcbr API 更新云托管服务的运行环境变量。
 *
 * 背景：新版 `tcb cloudrun deploy` 没有 --envParams 参数；已废弃的
 * `tcb run deploy --envParams` 在当前 CLI 版本上参数解析失败。本脚本按 CLI
 * 内部 CloudService.getRequestSign 的 TC3-HMAC-SHA256 方式直接调用
 * UpdateCloudRunServer，只提交 Items[EnvParam]，其余服务配置保持不变。
 *
 * 用法：
 *   node scripts/set-env-tencent.mjs --check   只显示将写入的变量名，不联网
 *   node scripts/set-env-tencent.mjs           真实提交
 *   node scripts/set-env-tencent.mjs --verify  提交后回读云端确认
 *
 * 凭据读自本机 CLI 登录文件，不进入命令行参数、不打印。
 */
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_KEYS = ["CLOUD_PROVIDER", "CLOUDBASE_ENV_ID", "CLOUDBASE_REGION", "CLOUDBASE_AI_MODEL", "CLOUDBASE_APIKEY", "OWNER_USERNAME", "OWNER_EMAIL", "APP_ORIGIN"];
const SERVICE = "tcbr";
const VERSION = "2022-02-17";
const DEFAULT_SERVICE_NAME = "inspiration-echo";
const messages = {
  NOT_LOGGED_IN: "未找到本机腾讯云登录凭据。请先执行 `npx tcb login`。",
  INCOMPLETE: "运行变量不齐备，未提交。",
  REQUEST_FAILED: "腾讯云接口未返回成功结果，未确认环境变量已生效。响应详情已隐藏。",
  INVALID_ARGS: "参数无效。可用参数：--check、--verify。",
};

const sha256 = (message, secret, encoding) => crypto.createHmac("sha256", secret).update(message).digest(encoding);
const hash = message => crypto.createHash("sha256").update(message).digest("hex");
const utcDate = ts => { const d = new Date(ts * 1000); return `${d.getUTCFullYear()}-${("0" + (d.getUTCMonth() + 1)).slice(-2)}-${("0" + d.getUTCDate()).slice(-2)}`; };

/** 复刻 CLI CloudService.getRequestSign 的 TC3-HMAC-SHA256 签名。 */
function signRequest({ action, payload, credential, region }) {
  const url = `https://${SERVICE}.tencentcloudapi.com`;
  const host = new URL(url).hostname;
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signedHeaders = "content-type;host";
  const canonicalHeaders = `content-type:application/json\nhost:${host}\n`;
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hash(body)}`;
  const date = utcDate(timestamp);
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${date}/${SERVICE}/tc3_request\n${hash(canonicalRequest)}`;
  const kSigning = sha256("tc3_request", sha256(SERVICE, sha256(date, `TC3${credential.tmpSecretKey}`)));
  const signature = sha256(stringToSign, kSigning, "hex");
  const headers = {
    Host: host, "Content-Type": "application/json", "X-TC-Action": action, "X-TC-Region": region,
    "X-TC-Timestamp": String(timestamp), "X-TC-Version": VERSION,
    Authorization: `TC3-HMAC-SHA256 Credential=${credential.tmpSecretId}/${date}/${SERVICE}/tc3_request, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (credential.tmpToken) headers["X-TC-Token"] = credential.tmpToken;
  return { url, body, headers };
}

async function callApi({ action, payload, credential, region }) {
  const { url, body, headers } = signRequest({ action, payload, credential, region });
  const response = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(60_000) });
  const json = await response.json().catch(() => null);
  return json?.Response ?? null;
}

async function loadCredential() {
  const file = path.join(homedir(), ".config", ".cloudbase", "auth.json");
  let parsed;
  try { parsed = JSON.parse(await readFile(file, "utf8")); } catch { throw new Error("NOT_LOGGED_IN"); }
  const credential = parsed?.credential ?? {};
  if (!credential.tmpSecretId || !credential.tmpSecretKey) throw new Error("NOT_LOGGED_IN");
  return credential;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--check", "--verify"].includes(arg))) { console.error(messages.INVALID_ARGS); process.exitCode = 1; return; }
  try {
    for (const file of [".env.local", ".env.tencent-owner.local"]) {
      try { process.loadEnvFile(path.join(project, file)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const variables = {};
    const missing = [];
    for (const key of RUNTIME_KEYS) {
      const value = String(process.env[key] ?? "").trim();
      if (value) variables[key] = value; else missing.push(key);
    }
    console.log("云托管运行变量（只显示名称与状态）：");
    for (const key of RUNTIME_KEYS) console.log(`  ${key}：${variables[key] ? "有值" : "未填写"}`);
    if (missing.length) { console.error(`\n${messages.INCOMPLETE}缺少：${missing.join("、")}`); process.exitCode = 1; return; }
    if (args.includes("--check")) { console.log("\n检查模式：未联网、未修改云端配置。"); return; }

    const envId = variables.CLOUDBASE_ENV_ID;
    const serviceName = DEFAULT_SERVICE_NAME;
    const region = variables.CLOUDBASE_REGION;
    const credential = await loadCredential();

    if (args.includes("--verify")) {
      const detail = await callApi({ action: "DescribeCloudRunServerDetail", payload: { EnvId: envId, ServerName: serviceName }, credential, region });
      const stored = detail?.ServerConfig?.EnvParams;
      if (!stored) { console.error("云端尚未保存环境变量。"); process.exitCode = 1; return; }
      const parsed = JSON.parse(stored);
      const same = RUNTIME_KEYS.every(key => parsed[key] === variables[key]);
      console.log("\n云端已保存的变量（只显示名称与是否一致）：");
      for (const key of RUNTIME_KEYS) console.log(`  ${key}：${parsed[key] ? "有值" : "未填写"}${parsed[key] === variables[key] ? "" : "（与本地不一致）"}`);
      console.log(same ? "\n云端与本机配置一致。" : "\n配置不完全一致，请重新提交。");
      if (!same) process.exitCode = 1;
      return;
    }

    console.log(`\n正在更新 ${serviceName} 的环境变量…`);
    const result = await callApi({
      action: "UpdateCloudRunServer", credential, region,
      payload: { EnvId: envId, ServerName: serviceName, DeployInfo: { DeployType: "package", ReleaseType: "FULL" }, Items: [{ Key: "EnvParam", Value: JSON.stringify(variables) }] },
    });
    const error = result?.Error;
    // "no server info has been modify" 表示 EnvParam 已是该值，同样算成功。
    if (error && !/no server info has been modify/i.test(error.Message ?? "")) {
      console.error(`接口返回错误码 ${error.Code}：${String(error.Message).slice(0,150)}`);
      throw new Error("REQUEST_FAILED");
    }
    console.log("环境变量已写入云端（只改这一项，其余服务配置未动）。");

    const detail = await callApi({ action: "DescribeCloudRunServerDetail", payload: { EnvId: envId, ServerName: serviceName }, credential, region });
    const parsed = JSON.parse(detail?.ServerConfig?.EnvParams ?? "{}");
    const written = RUNTIME_KEYS.filter(key => parsed[key]).length;
    console.log(`回读确认：${written}/${RUNTIME_KEYS.length} 个变量已在云端。`);
    if (written !== RUNTIME_KEYS.length) { console.error("回读数量不符，请重试。"); process.exitCode = 1; return; }
    console.log("注意：环境变量需要新的部署版本才生效；如页面仍显示未配置，请重新发布一次。");
  } catch (error) {
    console.error(messages[error.message] || "操作未完成。响应详情已隐藏以保护凭据。");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
