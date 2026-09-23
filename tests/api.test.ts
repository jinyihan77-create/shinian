import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as status } from "../src/app/api/status/route";
import { POST as organize } from "../src/app/api/organize/route";
import { POST as sourceIntake } from "../src/app/api/source-intake/route";
import { POST as unlock } from "../src/app/api/unlock/route";
import { validateAiResult } from "../src/lib/server/organize";
import { ApiError } from "../src/lib/server/http";
import type { EchoNote, AiResult } from "../src/lib/types";

const mocks = vi.hoisted(() => ({
  requirePrivateUser: vi.fn(),
  beginAi: vi.fn(), finishAi: vi.fn(), failAi: vi.fn(), get: vi.fn(),
}));
vi.mock("../src/lib/server/supabase", () => ({ requirePrivateUser: mocks.requirePrivateUser }));
vi.mock("../src/lib/server/cloud-notes", () => ({ cloudNotes: {
  beginAi: mocks.beginAi, finishAi: mocks.finishAi, failAi: mocks.failAi, get: mocks.get,
} }));

const origin = "http://localhost:3000";
const note: EchoNote = {
  id: "7a64ae59-ccef-4594-9808-1a683e203532", revision: 3, title: "原始想法", tags: [],
  userText: "听完后自己说一遍，可能比收藏更容易记住。", sourceType: "播客", sourceName: "测试来源",
  sourceUrl: "https://example.com/podcast", sourceTimestamp: "", sourceExcerpt: "",
  aiStatus: "processing", aiResult: null, aiInputRevision: null, aiError: null,
  reflectionPrompt: "", reflectionText: "", createdAt: "2026-09-21T00:00:00.000Z",
  updatedAt: "2026-09-21T00:00:00.000Z", isExample: false, storageVersion: 2,
};
const payload = { id: note.id, revision: note.revision };
const result: AiResult = {
  title: "用输出加深理解", thoughtSummary: "自己复述一次，有助于留下听过的想法。", sourceSummary: null,
  keyPoints: [{ text: "听完后试着自己复述。", origin: "用户记录" }],
  tags: ["复述", "理解"], reflectionQuestions: ["最近有什么想法，你能用三句话讲给朋友听？"], possibleApplication: null,
};
const saved = { ...note, aiStatus: "done", aiResult: result, aiInputRevision: 3, storageVersion: 3 };

