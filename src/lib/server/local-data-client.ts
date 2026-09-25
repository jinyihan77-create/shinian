import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DataClient } from "./data-client";

export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_USER_EMAIL = "local@localhost";

type QueryState = {
  columns: string;
  filters: { column: string; operator: "eq" | "gt"; value: unknown }[];
  order?: { column: string; ascending: boolean };
  limit?: number;
  single?: boolean;
};

const RPCS: Record<string, { params: string[]; casts: string[] }> = {
  echo_create_note: { params: ["p_id", "p_note", "p_capture"], casts: ["uuid", "jsonb", "jsonb"] },
  echo_update_note: { params: ["p_id", "p_expected_version", "p_action", "p_patch"], casts: ["uuid", "bigint", "text", "jsonb"] },
  echo_delete_note: { params: ["p_id", "p_expected_version"], casts: ["uuid", "bigint"] },
  echo_import_notes: { params: ["p_notes"], casts: ["jsonb"] },
  echo_recover_ai: { params: [], casts: [] },
  echo_begin_ai: { params: ["p_id", "p_revision"], casts: ["uuid", "integer"] },
  echo_finish_ai: { params: ["p_id", "p_token", "p_revision", "p_result", "p_default_title"], casts: ["uuid", "uuid", "integer", "jsonb", "text"] },
  echo_fail_ai: { params: ["p_id", "p_token", "p_message"], casts: ["uuid", "uuid", "text"] },
  echo_get_checkin: { params: [], casts: [] },
  echo_create_checkin: { params: ["p_expected_day", "p_mood", "p_quote", "p_star_variant", "p_theme_id", "p_material_id", "p_visual_seed", "p_experience_version", "p_source_note_ids"], casts: ["date", "text", "text", "integer", "text", "text", "text", "integer", "text[]"] },
  echo_update_checkin: { params: ["p_expected_day", "p_mood", "p_quote", "p_expected_revision"], casts: ["date", "text", "text", "integer"] },
  echo_checkin_summary: { params: ["p_day"], casts: ["date"] },
};

const globalState = globalThis as typeof globalThis & { __shinianLocalDb?: Promise<PGlite> };

async function initialize(): Promise<PGlite> {
  const db = new PGlite(path.join(process.cwd(), "private-data", "pglite"));
  await db.exec(`
    do $$ begin create role anon; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role; exception when duplicate_object then null; end $$;
    create schema if not exists auth;
    create table if not exists auth.users(id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  const migrationPaths = [
    path.join(process.cwd(), "supabase/migrations/202609210001_private_library.sql"),
    path.join(process.cwd(), "supabase/migrations/202609210002_daily_checkins.sql"),
    path.join(process.cwd(), "supabase/migrations/202609230001_seven_star_checkins.sql"),
  ];
  for (const migrationPath of migrationPaths) {
    await db.exec(await readFile(/* turbopackIgnore: true */ migrationPath, "utf8"));
  }
  await db.query("insert into auth.users(id) values($1) on conflict (id) do nothing", [LOCAL_USER_ID]);
  await db.query("insert into public.echo_private_members(user_id) values($1) on conflict (user_id) do nothing", [LOCAL_USER_ID]);
  return db;
}

async function database(): Promise<PGlite> {
  globalState.__shinianLocalDb ??= initialize();
  return globalState.__shinianLocalDb;
}

async function asLocalUser(db: PGlite) {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false); set role authenticated;");
}

function postgresError(error: unknown) {
  const value = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  return { code: String(value.code ?? "LOCAL_DATABASE_ERROR"), message: String(value.message ?? "本地资料库操作失败") };
}

function safeIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*$/i.test(value)) throw new Error("本地查询字段无效");
  return value;
}

async function executeSelect(state: QueryState) {
  const db = await database();
  await asLocalUser(db);
  const params: unknown[] = [];
  const conditions = ["true"];
  for (const filter of state.filters) {
    params.push(filter.value);
    conditions.push(`${safeIdentifier(filter.column)} ${filter.operator === "eq" ? "=" : ">"} $${params.length}`);
  }
  const order = state.order ? ` order by ${safeIdentifier(state.order.column)} ${state.order.ascending ? "asc" : "desc"}` : "";
  const limit = state.limit ? ` limit ${Math.max(1, Math.min(501, Math.floor(state.limit)))}` : "";
  const result = await db.query<Record<string, unknown>>(`select ${safeIdentifier(state.columns)} from public.echo_notes where ${conditions.join(" and ")}${order}${limit}`, params);
  const rows = result.rows.map(row => ({ ...row, storage_version: Number(row.storage_version) }));
  return { data: state.single ? (rows[0] ?? null) : rows, error: null };
}

function queryBuilder() {
  const state: QueryState = { columns: "*", filters: [] };
  const query = {
    select(columns = "*") { state.columns = columns; return query; },
    order(column: string, options?: { ascending?: boolean }) { state.order = { column, ascending: options?.ascending !== false }; return query; },
    limit(value: number) { state.limit = value; return query; },
    eq(column: string, value: unknown) { state.filters.push({ column, operator: "eq", value }); return query; },
    gt(column: string, value: unknown) { state.filters.push({ column, operator: "gt", value }); return query; },
    maybeSingle() { state.single = true; return query; },
    then<TResult1 = { data: unknown; error: null }, TResult2 = never>(onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
      return executeSelect(state).then(onfulfilled, onrejected);
    },
  };
  return query;
}

async function callRpc(name: string, args: Record<string, unknown> = {}) {
  const definition = RPCS[name];
  if (!definition) return { data: null, error: { code: "42883", message: `未知本地 RPC：${name}` } };
  try {
    const db = await database();
    await asLocalUser(db);
    const values = definition.params.map(parameter => args[parameter]);
    const placeholders = definition.casts.map((cast, index) => `$${index + 1}::${cast}`).join(", ");
    const result = await db.query<{ value: unknown }>(`select public.${name}(${placeholders}) as value`, values);
    return { data: result.rows[0]?.value ?? null, error: null };
  } catch (error) {
    return { data: null, error: postgresError(error) };
  }
}

export async function createLocalDataClient(): Promise<DataClient> {
  await database();
  const client = { from: (_table: string) => queryBuilder(), rpc: callRpc };
  return client as unknown as DataClient;
}

export function asLocalSupabaseClient(client: DataClient): SupabaseClient {
  return client as unknown as SupabaseClient;
}
