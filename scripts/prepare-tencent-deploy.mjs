import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_FILES = Object.freeze([
  "Dockerfile", ".dockerignore", "package.json", "package-lock.json", "next.config.ts",
  "next-env.d.ts", "tsconfig.json", "postcss.config.mjs",
]);
const SOURCE_DIRS = ["src", "public"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".txt", ".webmanifest"]);
const FORBIDDEN = /^(?:\.env.*|\.git|\.next|\.cloudbase|\.config|\.ssh|\.aws|node_modules|private-data|backups?|tests?|test-results|coverage|credentials?(?:\..*)?|secrets?(?:\..*)?)$|(?:\.test|\.spec)\.[^.]+$|\.(?:pem|key|p12|pfx|log|sqlite|db)$|备份/i;
const RUNTIME_KEYS = ["CLOUD_PROVIDER", "CLOUDBASE_ENV_ID", "CLOUDBASE_REGION", "CLOUDBASE_AI_MODEL", "CLOUDBASE_APIKEY", "OWNER_USERNAME", "OWNER_EMAIL", "APP_ORIGIN"];
const hash = data => createHash("sha256").update(data).digest("hex");

function fail(code) { throw new Error(code); }
async function exists(file) { try { return await lstat(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
function within(root, file) {
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) fail("UNSAFE_PATH");
}
async function plainDirectory(file) {
  const stat = await lstat(file);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("UNSAFE_PATH");
  if (path.resolve(await realpath(file)).toLowerCase() !== path.resolve(file).toLowerCase()) fail("UNSAFE_PATH");
}

/**
 * No network access. Only names/status are suitable for logs or manifests.
 * @param {Record<string, string | undefined>} [env]
 */
export function runtimeConfigReport(env = process.env) {
  const values = Object.fromEntries(RUNTIME_KEYS.map(key => [key, String(env[key] ?? "").trim()]));
  values.CLOUDBASE_REGION ||= "ap-shanghai";
  const missing = RUNTIME_KEYS.filter(key => !values[key]);
  const invalid = [];
  if (values.CLOUD_PROVIDER && values.CLOUD_PROVIDER !== "cloudbase") invalid.push("CLOUD_PROVIDER");
  if (values.CLOUDBASE_ENV_ID && !/^[a-z0-9][a-z0-9-]{2,62}$/.test(values.CLOUDBASE_ENV_ID)) invalid.push("CLOUDBASE_ENV_ID");
  if (values.CLOUDBASE_REGION !== "ap-shanghai") invalid.push("CLOUDBASE_REGION");
  if (values.OWNER_USERNAME && !/^[A-Za-z0-9][A-Za-z0-9._-]{1,47}$/.test(values.OWNER_USERNAME)) invalid.push("OWNER_USERNAME");
  if (values.OWNER_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.OWNER_EMAIL)) invalid.push("OWNER_EMAIL");
  if (values.APP_ORIGIN) {
    try {
      const url = new URL(values.APP_ORIGIN);
      if (url.protocol !== "https:" || url.origin !== values.APP_ORIGIN || url.username || url.password) invalid.push("APP_ORIGIN");
    } catch { invalid.push("APP_ORIGIN"); }
  }
  return { ready: !missing.length && !invalid.length, missing, invalid, runtimeKeys: RUNTIME_KEYS.slice(),
    aiCredentialMode: "CloudBase Run injected temporary identity; actual AI access still requires a live check" };
}

/**
 * In-memory API body only. Never write this object into the upload directory.
 * @param {{env?: Record<string, string | undefined>, serviceName?: string, previousEnvParams?: string}} [options]
 */
export function runtimeUpdateBody({ env = process.env, serviceName = "inspiration-echo", previousEnvParams = "{}" } = {}) {
  if (!runtimeConfigReport(env).ready || !/^[a-z][a-z0-9-]{1,62}$/.test(serviceName)) fail("INVALID_RUNTIME_CONFIG");
  let previous;
  try { previous = JSON.parse(previousEnvParams || "{}"); } catch { fail("INVALID_PREVIOUS_RUNTIME"); }
  if (!previous || typeof previous !== "object" || Array.isArray(previous)
    || Object.values(previous).some(value => typeof value !== "string")) fail("INVALID_PREVIOUS_RUNTIME");
  const variables = { ...previous };
  for (const key of RUNTIME_KEYS) variables[key] = String(env[key] ?? "").trim();
  variables.CLOUDBASE_REGION ||= "ap-shanghai";
  // Do not copy process.env: it may contain owner passwords, local database
  // administration keys and CLI credentials unrelated to application runtime.
  return { EnvId: variables.CLOUDBASE_ENV_ID, ServerName: serviceName,
    Items: [{ Key: "EnvParam", Value: JSON.stringify(variables) }] };
}

/**
 * Copies only checked regular source files, without following links.
 * @param {string} [root]
 * @param {Record<string, string | undefined>} [env]
 */
export async function prepareTencentStaging(root = project, env = process.env) {
  root = path.resolve(root);
  await plainDirectory(root);
  const results = path.join(root, "test-results");
  if (!await exists(results)) await mkdir(results);
  await plainDirectory(results);
  const staging = path.join(results, "tencent-deploy-staging");
  const temporary = path.join(results, `tencent-deploy-staging-${randomBytes(6).toString("hex")}`);
  const retired = path.join(results, `tencent-deploy-old-${randomBytes(6).toString("hex")}`);
  const manifestPath = path.join(results, "tencent-deploy-staging.manifest.json");
  // Verify the final resolved paths before any recursive removal. All removal
  // targets are fixed descendants of this project's own test-results folder.
  for (const target of [staging, temporary, retired]) within(results, target);
  if (await exists(staging)) await plainDirectory(staging);
  const files = [];
  let totalBytes = 0;
  await mkdir(temporary);
  try {
    async function copy(relative, required = false) {
      const source = path.join(root, relative);
      within(root, source);
      const stat = await lstat(source);
      if (stat.isSymbolicLink()) fail("SYMLINK_SOURCE");
      if (stat.isDirectory()) {
        await plainDirectory(source);
        for (const name of (await readdir(source)).sort()) {
          if (!FORBIDDEN.test(name)) await copy(path.join(relative, name));
        }
        return;
      }
      if (!stat.isFile()) fail("UNSAFE_SOURCE");
      if (!required && !EXTENSIONS.has(path.extname(relative).toLowerCase())) return;
      const content = await readFile(source);
      totalBytes += content.length;
      if (totalBytes > 100 * 1024 * 1024) fail("SOURCE_TOO_LARGE");
      const target = path.join(temporary, relative);
      within(temporary, target);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, { flag: "wx" });
      files.push({ path: relative.split(path.sep).join("/"), bytes: content.length, sha256: hash(content) });
    }
    for (const relative of SOURCE_FILES) await copy(relative, true);
    for (const relative of SOURCE_DIRS) await copy(relative);
    if (!files.some(file => file.path.startsWith("src/")) || !files.some(file => file.path.startsWith("public/"))) fail("SOURCE_INCOMPLETE");
    files.sort((a, b) => a.path.localeCompare(b.path));
    // Removing a previous prepared snapshot also removes generated CLI metadata
    // and accidental files. The source project itself is never mutated.
    if (await exists(staging)) await rename(staging, retired);
    try { await rename(temporary, staging); }
    catch (error) { if (await exists(retired)) await rename(retired, staging); throw error; }
    if (await exists(retired)) await rm(retired, { recursive: true });
    const manifest = { schemaVersion: 1, purpose: "echo-tencent-source-snapshot", createdAt: new Date().toISOString(),
      staging: "test-results/tencent-deploy-staging", totalBytes, files, runtime: runtimeConfigReport(env),
      deployment: { port: 3000, minNum: 0, maxNum: 1, openAccessTypes: ["PUBLIC"],
        runtimeApi: { service: "tcbr", version: "2022-02-17", action: "UpdateCloudRunServer", field: "Items[Key=EnvParam].Value (JSON string)" } } };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    return { staging, manifestPath, manifest };
  } finally {
    if (await exists(temporary)) await rm(temporary, { recursive: true });
  }
}

