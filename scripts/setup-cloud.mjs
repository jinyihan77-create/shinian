import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try { process.loadEnvFile(path.join(project, ".env.local")); }
catch (error) { if (error.code !== "ENOENT") throw new Error("无法读取 .env.local，请检查文件格式。具体值不会输出。"); }

const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL", "OWNER_EMAIL", "OWNER_INITIAL_PASSWORD"];
const missing = required.filter(name => !process.env[name]?.trim());
if (missing.length) {
  console.error(`尚未提供：${missing.join("、")}。没有连接或修改远程服务。`);
  process.exitCode = 1;
} else if (!process.argv.includes("--apply")) {
  console.log("初始化所需变量名称均已配置；尚未验证凭据或连接远程服务。执行 npm run setup:cloud -- --apply 才会初始化数据库与私人账号。");
} else {
  const owner = process.env.OWNER_EMAIL.trim().toLowerCase();
  const password = process.env.OWNER_INITIAL_PASSWORD;
  let sql;
  try {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)) throw new Error("INVALID_EMAIL");
    if (password.length < 12) throw new Error("PASSWORD_TOO_SHORT");
    const endpoint = new URL(process.env.SUPABASE_URL);
    if (endpoint.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
    const connection = new URL(process.env.SUPABASE_DB_URL);
    if (!["postgres:", "postgresql:"].includes(connection.protocol)) throw new Error("INVALID_DB_URL");
    sql = postgres(process.env.SUPABASE_DB_URL, {
      ssl: { rejectUnauthorized: true }, max: 1, prepare: false, connect_timeout: 20, idle_timeout: 10,
      onnotice: () => {},
    });
    const migrationPath = path.join(project, "supabase", "migrations");
    const names = (await readdir(migrationPath)).filter(name => name.endsWith(".sql")).sort();
    await sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(195641801, 20260921)`;
      await tx`create table if not exists public.echo_schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())`;
      await tx`revoke all on public.echo_schema_migrations from public, anon, authenticated`;
      for (const name of names) {
        const source = await readFile(path.join(migrationPath, name), "utf8");
        const checksum = createHash("sha256").update(source).digest("hex");
        const previous = await tx`select checksum from public.echo_schema_migrations where name = ${name}`;
        if (previous.length) {
          if (previous[0].checksum !== checksum) throw new Error("MIGRATION_CHANGED");
          continue;
        }
        await tx.unsafe(source);
        await tx`insert into public.echo_schema_migrations(name, checksum) values(${name}, ${checksum})`;
      }
    });
    console.log("数据库结构已确认；正在配置私人账号权限。");
    const admin = createClient(endpoint.href, process.env.SUPABASE_SERVICE_ROLE_KEY.trim(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    let ownerUser;
    for (let page = 1; ; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error("AUTH_LIST_FAILED");
      ownerUser = data.users.find(user => user.email?.toLowerCase() === owner);
      if (ownerUser || data.users.length < 200) break;
    }
    let created = false;
    if (!ownerUser) {
      const { data, error } = await admin.auth.admin.createUser({ email: owner, password, email_confirm: true });
      if (error || !data.user) throw new Error("AUTH_CREATE_FAILED");
      ownerUser = data.user; created = true;
    }
    // An existing password is intentionally never reset by repeat deployments.
    await sql`insert into public.echo_private_members(user_id) values(${ownerUser.id}) on conflict(user_id) do nothing`;
    console.log(created ? "私人账号已创建并授权。" : "已有账号已授权，原密码保持不变。");
    console.log("云端初始化成功；仍需部署网站并实际验证登录、跨设备保存与真实 AI 调用，才能完成产品验收。");
  } catch (error) {
    const messages = {
      INVALID_EMAIL: "OWNER_EMAIL 格式不正确。",
      PASSWORD_TOO_SHORT: "OWNER_INITIAL_PASSWORD 至少需要 12 个字符。",
      HTTPS_REQUIRED: "SUPABASE_URL 必须使用 HTTPS。",
      INVALID_DB_URL: "SUPABASE_DB_URL 必须是 PostgreSQL 连接地址。",
      MIGRATION_CHANGED: "已应用的数据库迁移文件发生变化；请创建新迁移，不能覆盖历史。",
      AUTH_LIST_FAILED: "无法读取账号列表，请检查 Supabase 项目地址与 service role 密钥。",
      AUTH_CREATE_FAILED: "无法创建私人账号，请检查初始密码与 Supabase Auth 配置。",
    };
    console.error(messages[error.message] ?? "云端初始化未全部完成。请检查数据库连接、网络及配置；具体错误内容未输出，以保护连接凭据。重新运行可继续未完成的步骤。");
    process.exitCode = 1;
  } finally {
    if (sql) {
      try { await sql.end({ timeout: 5 }); }
      catch {
        console.error("数据库连接关闭时发生异常，具体连接信息未输出。请核对初始化状态后再继续部署。");
        process.exitCode = 1;
      }
    }
  }
}
