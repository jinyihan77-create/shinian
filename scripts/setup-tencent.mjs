import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const credentialsPath = path.join(project, ".env.tencent-owner.local");
const safeMessages = {
  INVALID_CONFIG: "请先确定腾讯云环境 ID 和私人登录邮箱；用户名默认 echo-owner。未修改远程资源。",
  INVALID_PASSWORD: "初始密码须为 12～32 位，以字母或数字开头，并包含大小写字母、数字、特殊字符中的至少三类。",
  CLI_FAILED: "腾讯云命令未成功完成。请确认已通过 tcb login 本人授权、PG 环境已开通及当前账号拥有权限。响应详情已隐藏以保护凭据。",
  INVALID_RESULT: "腾讯云返回的结果无法确认成功，已停止后续操作。请检查初始化状态后重试。",
  MIGRATION_FAILED: "腾讯数据库迁移未确认完成，未继续开通私人资料库权限。请检查迁移任务后重试。",
  ACCOUNT_CONFLICT: "发现多个同名账号或已有账号状态异常，未重置任何密码。请先核对腾讯云用户管理。",
  LOGIN_FAILED: "私人账号已配置，但实际密码登录验证未通过。没有宣布初始化完成；已有账号密码不会被重置。",
  LOCAL_CONFIG_FAILED: "无法保存本机配置，已停止。请检查目录写入权限，勿删除尚未确认的初始密码文件。",
};

function fail(code) { throw new Error(code); }
const sqlLiteral = value => "'" + String(value).replaceAll("'", "''") + "'";

/** Passwords travel over stdin, never in command arguments or printed output. */
export function makeCliRunner(envId, region, configFile) {
  const cliEntry = path.join(path.dirname(require.resolve("@cloudbase/cli/package.json")), "bin", "tcb");
  const launcher = "let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const p=JSON.parse(input);process.argv=[process.execPath,p.entry,...p.args];require(p.entry)});";
  return async args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", launcher], { cwd: project, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0", TCB_SITE: "domestic" } });
    let stdout = ""; let bytes = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error("CLI_FAILED")); }, 11 * 60 * 1000);
    child.stdout.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) { child.kill(); return; }
      stdout += chunk;
    });
    // Always consume stderr; never echo provider responses, SQL or credentials.
    child.stderr.resume();
    child.once("error", () => { clearTimeout(timer); reject(new Error("CLI_FAILED")); });
    child.once("close", code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error("CLI_FAILED")); return; }
      try {
        const result = JSON.parse(stdout.trim());
        if (!result || result.error || !Object.prototype.hasOwnProperty.call(result, "data")) fail("INVALID_RESULT");
        resolve(result.data);
      } catch { reject(new Error("INVALID_RESULT")); }
    });
    child.stdin.end(JSON.stringify({ entry: cliEntry, args: [...args, "--env-id", envId, "--region", region, "--config-file", configFile, "--json"] }));
  });
}

function sqlRows(value) {
  if (!value || !Array.isArray(value.Columns) || !Array.isArray(value.Rows)) fail("INVALID_RESULT");
  return value.Rows.map(row => {
    const cells = typeof row === "string" ? JSON.parse(row) : row;
    if (!Array.isArray(cells)) fail("INVALID_RESULT");
    return Object.fromEntries(value.Columns.map((column, index) => [column, cells[index]]));
  });
}

/** Injection points permit failure/idempotency tests without contacting a cloud. */
export async function initializeTencent({ envId, email, username = "echo-owner", password, cli, saveCredentials, saveRuntime, verifyLogin, log = console.log }) {
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(envId ?? "") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? "")
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,47}$/.test(username)) fail("INVALID_CONFIG");
  const users = await cli(["user", "list", "--name", username, "--limit", "100"]);
  if (!Array.isArray(users)) fail("INVALID_RESULT");
  const exact = users.filter(user => user.Name === username);
  if (exact.length > 1 || (exact[0] && exact[0].UserStatus !== "ACTIVE")) fail("ACCOUNT_CONFLICT");
  let uid = exact[0]?.Uid;
  let created = false;
  if (!uid) {
    password ||= "E9!" + randomBytes(16).toString("base64url");
    const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[()!@#$%^&*|?><_-]/].filter(pattern => pattern.test(password)).length;
    if (password.length < 12 || password.length > 32 || !/^[A-Za-z0-9]/.test(password) || kinds < 3) fail("INVALID_PASSWORD");
    // Write first: if cloud creation commits but the response is lost, the only
    // copy of the generated password must survive the retry.
    await saveCredentials({ envId, email, username, password });
    const createdUser = await cli(["user", "create", username, "--type", "externalUser", "--status", "ACTIVE", "--password", password, "--email", email]);
    uid = createdUser?.Data?.Uid;
    if (!uid) fail("INVALID_RESULT");
    created = true;
  }
  if (typeof uid !== "string" || !uid.length || uid.length > 64) fail("INVALID_RESULT");
  log(created ? "腾讯私人账号已创建；初始密码保存在本机私人配置文件。" : "已找到腾讯私人账号，保留已有密码。");
  const migration = await cli(["db", "pg", "migration", "up"]);
  if (migration?.executable !== true || migration?.conflicts?.length
    || (migration?.taskId && migration?.task?.status?.toLowerCase() !== "succeed")) fail("MIGRATION_FAILED");
  log("腾讯 PostgreSQL 迁移已确认完成。");
  await cli(["db", "execute", "--sql", `insert into public.echo_private_members(user_id) values(${sqlLiteral(uid)}) on conflict(user_id) do nothing`]);
  const checked = sqlRows(await cli(["db", "execute", "--sql", `select user_id from public.echo_private_members where user_id=${sqlLiteral(uid)}`]));
  if (checked.length !== 1 || checked[0].user_id !== uid) fail("INVALID_RESULT");
  // Leave unrelated login strategies unchanged. Only enable the required one.
  await cli(["env", "login", "set", "--username-login", "true"]);
  if (password) {
    if (!await verifyLogin({ envId, username, password, uid })) fail("LOGIN_FAILED");
    log("私人账号密码已通过真实登录接口验证。");
  } else log("已有账号密码未提供，未验证实际登录。部署后仍需本人登录验收。");
  await saveRuntime({ CLOUD_PROVIDER: "cloudbase", CLOUDBASE_ENV_ID: envId, OWNER_USERNAME: username, OWNER_EMAIL: email });
  return { created, uid, loginVerified: Boolean(password) };
}

