import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DEFAULT_QUESTION, emptyCapture } from "../src/lib/types";
import { GET as listRoute, POST as createRoute } from "../src/app/api/notes/route";
import { DELETE as deleteRoute, PATCH as patchRoute } from "../src/app/api/notes/[id]/route";
import { POST as importRoute } from "../src/app/api/notes/import/route";
import { ApiError } from "../src/lib/server/http";
import { cloudNotes } from "../src/lib/server/cloud-notes";
import type { SupabaseClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { initializeTencent } from "../scripts/setup-tencent.mjs";
import { taskStatus, taskTags } from "../src/lib/task-tickets";
import type { EchoNote } from "../src/lib/types";
import { captureContextTags } from "../src/lib/note-context";

const mocks = vi.hoisted(() => ({ requirePrivateUser: vi.fn(), rpc: vi.fn() }));
vi.mock("../src/lib/server/supabase", () => ({ requirePrivateUser: mocks.requirePrivateUser }));

// Real PostgreSQL-compatible local execution, not proof of a remote deployment.
const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const stranger = "33333333-3333-4333-8333-333333333333";
const capture = { ...emptyCapture(), userText: "把听到的好想法用自己的话解释" };
const note = { ...capture, title: capture.userText, tags: [], aiStatus: "not_started", aiResult: null,
  aiInputRevision: null, aiError: null, reflectionPrompt: DEFAULT_QUESTION, reflectionText: "", revision: 1, isExample: false };
const result = { title: "主动表达", thoughtSummary: "用输出帮助理解", sourceSummary: null,
  keyPoints: [{ text: "输出帮助理解", origin: "用户记录" }], tags: ["学习"], reflectionQuestions: ["你会怎样复述？"], possibleApplication: null };

async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec("set role authenticated");
}
async function call<T = Record<string, unknown>>(name: string, args: unknown[] = []): Promise<T> {
  const casts: Record<string, string[]> = {
    echo_create_note: ["uuid", "jsonb", "jsonb"], echo_update_note: ["uuid", "bigint", "text", "jsonb"],
    echo_delete_note: ["uuid", "bigint"], echo_import_notes: ["jsonb"], echo_begin_ai: ["uuid", "integer"],
    echo_finish_ai: ["uuid", "uuid", "integer", "jsonb", "text"], echo_fail_ai: ["uuid", "uuid", "text"],
  };
  const placeholders = args.map((_, index) => `$${index + 1}::${casts[name][index]}`).join(",");
  const params = args.map((arg, index) => casts[name][index] === "jsonb" ? JSON.stringify(arg) : arg);
  const data = await db.query<{ value: T }>(`select public.${name}(${placeholders}) as value`, params);
  return data.rows[0].value;
}
async function create(id = randomUUID()) { await call("echo_create_note", [id, note, capture]); return id; }

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;`);
  await db.exec(await readFile(new URL("../supabase/migrations/202609210001_private_library.sql", import.meta.url), "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3)", [owner, second, stranger]);
  await db.query("insert into public.echo_private_members(user_id) values($1),($2)", [owner, second]);
}, 30000);
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("APP_ORIGIN", "");
  mocks.requirePrivateUser.mockResolvedValue({ client: { rpc: mocks.rpc }, user: { id: owner, email: "private@example.com" } });
});
afterEach(async () => {
  await db.exec("reset role; truncate public.echo_notes, public.echo_ai_usage");
  vi.unstubAllEnvs();
});

describe("private notes HTTP contract (mocked Supabase boundary)", () => {
  const origin = "http://localhost:3000";
  const id = "44444444-4444-4444-8444-444444444444";
  const context = { params: Promise.resolve({ id }) };
  const persisted = { ...note, id, storageVersion: 1, createdAt: "2026-09-21T00:00:00.000Z", updatedAt: "2026-09-21T00:00:00.000Z" };
  function request(method: string, value: unknown, requestOrigin = origin) {
    return new Request(origin + "/api/notes", { method, headers: {
      "Content-Type": "application/json", Origin: requestOrigin, "x-echo-user-id": owner,
    }, body: JSON.stringify(value) });
  }

  it("requires login on reads and same origin before authenticating mutations", async () => {
    mocks.requirePrivateUser.mockRejectedValue(new ApiError(401, "AUTH_REQUIRED", "请先登录"));
    const response = await listRoute(new Request(origin + "/api/notes"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    mocks.requirePrivateUser.mockClear();
    expect((await createRoute(request("POST", { id, input: capture }, "https://evil.example"))).status).toBe(403);
    expect((await deleteRoute(new Request(origin, { method: "DELETE" }), context)).status).toBe(403);
    expect(mocks.requirePrivateUser).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not show success before the database has acknowledged a valid saved record", async () => {
    let write!: (value: unknown) => void;
    let started!: () => void;
    const pendingWrite = new Promise<void>(resolve => { started = resolve; });
    mocks.rpc.mockImplementationOnce(() => { started(); return new Promise(resolve => { write = resolve; }); });
    let resolved = false;
    const pending = createRoute(request("POST", { id, input: capture })).then(response => { resolved = true; return response; });
    await pendingWrite;
    expect(resolved).toBe(false);
    write({ data: persisted, error: null });
    const response = await pending;
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ note: persisted });
    expect(mocks.requirePrivateUser.mock.calls[0][0].headers.get("x-echo-user-id")).toBe(owner);
  });

  it("accepts only private capture context tags and includes them in the atomic create", async () => {
    const tags = captureContextTags("relationship");
    const tagged = { ...persisted, tags };
    mocks.rpc.mockResolvedValueOnce({ data: tagged, error: null });
    const response = await createRoute(request("POST", { id, input: capture, tags }));
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("echo_create_note", expect.objectContaining({ p_note: expect.objectContaining({ tags }) }));
    mocks.rpc.mockClear();
    expect((await createRoute(request("POST", { id, input: capture, tags: ["公开主题"] }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed and failed cloud acknowledgments without announcing successful saves", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "08006", message: "private connection secret" } })
      .mockResolvedValueOnce({ data: { id }, error: null });
    const failed = await createRoute(request("POST", { id, input: capture }));
    expect(failed.status).toBe(503);
    const error = await failed.text();
    expect(error).not.toContain("private connection secret"); expect(error).not.toContain("已经保存");
    expect((await createRoute(request("POST", { id, input: capture }))).status).toBe(502);
  });

  it("rejects invalid backups and missing write versions before touching cloud storage", async () => {
    expect((await createRoute(request("POST", { id, input: { ...capture, sourceUrl: "javascript:alert(1)" } }))).status).toBe(400);
    expect((await patchRoute(request("PATCH", { action: "reflection", input: { text: "理解" } }), context)).status).toBe(400);
    expect((await patchRoute(request("PATCH", { action: "meta", expectedVersion: 1, input: { title: "标题", tags: [] }, user_id: second }), context)).status).toBe(400);
    expect((await importRoute(request("POST", { notes: [persisted, { ...persisted, id: "broken" }] }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns actionable version conflicts and requires confirmed deletion", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "CONFLICT" } });
    const conflict = await patchRoute(request("PATCH", { action: "reflection", expectedVersion: 1, input: { text: "旧设备的理解" } }), context);
    expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: "CONFLICT", error: expect.stringContaining("输入仍在") });
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: true, error: null });
    expect((await deleteRoute(request("DELETE", { expectedVersion: 1 }), context)).status).toBe(502);
    const removed = await deleteRoute(request("DELETE", { expectedVersion: 1 }), context);
    expect(removed.status).toBe(200); expect(await removed.json()).toEqual({ success: true });
  });

  it("reads more than 1,000 records using stable cursors without truncating a backup", async () => {
    const records = Array.from({ length: 1001 }, (_, index) => ({
      id: `${(index + 1).toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      data: note, storage_version: 1, created_at: persisted.createdAt, updated_at: persisted.updatedAt,
    }));
    let page = 0;
    const cursors: string[] = [];
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
      from: vi.fn(() => ({ select: () => {
        const chain = {
          order: () => chain, limit: () => chain,
          gt: (_key: string, value: string) => { cursors.push(value); return chain; },
          then: (resolve: (value: unknown) => unknown) => resolve({ data: records.slice(page * 500, ++page * 500), error: null }),
        };
        return chain;
      } })),
    } as unknown as SupabaseClient;
    const saved = await cloudNotes.list(client);
    expect(saved).toHaveLength(1001);
    expect(new Set(saved.map(item => item.id)).size).toBe(1001);
    expect(cursors).toEqual([records[499].id, records[999].id]);
  });

  it("exposes bounded HTTP pages and continues at the last delivered record", async () => {
    const records = Array.from({ length: 13 }, (_, index) => ({
      id: `${(index + 1).toString(16).padStart(8, "0")}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
      data: note, storage_version: 1, created_at: persisted.createdAt, updated_at: persisted.updatedAt,
    }));
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
      from: () => ({ select: () => {
        let cursor = ""; let limit = 0;
        const chain = {
          order: () => chain, limit: (value: number) => { limit = value; return chain; },
          gt: (_key: string, value: string) => { cursor = value; return chain; },
          then: (resolve: (value: unknown) => unknown) => resolve({ data: records.filter(row => row.id > cursor).slice(0, limit), error: null }),
        };
        return chain;
      } }),
    } as unknown as SupabaseClient;
    mocks.requirePrivateUser.mockResolvedValue({ client, user: { id: owner, email: "private@example.com" } });
    const first = await listRoute(new Request(origin + "/api/notes"));
    expect(first.status).toBe(200);
    const firstPage = await first.json();
    expect(firstPage.notes).toHaveLength(10); expect(firstPage.nextCursor).toBe(records[9].id);
    const last = await listRoute(new Request(origin + "/api/notes?cursor=" + firstPage.nextCursor));
    const lastPage = await last.json();
    expect(lastPage.notes).toHaveLength(3); expect(lastPage.nextCursor).toBeNull();
    expect((await listRoute(new Request(origin + "/api/notes?cursor=invalid"))).status).toBe(400);
  });

  it("caps serialized UTF-8 response bytes even for heavily escaped note text", async () => {
    const records = Array.from({ length: 11 }, (_, index) => ({
      id: `${(index + 1).toString(16).padStart(8, "0")}-cccc-4ccc-8ccc-cccccccccccc`,
      data: { ...note, userText: "\u0001".repeat(20000), sourceExcerpt: "\u0001".repeat(40000), reflectionText: "\u0001".repeat(30000) },
      storage_version: 1, created_at: persisted.createdAt, updated_at: persisted.updatedAt,
    }));
    const chain = { order: () => chain, limit: () => Promise.resolve({ data: records, error: null }) };
    const client = { rpc: vi.fn().mockResolvedValue({ data: 0, error: null }), from: () => ({ select: () => chain }) } as unknown as SupabaseClient;
    const page = await cloudNotes.listPage(client);
    expect(page.notes.length).toBeGreaterThan(0); expect(page.notes.length).toBeLessThan(10);
    expect(page.nextCursor).toBe(records[page.notes.length - 1].id);
    expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThanOrEqual(3500 * 1024);
  });
});

describe("cloud setup preflight", () => {
  it("checks configured names without remote requests or exposing supplied values", async () => {
    const secret = "setup-test-secret-never-print";
    const output = await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../scripts/setup-cloud.mjs", import.meta.url)), "--check"], {
      env: { ...process.env, SUPABASE_URL: "https://does-not-exist.invalid", SUPABASE_ANON_KEY: secret,
        SUPABASE_SERVICE_ROLE_KEY: secret, SUPABASE_DB_URL: "postgresql://setup-test-secret-never-print@does-not-exist.invalid/db",
        OWNER_EMAIL: "private@example.invalid", OWNER_INITIAL_PASSWORD: secret },
      windowsHide: true,
    });
    expect(output.stdout).toContain("尚未验证凭据或连接远程服务");
    expect(output.stdout + output.stderr).not.toContain(secret);
    expect(output.stderr).toBe("");
  });
});
afterAll(async () => { await db.close(); });

describe("private cloud migration on local PostgreSQL engine", () => {
  it("denies anonymous execution and unapproved authenticated accounts", async () => {
    await db.exec("set role anon");
    await expect(call("echo_create_note", [randomUUID(), note, capture])).rejects.toThrow(/permission denied/);
    await user(stranger);
    await expect(call("echo_create_note", [randomUUID(), note, capture])).rejects.toThrow(/PRIVATE_ACCOUNT_REQUIRED/);
    await expect(db.query("insert into public.echo_private_members(user_id) values($1)", [stranger])).rejects.toThrow(/permission denied/);
  });

  it("isolates owner rows by RLS and rejects cross-owner RPC access", async () => {
    await user(owner); const id = await create();
    await user(second);
    expect((await db.query("select * from public.echo_notes")).rows).toHaveLength(0);
    await expect(call("echo_update_note", [id, 1, "meta", { title: "偷改", tags: [] }])).rejects.toThrow(/NOT_FOUND/);
    await expect(call("echo_delete_note", [id, 1])).rejects.toThrow(/NOT_FOUND/);
    await expect(db.query("update public.echo_notes set user_id = $1", [second])).rejects.toThrow(/permission denied/);
  });

  it("makes retry creation idempotent and rejects different content under the same id", async () => {
    await user(owner); const id = await create();
    const retry = await call("echo_create_note", [id, note, capture]);
    expect(retry.storageVersion).toBe(1);
    expect((await db.query("select * from public.echo_notes")).rows).toHaveLength(1);
    await expect(call("echo_create_note", [id, { ...note, userText: "不同" }, { ...capture, userText: "不同" }])).rejects.toThrow(/CONFLICT/);
  });

  it("uses database versions to reject stale device updates and deletes", async () => {
    await user(owner); const id = await create();
    const saved = await call("echo_update_note", [id, 1, "reflection", { text: "设备 A 的理解" }]);
    expect(saved.storageVersion).toBe(2);
    await expect(call("echo_update_note", [id, 1, "reflection", { text: "设备 B 的旧输入" }])).rejects.toThrow(/CONFLICT/);
    await expect(call("echo_delete_note", [id, 1])).rejects.toThrow(/CONFLICT/);
    const row = (await db.query<{ data: Record<string, unknown> }>("select data from public.echo_notes")).rows[0];
    expect(row.data.reflectionText).toBe("设备 A 的理解");
  });

  it("imports atomically, skips existing own ids and ignores backup lock versions", async () => {
    await user(owner);
    const first = { ...note, id: randomUUID(), createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-02T00:00:00.000Z", storageVersion: 987 };
    await expect(call("echo_import_notes", [[first, { ...first, id: "bad-id" }]])).rejects.toThrow();
    expect((await db.query("select * from public.echo_notes")).rows).toHaveLength(0);
    expect(await call("echo_import_notes", [[first, first]])).toBe(1);
    const row = (await db.query<{ storage_version: number; created_at: Date; data: object }>("select storage_version,created_at,data from public.echo_notes")).rows[0];
    expect(row.storage_version).toBe(1);
    expect(new Date(row.created_at).toISOString()).toBe(first.createdAt);
    expect(row.data).not.toHaveProperty("storageVersion");
  });

  it("preserves in-flight jobs across reads and keeps concurrent title and reflection edits on finish", async () => {
    await user(owner); const id = await create();
    const started = await call<{ note: { storageVersion: number }; token: string }>("echo_begin_ai", [id, 1]);
    expect(await call("echo_recover_ai")).toBe(0);
    await expect(call("echo_begin_ai", [id, 1])).rejects.toThrow(/ALREADY_PROCESSING/);
    const edited = await call("echo_update_note", [id, started.note.storageVersion, "meta", { title: "我的新标题", tags: ["自定"] }]);
    await call("echo_update_note", [id, edited.storageVersion, "reflection", { text: "整理过程中写下的理解" }]);
    expect(await call("echo_finish_ai", [id, started.token, 1, result, capture.userText])).toBe(true);
    const row = (await db.query<{ data: Record<string, unknown> }>("select data from public.echo_notes")).rows[0];
    expect(row.data).toMatchObject({ title: "我的新标题", tags: ["自定"], reflectionText: "整理过程中写下的理解", aiStatus: "done", aiResult: result });
  });

  it("rejects obsolete AI results after content edits and ignores old failure callbacks", async () => {
    await user(owner); const id = await create();
    const started = await call<{ note: { storageVersion: number }; token: string }>("echo_begin_ai", [id, 1]);
    await call("echo_update_note", [id, started.note.storageVersion, "content", { ...capture, userText: "新内容" }]);
    expect(await call("echo_finish_ai", [id, started.token, 1, result, capture.userText])).toBe(false);
    await call("echo_fail_ai", [id, started.token, "旧请求失败"]);
    const row = (await db.query<{ data: Record<string, unknown> }>("select data from public.echo_notes")).rows[0];
    expect(row.data).toMatchObject({ userText: "新内容", revision: 2, aiStatus: "not_started", aiError: null });
  });

  it("recovers only expired AI leases and enforces durable rate limits", async () => {
    await user(owner); const id = await create();
    await call("echo_begin_ai", [id, 1]);
    await db.exec("reset role");
    await db.query("update public.echo_notes set ai_lease_until = now() - interval '1 second' where id=$1", [id]);
    await user(owner);
    expect(await call("echo_recover_ai")).toBe(1);
    for (let index = 1; index < 8; index++) {
      const started = await call<{ token: string }>("echo_begin_ai", [id, 1]);
      await call("echo_fail_ai", [id, started.token, "上游故障"]);
    }
    await expect(call("echo_begin_ai", [id, 1])).rejects.toThrow(/RATE_LIMITED/);
  });
});

describe("Tencent CloudBase PostgreSQL migration with text account IDs", () => {
  const tencent = new PGlite();
  const uid = "cloudbase-private-owner-not-a-uuid";
  const otherUid = "cloudbase-other-owner";
  const unapproved = "cloudbase-unapproved-user";
  const id = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  async function asUser(value: string) {
    await tencent.exec("reset role");
    await tencent.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: value, role: "authenticated" })]);
    await tencent.exec("set role authenticated");
  }
  beforeAll(async () => {
    await tencent.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id varchar(64) primary key);
      create function auth.uid() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub' $$;
      grant usage on schema auth, public to anon, authenticated, service_role;`);
    await tencent.exec(await readFile(new URL("../cloudbase/migrations/20260921000100_private_library.sql", import.meta.url), "utf8"));
    await tencent.query("insert into auth.users values($1),($2),($3)", [uid, otherUid, unapproved]);
    await tencent.query("insert into public.echo_private_members(user_id) values($1),($2)", [uid, otherUid]);
  }, 30000);
  afterEach(async () => { await tencent.exec("reset role; truncate public.echo_notes, public.echo_ai_usage"); });
  afterAll(async () => { await tencent.close(); });

  it("uses the real CloudBase text sub claim, preserves owner isolation, and prevents self-authorization", async () => {
    await asUser(uid);
    await tencent.query("select public.echo_create_note($1::uuid,$2::jsonb,$3::jsonb)", [id, JSON.stringify(note), JSON.stringify(capture)]);
    const own = await tencent.query<{ user_id: string }>("select user_id from public.echo_notes");
    expect(own.rows).toEqual([{ user_id: uid }]);
    await asUser(otherUid);
    expect((await tencent.query("select * from public.echo_notes")).rows).toHaveLength(0);
    await expect(tencent.query("select public.echo_delete_note($1::uuid,1)", [id])).rejects.toThrow("NOT_FOUND");
    await asUser(unapproved);
    await expect(tencent.query("select public.echo_create_note($1::uuid,$2::jsonb,$3::jsonb)", [id, JSON.stringify(note), JSON.stringify(capture)])).rejects.toThrow("PRIVATE_ACCOUNT_REQUIRED");
    await expect(tencent.query("insert into public.echo_private_members(user_id) values($1)", [unapproved])).rejects.toThrow("permission denied");
    await tencent.exec("reset role; set role anon");
    await expect(tencent.query("select public.echo_recover_ai() ")).rejects.toThrow("permission denied");
  });

  it("preserves PostgreSQL CAS, atomic import rollback and durable AI locks with Tencent identity", async () => {
    await asUser(uid);
    await tencent.query("select public.echo_create_note($1::uuid,$2::jsonb,$3::jsonb)", [id, JSON.stringify(note), JSON.stringify(capture)]);
    await tencent.query("select public.echo_update_note($1::uuid,1,'reflection',$2::jsonb)", [id, JSON.stringify({ text: "来自设备 A" })]);
    await expect(tencent.query("select public.echo_update_note($1::uuid,1,'reflection',$2::jsonb)", [id, JSON.stringify({ text: "设备 B 旧版本" })])).rejects.toThrow("CONFLICT");
    const started = await tencent.query<{ value: { token: string; note: { storageVersion: number } } }>("select public.echo_begin_ai($1::uuid,1) as value", [id]);
    await expect(tencent.query("select public.echo_begin_ai($1::uuid,1)", [id])).rejects.toThrow("ALREADY_PROCESSING");
    const lease = started.rows[0].value;
    await tencent.query("select public.echo_update_note($1::uuid,$2,'meta',$3::jsonb)", [id, lease.note.storageVersion, JSON.stringify({ title: "我的腾讯云标题", tags: [] })]);
    await tencent.query("select public.echo_finish_ai($1::uuid,$2::uuid,1,$3::jsonb,$4)", [id, lease.token, JSON.stringify(result), capture.userText]);
    const current = await tencent.query<{ data: Record<string, unknown> }>("select data from public.echo_notes");
    expect(current.rows[0].data).toMatchObject({ title: "我的腾讯云标题", reflectionText: "来自设备 A", aiStatus: "done" });
    const imported = { ...note, id: randomUUID(), createdAt: "2026-01-01T00:00:00.000Z" };
    await expect(tencent.query("select public.echo_import_notes($1::jsonb)", [JSON.stringify([imported, { ...imported, id: "bad-id" }])])).rejects.toThrow();
    expect((await tencent.query("select * from public.echo_notes")).rows).toHaveLength(1);
  });

  it("persists the ticket journey through Tencent metadata writes and AI completion without losing progress", async () => {
    await asUser(uid);
    await tencent.query("select public.echo_create_note($1::uuid,$2::jsonb,$3::jsonb)", [id, JSON.stringify(note), JSON.stringify(capture)]);
    async function transition(current: Pick<EchoNote, "tags" | "title">, version: number, action: "queue" | "start" | "complete" | "reopen") {
      const saved = await tencent.query<{ value: EchoNote }>("select public.echo_update_note($1::uuid,$2,'meta',$3::jsonb) as value", [id, version, JSON.stringify({ title: current.title, tags: taskTags(current, action) })]);
      return saved.rows[0].value;
    }
    const pending = await transition(note, 1, "queue");
    const active = await transition(pending, pending.storageVersion!, "start");
    expect(taskStatus(active)).toBe("active");
    const started = await tencent.query<{ value: { token: string } }>("select public.echo_begin_ai($1::uuid,1) as value", [id]);
    await tencent.query("select public.echo_finish_ai($1::uuid,$2::uuid,1,$3::jsonb,$4)", [id, started.rows[0].value.token, JSON.stringify(result), capture.userText]);
    const row = (await tencent.query<{ data: EchoNote; storage_version: number }>("select data,storage_version from public.echo_notes")).rows[0];
    expect(row.data.aiStatus).toBe("done");
    expect(taskStatus(row.data)).toBe("active");
    await expect(transition(active, 1, "complete")).rejects.toThrow("CONFLICT");
    const completed = await transition(row.data, row.storage_version, "complete");
    await asUser(otherUid);
    expect((await tencent.query("select * from public.echo_notes")).rows).toHaveLength(0);
    await asUser(uid);
    const reread = (await tencent.query<{ data: EchoNote }>("select data from public.echo_notes")).rows[0].data;
    expect(taskStatus(reread)).toBe("completed");
    expect(reread.userText).toBe(capture.userText);
    const reopened = await transition(completed, completed.storageVersion!, "reopen");
    expect(taskStatus(reopened)).toBe("active");
    expect(reopened.id).toBe(id);
  });
});