/** Detect any later upload-directory modification, including extra secret files. */
export async function verifyTencentStaging(root = project) {
  root = path.resolve(root);
  await plainDirectory(root);
  const results = path.join(root, "test-results");
  await plainDirectory(results);
  const staging = path.join(results, "tencent-deploy-staging");
  await plainDirectory(staging);
  const manifest = JSON.parse(await readFile(path.join(results, "tencent-deploy-staging.manifest.json"), "utf8"));
  if (manifest.purpose !== "echo-tencent-source-snapshot" || !Array.isArray(manifest.files)) fail("INVALID_MANIFEST");
  const expected = new Map(manifest.files.map(file => [file.path, file]));
  let count = 0;
  async function check(relative = "") {
    for (const entry of await readdir(path.join(staging, relative), { withFileTypes: true })) {
      const nested = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) fail("STAGING_CHANGED");
      if (entry.isDirectory()) { await plainDirectory(path.join(staging, nested)); await check(nested); continue; }
      const record = expected.get(nested.split(path.sep).join("/"));
      if (!entry.isFile() || !record) fail("STAGING_CHANGED");
      const content = await readFile(path.join(staging, nested));
      if (record.bytes !== content.length || record.sha256 !== hash(content)) fail("STAGING_CHANGED");
      count++;
    }
  }
  await check();
  if (count !== expected.size) fail("STAGING_CHANGED");
  return { fileCount: count, totalBytes: manifest.totalBytes };
}

async function main() {
  try {
    if (process.argv.includes("--verify")) {
      const result = await verifyTencentStaging();
      console.log(`部署目录完整性验证通过：${result.fileCount} 个文件。未连接或修改远程服务。`);
      return;
    }
    try { process.loadEnvFile(path.join(project, ".env.local")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const { staging, manifest } = await prepareTencentStaging();
    console.log(`已生成干净部署目录：${staging}`);
    console.log(`包含 ${manifest.files.length} 个文件，共 ${manifest.totalBytes} 字节；未包含私人数据、dotenv、测试或 CLI 凭据。`);
    console.log("只完成本地准备，未上传、构建或部署。运行时配置须通过腾讯云服务配置接口设置，不得加入镜像。");
    if (manifest.runtime.missing.length) console.log("尚缺运行时配置名称：" + manifest.runtime.missing.join("、"));
    if (manifest.runtime.invalid.length) console.log("须修正配置名称：" + manifest.runtime.invalid.join("、"));
    if (manifest.runtime.ready) console.log("配置格式检查通过；远程账号、数据库、AI 和最终 HTTPS 地址仍需真实验收。");
  } catch (error) {
    const safe = ["UNSAFE_PATH", "SYMLINK_SOURCE", "UNSAFE_SOURCE", "SOURCE_TOO_LARGE", "SOURCE_INCOMPLETE", "INVALID_MANIFEST", "STAGING_CHANGED"].includes(error.message) ? error.message : "PREPARE_FAILED";
    console.error(`本地部署准备未完成（${safe}）。请检查构建源文件及目录，未执行远程部署。`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
