import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkinSummarySchema, type CheckinSummary } from "../src/lib/checkin";
import { ApiError } from "../src/lib/server/http";
import { GET, PATCH, POST } from "../src/app/api/checkins/route";

const mocks = vi.hoisted(() => ({ requirePrivateUser: vi.fn(), rpc: vi.fn() }));
vi.mock("../src/lib/server/supabase", () => ({ requirePrivateUser: mocks.requirePrivateUser }));

describe("check-in HTTP contract", () => {
  const origin = "http://localhost:3000";
  const input = { expectedDay: "2026-09-21", mood: "平静", quote: "慢慢来也在前进。" };
  const saved: CheckinSummary = { today: input.expectedDay, totalDays: 1, currentStreak: 1,
    entry: { day: input.expectedDay, mood: input.mood, quote: input.quote, createdAt: "2026-09-21T01:00:00.000Z" } };
  const request = (body: unknown, requestOrigin = origin) => new Request(origin + "/api/checkins", {
    method: "POST", headers: { "content-type": "application/json", origin: requestOrigin, "x-echo-user-id": "owner" }, body: JSON.stringify(body),
  });
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("APP_ORIGIN", "");
    mocks.requirePrivateUser.mockResolvedValue({ client: { rpc: mocks.rpc }, user: { id: "owner" } });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("authenticates reads and blocks cross-origin writes before authentication", async () => {
    mocks.requirePrivateUser.mockRejectedValue(new ApiError(401, "AUTH_REQUIRED", "请先登录"));
    const response = await GET(new Request(origin + "/api/checkins"));
    expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toContain("no-store");
    mocks.requirePrivateUser.mockClear();
    expect((await POST(request(input, "https://evil.example"))).status).toBe(403);
    expect(mocks.requirePrivateUser).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("waits for database confirmation before returning saved counts", async () => {
    let acknowledge!: (value: unknown) => void;
    let started!: () => void;
    const running = new Promise<void>(resolve => { started = resolve; });
    mocks.rpc.mockImplementationOnce(() => { started(); return new Promise(resolve => { acknowledge = resolve; }); });
    let resolved = false;
    const pending = POST(request(input)).then(result => { resolved = true; return result; });
    await running; expect(resolved).toBe(false);
    acknowledge({ data: saved, error: null });
    const response = await pending;
    expect(response.status).toBe(200); expect(await response.json()).toEqual(saved);
    expect(mocks.rpc).toHaveBeenCalledWith("echo_create_checkin", {
      p_expected_day: input.expectedDay, p_mood: input.mood, p_quote: input.quote,
      p_star_variant: 0, p_theme_id: "climate-0", p_material_id: "frost",
      p_visual_seed: "0", p_experience_version: 2, p_source_note_ids: [],
    });
  });
  it("rejects long text, impossible dates and owner injection before storage", async () => {
    for (const value of [{ ...input, mood: "心".repeat(25) }, { ...input, quote: "句".repeat(101) },
      { ...input, expectedDay: "2026-02-31" }, { ...input, user_id: "someone-else" }]) {
      expect((await POST(request(value))).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reports missing configuration, unknown write results and midnight rollover as failures", async () => {
    mocks.requirePrivateUser.mockRejectedValueOnce(new ApiError(503, "CLOUD_NOT_CONFIGURED", "尚未配置"));
    expect((await POST(request(input))).status).toBe(503);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42P01", message: "secret-table-name" } });
    const missing = await POST(request(input));
    expect(missing.status).toBe(503); expect(await missing.json()).toMatchObject({ code: "CHECKIN_NOT_READY" });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "CHECKIN_DAY_CHANGED" } });
    const midnight = await POST(request(input));
    expect(midnight.status).toBe(409); expect(await midnight.json()).toMatchObject({ code: "DAY_CHANGED" });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "08006", message: "private connection secret" } });
    const failed = await POST(request(input));
    expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("private connection secret");
  });
  it("rejects malformed, absent and mismatched saved acknowledgments", async () => {
    for (const data of [{ ...saved, entry: null }, { ...saved, totalDays: 0 }, { ...saved, today: "2026-09-22" }]) {
      mocks.rpc.mockResolvedValueOnce({ data, error: null });
      expect((await POST(request(input))).status).toBe(502);
    }
    expect(checkinSummarySchema.safeParse({ ...saved, currentStreak: 20 }).success).toBe(false);
  });
  it("updates today's text with an expected revision without increasing the count", async () => {
    const updated: CheckinSummary = { ...saved, entry: { ...saved.entry!, mood: "明亮", quote: "新的回响", revision: 2, updatedAt: "2026-09-21T02:00:00.000Z" } };
    mocks.rpc.mockResolvedValueOnce({ data: updated, error: null });
    const response = await PATCH(request({ expectedDay: input.expectedDay, mood: "明亮", quote: "新的回响", expectedRevision: 1 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(updated);
    expect(mocks.rpc).toHaveBeenCalledWith("echo_update_checkin", {
      p_expected_day: input.expectedDay, p_mood: "明亮", p_quote: "新的回响", p_expected_revision: 1,
    });
  });
});
