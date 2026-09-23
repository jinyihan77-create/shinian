import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { getCheckinDay, summarizeCheckinDays, type CheckinSummary } from "../src/lib/checkin";

describe("check-in calendar calculations", () => {
  it("uses Shanghai midnight regardless of the device timezone", () => {
    expect(getCheckinDay(new Date("2026-09-21T15:59:59.000Z"))).toBe("2026-09-21");
    expect(getCheckinDay(new Date("2026-09-21T16:00:00.000Z"))).toBe("2026-09-22");
  });
  it("deduplicates and ignores invalid/future days while stopping at gaps", () => {
    expect(summarizeCheckinDays(["2026-09-18", "2026-09-20", "2026-09-20", "2026-09-22", "2026-02-31"], "2026-09-20"))
      .toEqual({ totalDays: 2, currentStreak: 1 });
    expect(summarizeCheckinDays(["2026-09-18", "2026-09-19", "2026-09-20"], "2026-09-21"))
      .toEqual({ totalDays: 3, currentStreak: 3 });
    expect(summarizeCheckinDays(["2026-09-18", "2026-09-19"], "2026-09-21"))
      .toEqual({ totalDays: 2, currentStreak: 0 });
  });
  it("counts leap days and rejects impossible dates", () => {
    expect(summarizeCheckinDays(["2024-02-28", "2024-02-29", "2024-03-01"], "2024-03-01"))
      .toEqual({ totalDays: 3, currentStreak: 3 });
    expect(() => summarizeCheckinDays([], "2026-02-29")).toThrow("INVALID_CHECKIN_DAY");
  });
});

