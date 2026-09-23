// Mocked CloudBase SDK boundary. This verifies the refinement contract without
// claiming that a live model, account quota or network connection succeeded.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refineReflectionWithAi, validateReflectionRefineResult } from "../src/lib/server/organize";

const sdk = vi.hoisted(() => ({ init: vi.fn(), ai: vi.fn(), createModel: vi.fn(), generateText: vi.fn() }));
vi.mock("@cloudbase/node-sdk", () => ({ init: sdk.init }));

const input = {
  title: "把收藏变成自己的理解",
  reflectionText: "我以前总觉得收藏了就是学会了，但回头看根本讲不出来。我想以后听完先用自己的话复述，再决定要不要保存。",
};
const result = {
  lines: ["收藏不等于真正理解。", "能复述出来，才算变成自己的。", "以后先说一遍，再决定是否收藏。"] as [string, string, string],
};

function completion(text = JSON.stringify(result), finish = "stop") {
  return { text, rawResponses: [{ choices: [{ finish_reason: finish, message: { role: "assistant", content: text } }] }], messages: [], usage: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CLOUD_PROVIDER", "cloudbase");
  vi.stubEnv("CLOUDBASE_ENV_ID", `reflection-${crypto.randomUUID()}`);
  vi.stubEnv("CLOUDBASE_REGION", "ap-shanghai");
  vi.stubEnv("CLOUDBASE_AI_MODEL", "mock-reflection-model");
  sdk.init.mockReturnValue({ ai: sdk.ai });
  sdk.ai.mockReturnValue({ createModel: sdk.createModel });
  sdk.createModel.mockReturnValue({ generateText: sdk.generateText });
  sdk.generateText.mockResolvedValue(completion());
});

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("闪卡三句话提炼", () => {
  it("只把当前标题和原话交给AI，并严格接收三句短句", async () => {
    await expect(refineReflectionWithAi(input)).resolves.toEqual(result);
    const [request, options] = sdk.generateText.mock.calls[0];
    expect(request).toMatchObject({ model: "mock-reflection-model", temperature: 0.25, max_tokens: 600, maxSteps: 1 });
    expect(options).toEqual({ timeout: 40_000 });
    expect(request.messages[0].content).toContain("不得补充事实、经历、情绪、结论、名言或行动");
    expect(JSON.parse(request.messages[1].content)).toEqual(input);
  });

  it("拒绝重复、过长或不是恰好三句的输出", () => {
    expect(() => validateReflectionRefineResult({ lines: ["同一句话", "同一句话", "第三句话"] })).toThrow();
    expect(() => validateReflectionRefineResult({ lines: ["第一句", "第二句"] })).toThrow();
    expect(() => validateReflectionRefineResult({ lines: ["第一句", "第二句", "这句话明显超过了三十二个字符所以不应该被当成可以直接写在闪卡上的精炼结果"] })).toThrow();
  });

  it("模型拒绝或生成被截断时明确失败，不把半成品当成功", async () => {
    sdk.generateText.mockResolvedValueOnce(completion(JSON.stringify(result), "length"));
    await expect(refineReflectionWithAi(input)).rejects.toMatchObject({ code: "INCOMPLETE_REFLECTION_REFINEMENT" });
    sdk.generateText.mockResolvedValueOnce(completion("", "content_filter"));
    await expect(refineReflectionWithAi(input)).rejects.toMatchObject({ code: "AI_REFUSED" });
  });
});