async function upsertEnv(file, values) {
  let source;
  try { source = await readFile(file, "utf8"); } catch (error) { if (error.code === "ENOENT") source = ""; else throw error; }
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    source = pattern.test(source) ? source.replace(pattern, () => line) : source.trimEnd() + "\n" + line + "\n";
  }
  await writeFile(file, source, { encoding: "utf8", mode: 0o600 });
}

async function main() {
  let configFile;
  try {
    for (const file of [".env.local", ".env.tencent-owner.local"]) {
      try { process.loadEnvFile(path.join(project, file)); } catch (error) { if (error.code !== "ENOENT") fail("LOCAL_CONFIG_FAILED"); }
    }
    const args = process.argv.slice(2);
    const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
    let projectConfig = {};
    try { projectConfig = JSON.parse(await readFile(path.join(project, "cloudbaserc.json"), "utf8")); } catch { /* Optional local configuration. */ }
    const envId = option("--env-id") || process.env.CLOUDBASE_ENV_ID || projectConfig.envId;
    const email = (option("--email") || process.env.OWNER_EMAIL || "").trim().toLowerCase();
    const username = option("--username") || process.env.OWNER_USERNAME || "echo-owner";
    const region = option("--region") || process.env.CLOUDBASE_REGION || "ap-shanghai";
    if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(envId ?? "") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,47}$/.test(username)) fail("INVALID_CONFIG");
    if (!args.includes("--apply")) {
      console.log("腾讯初始化配置名称已齐备，未连接或修改远程服务。本人完成 tcb login 后，加 --apply 初始化已有 PG 环境。");
      return;
    }
    configFile = path.join(tmpdir(), `echo-tencent-setup-${randomBytes(8).toString("hex")}.json`);
    await writeFile(configFile, JSON.stringify({ envId, region, database: { migrations: ["cloudbase/migrations"] } }), { flag: "wx", mode: 0o600 });
    const result = await initializeTencent({ envId, email, username, password: process.env.OWNER_INITIAL_PASSWORD,
      cli: makeCliRunner(envId, region, configFile),
      saveCredentials: async value => { try { await upsertEnv(credentialsPath, { CLOUDBASE_ENV_ID: value.envId, OWNER_USERNAME: value.username, OWNER_EMAIL: value.email, OWNER_INITIAL_PASSWORD: value.password }); } catch { fail("LOCAL_CONFIG_FAILED"); } },
      saveRuntime: async value => { try { await upsertEnv(path.join(project, ".env.local"), value); } catch { fail("LOCAL_CONFIG_FAILED"); } },
      verifyLogin: async value => {
        try {
          const response = await fetch(`https://${value.envId}.api.tcloudbasegateway.com/auth/v1/signin`, {
            method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
            body: JSON.stringify({ username: value.username, password: value.password }),
          });
          const body = await response.json();
          if (!response.ok || body.sub !== value.uid || body.token_type !== "Bearer" || typeof body.access_token !== "string" || !body.access_token) return false;
          const verified = await fetch(`https://${value.envId}.api.tcloudbasegateway.com/auth/v1/user/me`, {
            headers: { Authorization: `Bearer ${body.access_token}` }, signal: AbortSignal.timeout(20000), redirect: "error",
          });
          const profile = await verified.json();
          return verified.ok && profile.sub === value.uid && profile.username === value.username && (!profile.status || profile.status === "ACTIVE");
        } catch { return false; }
      },
    });
    console.log(result.loginVerified ? "腾讯数据库、账号权限及登录已初始化。仍需部署网站并验证跨设备同步和真实 AI，才算交付完成。" : "腾讯数据库与账号权限已初始化；实际登录、网站部署、同步及 AI 流程仍待验证。");
  } catch (error) {
    console.error(safeMessages[error.message] || "腾讯初始化未全部完成。响应内容已隐藏以保护凭据；可以核对状态后重试，不会重置已有账号密码。");
    process.exitCode = 1;
  } finally {
    if (configFile) { try { await unlink(configFile); } catch { /* Temporary config contains no secrets. */ } }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