function post(data: unknown = payload, requestOrigin = origin) {
  return new Request(origin + "/api/organize", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: requestOrigin }, body: JSON.stringify(data),
  });
}
function sourcePost(data: unknown = { transcript: "这是播客得意忘形，十八分二十秒，原话是不要急着给答案。", currentSourceType: "播客" }, requestOrigin = origin) {
  return new Request(origin + "/api/source-intake", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: requestOrigin, "x-echo-user-id": "owner" }, body: JSON.stringify(data),
  });
}
function providerResponse(output: unknown = result) {
  return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [
    { type: "output_text", text: JSON.stringify(output) },
  ] }] }), { status: 200 });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CLOUD_PROVIDER", "supabase");
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("OPENAI_API_KEY", "unit-test-not-a-real-key");
  vi.stubEnv("AI_MODEL", "unit-test-model"); vi.stubEnv("APP_ORIGIN", "");
  delete (globalThis as { __echoRateLimits?: unknown }).__echoRateLimits;
  vi.stubGlobal("fetch", vi.fn());
  mocks.requirePrivateUser.mockResolvedValue({ client: {}, user: { id: "owner", email: "owner@example.com" } });
  mocks.beginAi.mockResolvedValue({ note, token: "test-lease" });
  mocks.finishAi.mockResolvedValue(true); mocks.failAi.mockResolvedValue(undefined); mocks.get.mockResolvedValue(saved);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("private AI routes (mocked boundaries, not a live provider test)", () => {
  it("只在私人账号内把口述发送给AI，并返回经过校验的来源字段", async () => {
    const source = { sourceType: "播客", sourceName: "得意忘形", sourceTimestamp: "18:20", sourceExcerpt: "不要急着给答案。" };
    vi.mocked(fetch).mockResolvedValueOnce(providerResponse(source));
    const response = await sourceIntake(sourcePost());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ source });
    expect(mocks.requirePrivateUser).toHaveBeenCalledOnce();
    const providerRequest = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string) as { input: { content: { text: string }[] }[] };
    expect(JSON.parse(providerRequest.input[0].content[0].text)).toEqual({ transcript: "这是播客得意忘形，十八分二十秒，原话是不要急着给答案。", currentSourceType: "播客" });
  });

  it("拒绝跨站、未登录和空口述，且不把失败显示成整理成功", async () => {
    expect((await sourceIntake(sourcePost(undefined, "https://elsewhere.example"))).status).toBe(403);
    expect((await sourceIntake(sourcePost({ transcript: "", currentSourceType: "播客" }))).status).toBe(400);
    mocks.requirePrivateUser.mockRejectedValueOnce(new ApiError(401, "AUTH_REQUIRED", "请登录"));
    expect((await sourceIntake(sourcePost())).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports configuration truthfully only after authentication", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await status();
    expect(await response.json()).toMatchObject({ configured: false, available: false, requiresUnlock: false });
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await organize(post())).status).toBe(503);
    expect(mocks.beginAi).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    mocks.requirePrivateUser.mockRejectedValue(new ApiError(401, "AUTH_REQUIRED", "请登录"));
    expect((await status()).status).toBe(401); expect((await organize(post())).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("permanently retires shared-password access", async () => {
    const response = await unlock();
    expect(response.status).toBe(410); expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("rejects cross-site, absent-origin and unconfigured production writes before access", async () => {
    expect((await organize(post(payload, "https://elsewhere.example"))).status).toBe(403);
    expect((await organize(new Request(origin + "/api/organize", { method: "POST" }))).status).toBe(403);
    vi.stubEnv("NODE_ENV", "production");
    expect((await organize(post())).status).toBe(503);
    expect(mocks.requirePrivateUser).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts explicitly configured public origin behind a proxy", async () => {
    vi.stubEnv("APP_ORIGIN", "https://notes.example.com"); vi.stubEnv("NODE_ENV", "production");
    vi.mocked(fetch).mockResolvedValue(providerResponse());
    expect((await organize(post(payload, "https://notes.example.com"))).status).toBe(200);
  });
  it("rejects client-supplied note text, malformed IDs and oversized bodies", async () => {
    expect((await organize(post({ ...payload, userText: "override saved text" }))).status).toBe(400);
    expect((await organize(post({ ...payload, id: "bad-id" }))).status).toBe(400);
    expect((await organize(post({ id: "x".repeat(5000), revision: 1 }))).status).toBe(413);
    expect(mocks.beginAi).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not call the model for a saved link-only record", async () => {
    mocks.beginAi.mockResolvedValue({ note: { ...note, userText: " " }, token: "test-lease" });
    const response = await organize(post());
    expect(response.status).toBe(400); expect((await response.json()).code).toBe("CONTENT_REQUIRED");
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.failAi).toHaveBeenCalled();
  });
  it("uses only the owned cloud row and reports success only after committing the result", async () => {
    vi.mocked(fetch).mockResolvedValue(providerResponse());
    let completeWrite!: (applied: boolean) => void;
    let writeStarted!: () => void;
    const started = new Promise<void>(resolve => { writeStarted = resolve; });
    mocks.finishAi.mockImplementationOnce(() => { writeStarted(); return new Promise<boolean>(resolve => { completeWrite = resolve; }); });
    let resolved = false;
    const pending = organize(post()).then(value => { resolved = true; return value; });
    await started;
    expect(resolved).toBe(false); expect(mocks.get).not.toHaveBeenCalled();
    completeWrite(true);
    const response = await pending;
    expect(await response.json()).toEqual({ applied: true, note: saved });
    expect(mocks.beginAi).toHaveBeenCalledWith({}, note.id, note.revision);
    expect(mocks.finishAi).toHaveBeenCalledWith({}, note.id, "test-lease", 3, result);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(options!.body as string);
    expect(body).toMatchObject({ store: false, model: "unit-test-model", text: { format: { type: "json_schema", strict: true } } });
    expect(JSON.parse(body.input[0].content[0].text)).toEqual({
      userText: note.userText, sourceType: note.sourceType, sourceName: note.sourceName,
      sourceUrl: note.sourceUrl, sourceTimestamp: note.sourceTimestamp, sourceExcerpt: note.sourceExcerpt,
    });
  });
  it("never claims success for a stale revision, missing row, lease conflict or failed cloud write", async () => {
    mocks.beginAi.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "不存在"));
    expect((await organize(post())).status).toBe(404);
    mocks.beginAi.mockRejectedValueOnce(new ApiError(409, "ALREADY_PROCESSING", "正在整理"));
    expect((await organize(post())).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockImplementation(async () => providerResponse());
    mocks.finishAi.mockResolvedValueOnce(false);
    expect((await organize(post())).status).toBe(409);
    mocks.finishAi.mockRejectedValueOnce(new Error("private DB error details"));
    const response = await organize(post());
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("已经保存"); expect(text).not.toContain("private DB");
    expect(mocks.failAi).toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it("rejects invented attribution and absent thoughts", () => {
    expect(() => validateAiResult({ ...result, sourceSummary: "这期节目说了……" }, note)).toThrow("混淆");
    expect(() => validateAiResult({ ...result, keyPoints: [{ text: "不存在的来源", origin: "来源片段" }] }, note)).toThrow("混淆");
    expect(() => validateAiResult(result, { ...note, userText: "", sourceExcerpt: "真实提供的片段" })).toThrow("混淆");
    expect(() => validateAiResult({ ...result, reflectionQuestions: [] }, note)).toThrow("格式");
  });
  it("distinguishes a committed result whose refresh failed and rejects changes after commit", async () => {
    vi.mocked(fetch).mockImplementation(async () => providerResponse());
    mocks.get.mockRejectedValueOnce(new Error("database read outage"));
    const unavailable = await organize(post());
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).code).toBe("AI_SAVED_REFRESH_FAILED");
    expect(mocks.failAi).not.toHaveBeenCalled();
    mocks.get.mockResolvedValueOnce({ ...saved, revision: 4, aiStatus: "outdated" });
    const conflict = await organize(post());
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe("CONTENT_CHANGED");
  });
  it("rejects malformed output/refusal/rate limits without committing or leaking provider details", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(providerResponse({ ...result, tags: "not-an-array" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] })))
      .mockResolvedValueOnce(new Response("private provider error", { status: 429 }));
    expect((await organize(post())).status).toBe(502);
    expect((await organize(post())).status).toBe(422);
    const response = await organize(post());
    expect(response.status).toBe(429); expect(await response.text()).not.toContain("private provider error");
    expect(mocks.finishAi).not.toHaveBeenCalled(); expect(mocks.failAi).toHaveBeenCalledTimes(3);
  });
  it("times out the provider request and releases its durable lease for retry", async () => {
    vi.useFakeTimers();
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      markStarted();
    }));
    const pending = organize(post()); await started;
    await vi.advanceTimersByTimeAsync(40_001);
    const response = await pending;
    expect(response.status).toBe(504); expect((await response.json()).code).toBe("AI_TIMEOUT");
    expect(mocks.failAi).toHaveBeenCalledWith({}, note.id, "test-lease", expect.any(String));
    expect(mocks.finishAi).not.toHaveBeenCalled();
  });
});
