import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as refineReflection } from "../src/app/api/refine-reflection/route";
import { ApiError } from "../src/lib/server/http";
import { emptyCapture, type EchoNote } from "../src/lib/types";

const mocks = vi.hoisted(() => ({ requirePrivateUser: vi.fn(), get: vi.fn(), refine: vi.fn() }));
vi.mock("../src/lib/server/supabase", () => ({ requirePrivateUser: mocks.requirePrivateUser }));
vi.mock("../src/lib/server/cloud-notes", () => ({ cloudNotes: { get: mocks.get } }));
vi.mock("../src/lib/server/organize", () => ({ refineReflectionWithAi: mocks.refine }));

const origin = "http://localhost:3000";
const note: EchoNote = {
  ...emptyCapture(),
  id: "28ab19bc-6ec7-4c63-b66a-a93924d72938",
  title: "把收藏变成自己的理解",
  userText: "听完后先复述。",
  aiStatus: "not_started", aiResult: null, aiInputRevision: null, aiError: null,
  reflectionPrompt: "我真正理解了什么？", reflectionText: "旧的理解", revision: 1,
  tags: [], createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z",
  isExample: false, storageVersion: 7,
};
const text = "我说了很多，但核心是收藏并不等于理解。我想先复述，再决定要不要留下。";
const lines = ["收藏不等于真正理解。", "能复述出来，才算变成自己的。", "以后先说一遍，再决定是否收藏。"] as [string, string, string];

function post(body: unknown = { id: note.id, version: 7, text }, requestOrigin = origin) {
  return new Request(origin + "/api/refine-reflection", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: requestOrigin },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("APP_ORIGIN", "");
  delete (globalThis as { __echoRateLimits?: unknown }).__echoRateLimits;
  mocks.requirePrivateUser.mockResolvedValue({ client: {}, user: { id: crypto.randomUUID(), email: "owner@example.com" } });
  mocks.get.mockResolvedValue(note); mocks.refine.mockResolvedValue({ lines });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("私人闪卡提炼接口", () => {
  it("只读取当前账号的云端记录，并返回未保存的三句预览", async () => {
    const response = await refineReflection(post());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reflection: { lines } });
    expect(mocks.requirePrivateUser).toHaveBeenCalledOnce();
    expect(mocks.get).toHaveBeenCalledWith({}, note.id);
    expect(mocks.refine).toHaveBeenCalledWith({ title: note.title, reflectionText: text }, expect.any(AbortSignal));
  });

  it("记录版本已变化时拒绝提炼，也不会调用AI", async () => {
    mocks.get.mockResolvedValueOnce({ ...note, storageVersion: 8 });
    const response = await refineReflection(post());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CONFLICT", error: expect.stringContaining("原话没有改变") });
    expect(mocks.refine).not.toHaveBeenCalled();
  });

  it("拒绝跨站、额外字段和未登录请求", async () => {
    expect((await refineReflection(post(undefined, "https://elsewhere.example"))).status).toBe(403);
    expect((await refineReflection(post({ id: note.id, version: 7, text, overwrite: true }))).status).toBe(400);
    mocks.requirePrivateUser.mockRejectedValueOnce(new ApiError(401, "AUTH_REQUIRED", "请登录"));
    expect((await refineReflection(post())).status).toBe(401);
    expect(mocks.refine).not.toHaveBeenCalled();
  });
});
