import { fileURLToPath } from "node:url";
import path from "node:path";

const groups = [
  { label: "腾讯云环境与 AI", names: ["CLOUD_PROVIDER", "CLOUDBASE_ENV_ID", "CLOUDBASE_REGION", "CLOUDBASE_AI_MODEL"] },
  { label: "私人账号与正式地址", names: ["OWNER_USERNAME", "OWNER_EMAIL", "APP_ORIGIN"] },
];

export function checkDeployment(env, log = console.log) {
  const value = name => typeof env[name] === "string" ? env[name].trim() : "";
  const missing = [], invalid = [];
  log("腾讯云配置检查：只检查字段和格式，不联网、不修改资源、不输出配置值。");
  for (const group of groups) {
    log("\n" + group.label);
    const absent = [];
    for (const name of group.names) {
      const present = Boolean(value(name));
      log(name + ": " + (present ? "已填写" : "未填写"));
      if (!present) absent.push(name);
    }
    if (absent.length) { missing.push(...absent); log("缺少：" + absent.join("、")); }
  }
  const validate = (name, check, requirement) => {
    if (!value(name)) return;
    let valid = false;
    try { valid = check(value(name)); } catch {}
    log(name + ": " + (valid ? "格式检查通过" : "格式不符合要求（" + requirement + "）"));
    if (!valid) invalid.push(name);
  };
  validate("CLOUD_PROVIDER", x => x === "cloudbase", "本次使用 cloudbase");
  validate("CLOUDBASE_ENV_ID", x => /^[a-z0-9][a-z0-9-]{2,62}$/.test(x), "应为真实环境 ID 格式");
  validate("CLOUDBASE_REGION", x => x === "ap-shanghai", "本次使用上海 ap-shanghai");
  validate("CLOUDBASE_AI_MODEL", x => x.length <= 200 && !/\s/.test(x), "应为实际开通的单个模型名称");
  validate("OWNER_USERNAME", x => /^[A-Za-z0-9][A-Za-z0-9._-]{1,47}$/.test(x), "应匹配初始化用户名");
  validate("OWNER_EMAIL", x => x.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x), "应为真实邮箱格式");
  validate("APP_ORIGIN", x => {
    const u = new URL(x), host = u.hostname.toLowerCase();
    return u.protocol === "https:" && Boolean(host) && !u.username && !u.password && u.pathname === "/" && !u.search && !u.hash
      && !["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(host) && !host.endsWith(".localhost");
  }, "应为正式 HTTPS 来源，不含路径、查询、账号信息或本机地址");
  log("\nCLI 授权、云托管身份、模型权限与额度需要真实验证；初始密码由初始化工具生成，不是运行变量。");
  const ok = !missing.length && !invalid.length;
  log(ok ? "字段与格式检查通过；真实登录、保存、同步、AI 和部署仍待验收。" : "配置检查尚未通过；部署执行者需补齐配置，未修改远程资源。");
  return { ok, missing, invalid };
}

async function main() {
  const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try { process.loadEnvFile(path.join(project, ".env.local")); }
  catch (e) {
    if (e.code !== "ENOENT") { console.error(".env.local 无法读取，未输出任何值或修改文件。"); process.exitCode = 1; return; }
  }
  if (!checkDeployment(process.env).ok) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