describe("Tencent initialization orchestration without live cloud calls", () => {
  const envId = "echo-test-environment";
  const email = "owner@example.invalid";
  const username = "echo-owner";
  const uid = "tencent-owner-text-id";
  function dependencies(existing = false) {
    const calls: string[][] = [];
    const cli = vi.fn(async (args: string[]): Promise<unknown> => {
      calls.push(args);
      if (args[0] === "user" && args[1] === "list") return existing ? [{ Name: username, Uid: uid, UserStatus: "ACTIVE" }] : [];
      if (args[0] === "user" && args[1] === "create") return { Data: { Uid: uid } };
      if (args[0] === "db" && args[1] === "pg") return { executable: true, conflicts: [], taskId: "task", task: { status: "succeed" } };
      if (args[0] === "db" && args[1] === "execute" && args[3].startsWith("select")) return { Columns: ["user_id"], Rows: [JSON.stringify([uid])] };
      return {};
    });
    return { calls, cli, saveCredentials: vi.fn(async () => {}), saveRuntime: vi.fn(async () => {}), verifyLogin: vi.fn(async () => true), log: vi.fn() };
  }
  it("keeps the generated password before creation, verifies committed state, and never logs secrets", async () => {
    const deps = dependencies();
    const outcome = await initializeTencent({ envId, email, username, password: undefined, ...deps });
    expect(outcome).toEqual({ created: true, uid, loginVerified: true });
    expect(deps.saveCredentials.mock.invocationCallOrder[0]).toBeLessThan(deps.cli.mock.invocationCallOrder[1]);
    const create = deps.calls.find(args => args[1] === "create")!;
    const password = create[create.indexOf("--password") + 1];
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect(deps.saveCredentials).toHaveBeenCalledWith(expect.objectContaining({ password }));
    expect(JSON.stringify(deps.log.mock.calls)).not.toContain(password);
    expect(deps.saveRuntime).toHaveBeenCalledWith({ CLOUD_PROVIDER: "cloudbase", CLOUDBASE_ENV_ID: envId, OWNER_USERNAME: username, OWNER_EMAIL: email });
  });
  it("never resets an existing account and distinguishes unverified login from completion", async () => {
    const deps = dependencies(true);
    const outcome = await initializeTencent({ envId, email, username, password: undefined, ...deps });
    expect(outcome.loginVerified).toBe(false); expect(deps.saveCredentials).not.toHaveBeenCalled(); expect(deps.verifyLogin).not.toHaveBeenCalled();
    expect(deps.calls.some(args => args[1] === "create" || args[1] === "modify")).toBe(false);
  });
  it("stops after failed migrations and does not claim success when real login is rejected", async () => {
    const broken = dependencies(true);
    broken.cli.mockImplementationOnce(async () => [{ Name: username, Uid: uid, UserStatus: "ACTIVE" }]).mockImplementationOnce(async () => ({ executable: true, conflicts: [], taskId: "task", task: { status: "failed" } }));
    await expect(initializeTencent({ envId, email, username, password: undefined, ...broken })).rejects.toThrow("MIGRATION_FAILED");
    expect(broken.saveRuntime).not.toHaveBeenCalled();
    const denied = dependencies(); denied.verifyLogin.mockResolvedValue(false);
    await expect(initializeTencent({ envId, email, username, password: undefined, ...denied })).rejects.toThrow("LOGIN_FAILED");
    expect(denied.saveRuntime).not.toHaveBeenCalled();
  });
});