for (const provider of ["supabase", "cloudbase"] as const) {
  describe(`${provider} migration on local PostgreSQL`, () => {
    const db = new PGlite();
    const owner = provider === "supabase" ? "11111111-1111-4111-8111-111111111111" : "tencent-owner-not-a-uuid";
    const second = provider === "supabase" ? "22222222-2222-4222-8222-222222222222" : "tencent-second-owner";
    const stranger = provider === "supabase" ? "33333333-3333-4333-8333-333333333333" : "unapproved-user";
    const userType = provider === "supabase" ? "uuid" : "varchar(64)";
    const returnType = provider === "supabase" ? "uuid" : "text";
    async function user(id: string) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
      await db.exec("set role authenticated");
    }
    async function call(name: "echo_get_checkin" | "echo_create_checkin" | "echo_update_checkin" | "echo_checkin_summary", args: unknown[] = []): Promise<CheckinSummary> {
      const casts = { echo_get_checkin: [], echo_create_checkin: ["date", "text", "text", "integer", "text", "text", "text", "integer", "text[]"], echo_update_checkin: ["date", "text", "text", "integer"], echo_checkin_summary: ["date"] };
      const placeholders = args.map((_, i) => `$${i + 1}::${casts[name][i]}`).join(",");
      const result = await db.query<{ value: CheckinSummary }>(`select public.${name}(${placeholders}) as value`, args);
      return result.rows[0].value;
    }
    async function insertDays(days: string[]) {
      await db.exec("reset role");
      for (const day of days) await db.query("insert into public.echo_checkins(user_id,day) values($1,$2)", [owner, day]);
    }
    beforeAll(async () => {
      await db.exec(`create role anon; create role authenticated; create role service_role;
        create schema auth; create table auth.users(id ${userType} primary key);
        create function auth.uid() returns ${returnType} language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::${returnType} $$;
        grant usage on schema auth to anon, authenticated, service_role;
        grant usage on schema public to anon, authenticated, service_role;`);
      const first = provider === "supabase" ? "202609210001_private_library.sql" : "20260921000100_private_library.sql";
      const migration = provider === "supabase" ? "202609210002_daily_checkins.sql" : "20260921000200_daily_checkins.sql";
      const starMigration = provider === "supabase" ? "202609230001_seven_star_checkins.sql" : "20260923000100_seven_star_checkins.sql";
      await db.exec(await readFile(new URL(`../${provider}/migrations/${first}`, import.meta.url), "utf8"));
      await db.exec(await readFile(new URL(`../${provider}/migrations/${migration}`, import.meta.url), "utf8"));
      await db.exec(await readFile(new URL(`../${provider}/migrations/${starMigration}`, import.meta.url), "utf8"));
      await db.query("insert into auth.users(id) values($1),($2),($3)", [owner, second, stranger]);
      await db.query("insert into public.echo_private_members(user_id) values($1),($2)", [owner, second]);
    }, 30000);
    beforeEach(async () => { await db.exec("reset role; truncate public.echo_checkins"); await user(owner); });
    afterAll(async () => { await db.close(); });

    it("saves one immutable entry when retry promises are submitted together", async () => {
      const day = (await call("echo_get_checkin")).today;
      const pending = Array.from({ length: 8 }, (_, index) => call("echo_create_checkin", [day, `心情${index}`, `金句${index}`]));
      const saved = await Promise.all(pending);
      // PGlite serializes one connection; the primary key is the cross-connection safeguard.
      expect(saved.every(value => value.totalDays === 1 && value.currentStreak === 1)).toBe(true);
      expect(new Set(saved.map(value => JSON.stringify(value.entry))).size).toBe(1);
      expect((await call("echo_create_checkin", [day, "替换尝试", "不会覆盖"])).entry).toEqual(saved[0].entry);
      expect((await db.query("select * from public.echo_checkins")).rows).toHaveLength(1);
    });
    it("isolates accounts and rejects historical day injection and direct writes", async () => {
      const day = (await call("echo_get_checkin")).today;
      await call("echo_create_checkin", [day, "私人", "仅属于我"]);
      await user(second);
      expect(await call("echo_get_checkin")).toMatchObject({ totalDays: 0, entry: null });
      expect((await db.query("select * from public.echo_checkins")).rows).toHaveLength(0);
      await expect(call("echo_create_checkin", ["2000-01-01", "", ""])).rejects.toThrow("CHECKIN_DAY_CHANGED");
      await expect(db.query("insert into public.echo_checkins(user_id,day) values($1,$2)", [second, day])).rejects.toThrow("permission denied");
      await expect(call("echo_checkin_summary", [day])).rejects.toThrow("permission denied");
      await user(stranger);
      await expect(call("echo_get_checkin")).rejects.toThrow("PRIVATE_ACCOUNT_REQUIRED");
      await db.exec("reset role; set role anon");
      await expect(call("echo_get_checkin")).rejects.toThrow("permission denied");
    });
    it("uses Shanghai database time regardless of the SQL session timezone", async () => {
      await db.exec("set timezone='America/Los_Angeles'");
      const actual = await call("echo_get_checkin");
      const expected = await db.query<{ day: string }>("select to_char(clock_timestamp() at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as day");
      expect(actual.today).toBe(expected.rows[0].day);
      const boundary = await db.query("select to_char('2026-09-21 15:59:59+00'::timestamptz at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as before, to_char('2026-09-21 16:00:00+00'::timestamptz at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as after");
      expect(boundary.rows[0]).toEqual({ before: "2026-09-21", after: "2026-09-22" });
    });
    it("counts consecutive days across leap February and lets yesterday's streak survive today", async () => {
      await insertDays(["2024-02-26", "2024-02-28", "2024-02-29", "2024-03-01", "2024-03-05"]);
      expect(await call("echo_checkin_summary", ["2024-03-01"])).toMatchObject({ totalDays: 4, currentStreak: 3 });
      expect(await call("echo_checkin_summary", ["2024-03-02"])).toMatchObject({ totalDays: 4, currentStreak: 3, entry: null });
      expect(await call("echo_checkin_summary", ["2024-03-03"])).toMatchObject({ totalDays: 4, currentStreak: 0, entry: null });
    });
    it("enforces text limits and null restrictions directly in PostgreSQL", async () => {
      const day = (await call("echo_get_checkin")).today;
      await expect(call("echo_create_checkin", [day, "心".repeat(25), ""])).rejects.toThrow("INVALID_CHECKIN_INPUT");
      await expect(call("echo_create_checkin", [day, "", "句".repeat(101)])).rejects.toThrow("INVALID_CHECKIN_INPUT");
      await expect(call("echo_create_checkin", [day, null, ""])).rejects.toThrow("INVALID_CHECKIN_INPUT");
      expect(await call("echo_get_checkin")).toMatchObject({ totalDays: 0, entry: null });
    });
    it("persists the selected star and protects manual edits with revisions", async () => {
      const day = (await call("echo_get_checkin")).today;
      const created = await call("echo_create_checkin", [day, "明亮", "这一句来自今天", 2, "climate-4", "ice", "7788", 2, ["note-1"]]);
      expect(created.entry).toMatchObject({ starVariant: 2, themeId: "climate-4", materialId: "ice", visualSeed: "7788", sourceNoteIds: ["note-1"], revision: 1 });
      const updated = await call("echo_update_checkin", [day, "安静", "手动改过的文字", 1]);
      expect(updated).toMatchObject({ totalDays: 1, entry: { mood: "安静", quote: "手动改过的文字", revision: 2 } });
      await expect(call("echo_update_checkin", [day, "覆盖", "过期版本", 1])).rejects.toThrow("CHECKIN_EDIT_CONFLICT");
    });
  });
}
