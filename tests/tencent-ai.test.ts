// Mocked CloudBase Node SDK boundary. These checks do not prove a real Tencent
// environment, credentials, billing quota or model has been connected.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizeSourceWithAi, organizeWithAi } from "../src/lib/server/organize";
import { serviceStatus } from "../src/lib/server/access";
import { emptyCapture, type AiRequest, type AiResult, type SourceIntakeRequest, type SourceIntakeResult } from "../src/lib/types";

const sdk = vi.hoisted(() => ({ init: vi.fn(), ai: vi.fn(), createModel: vi.fn(), generateText: vi.fn() }));
vi.mock("@cloudbase/node-sdk", () => ({ init: sdk.init }));
const input: AiRequest = { ...emptyCapture(), id: "a34dba25-574f-4aa8-80f7-b32774687ce2", revision: 1, userText: "听完之后复述一下。", sourceName: "我的来源", sourceUrl: "https://example.com/source" };
const result: AiResult = { title: "用复述留下想法", thoughtSummary: "听完之后用自己的话复述。", sourceSummary: null,
  keyPoints: [{ text: "听完之后复述。", origin: "用户记录" }], tags: ["复述"], reflectionQuestions: ["你想先解释哪一点？"], possibleApplication: null };
const sourceInput: SourceIntakeRequest = { transcript: "这是播客得意忘形，十八分二十秒，原话是不要急着给答案。", currentSourceType: "文章" };
const sourceResult: SourceIntakeResult = { sourceType: "播客", sourceName: "得意忘形", sourceTimestamp: "18:20", sourceExcerpt: "不要急着给答案。" };
function completion(text = JSON.stringify(result), finish = "stop") {
  return { text, rawResponses: [{ choices: [{ finish_reason: finish, message: { role: "assistant", content: text } }] }], messages: [], usage: {} };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CLOUD_PROVIDER", "cloudbase"); vi.stubEnv("CLOUDBASE_ENV_ID", `mock-env-${crypto.randomUUID()}`);
  vi.stubEnv("CLOUDBASE_REGION", "ap-shanghai"); vi.stubEnv("CLOUDBASE_AI_MODEL", "console-confirmed-model");
  vi.stubEnv("OPENAI_API_KEY", ""); vi.stubEnv("AI_MODEL", "");
  vi.stubGlobal("fetch", vi.fn());
  sdk.init.mockReturnValue({ ai: sdk.ai }); sdk.ai.mockReturnValue({ createModel: sdk.createModel });
  sdk.createModel.mockReturnValue({ generateText: sdk.generateText }); sdk.generateText.mockResolvedValue(completion());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("腾讯云AI适配（模拟SDK边界，不是真实服务验证）", () => {
  it("仅配置环境和模型，无需OpenAI密钥；不把配置存在说成真实调用成功", async () => {
    expect(serviceStatus()).toMatchObject({ configured: true, available: true });
    expect(serviceStatus().message).toContain("实际权限、额度和调用结果以每次整理为准");
    vi.stubEnv("CLOUDBASE_AI_MODEL", "");
    expect(serviceStatus()).toMatchObject({ configured: false, available: false });
    await expect(organizeWithAi(input)).rejects.toMatchObject({ code: "AI_UNAVAILABLE", status: 503 });
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it("使用腾讯环境身份和确认的模型，发送当前材料并校验JSON，不伪造strict schema参数", async () => {
    await expect(organizeWithAi(input)).resolves.toEqual(result);
    expect(sdk.init).toHaveBeenCalledWith({ env: process.env.CLOUDBASE_ENV_ID, region: "ap-shanghai", timeout: 40_000 });
    expect(sdk.createModel).toHaveBeenCalledWith("cloudbase");
    const [request, options] = sdk.generateText.mock.calls[0];
    expect(request).toMatchObject({ model: "console-confirmed-model", max_tokens: 4000, maxSteps: 1 });
    expect(options).toEqual({ timeout: 40_000 });
    expect(request.response_format).toBeUndefined(); expect(request.text).toBeUndefined();
    expect(request.messages[0]).toMatchObject({ role: "system", content: expect.stringContaining("只返回一个完整 JSON 对象") });
    expect(JSON.parse(request.messages[1].content)).toEqual({ userText: input.userText, sourceType: input.sourceType, sourceName: input.sourceName,
      sourceUrl: input.sourceUrl, sourceTimestamp: input.sourceTimestamp, sourceExcerpt: input.sourceExcerpt });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("非JSON、来源臆造和截断结果均失败，不把部分内容当成功", async () => {
    sdk.generateText.mockResolvedValueOnce(completion("```json\n{}\n```"));
    await expect(organizeWithAi(input)).rejects.toMatchObject({ code: "INVALID_AI_RESULT" });
    sdk.generateText.mockResolvedValueOnce(completion(JSON.stringify({ ...result, sourceSummary: "没提供的原文" })));
    await expect(organizeWithAi(input)).rejects.toMatchObject({ code: "UNSUPPORTED_ATTRIBUTION" });
    sdk.generateText.mockResolvedValueOnce(completion(JSON.stringify(result), "length"));
    await expect(organizeWithAi(input)).rejects.toMatchObject({ code: "INCOMPLETE_AI_RESULT" });
    sdk.generateText.mockResolvedValueOnce(completion("", "content_filter"));
    await expect(organizeWithAi(input)).rejects.toMatchObject({ code: "AI_REFUSED" });
  });

  it("权限、额度和未知模型错误映射为真实失败，隐藏SDK敏感响应", async () => {
    sdk.generateText.mockRejectedValueOnce({ code: "403", message: "private credential details" });
    await expect(organizeWithAi(input)).rejects.toMatchObject({ code: "PROVIDER_AUTH_ERROR", status: 503, message: expect.not.stringContaining("private") });
    sdk.generateText.mockRejectedValueOnce({ code: "429", message: "private quota details" });
    await expect(organizeWithAi(input)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED", status: 429 });
    sdk.generateText.mockRejectedValueOnce({ code: "model_not_found", message: "private provider response" });
    await expect(organizeWithAi(input)).rejects.toMatchObject({ code: "PROVIDER_ERROR", status: 502 });
  });

  it("超时停止等待，迟到的SDK成功结果也不能转成已整理", async () => {
    vi.useFakeTimers();
    let finish!: (value: ReturnType<typeof completion>) => void;
    let started!: () => void;
    const start = new Promise<void>(resolve => { started = resolve; });
    sdk.generateText.mockImplementationOnce(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    const pending = organizeWithAi(input);
    const rejected = expect(pending).rejects.toMatchObject({ code: "AI_TIMEOUT", status: 504 });
    await start; await vi.advanceTimersByTimeAsync(40_001); await rejected;
    finish(completion()); await Promise.resolve();
    expect(sdk.generateText).toHaveBeenCalledOnce();
  });

  it("只有链接或请求已取消时不调用腾讯AI", async () => {
    await expect(organizeWithAi({ ...input, userText: "" })).rejects.toMatchObject({ code: "CONTENT_REQUIRED" });
    const controller = new AbortController(); controller.abort();
    await expect(organizeWithAi(input, controller.signal)).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    expect(sdk.generateText).not.toHaveBeenCalled();
  });

  it("把口述来源交给腾讯AI拆分，并且只发送口述和当前类型", async () => {
    sdk.generateText.mockResolvedValueOnce(completion(JSON.stringify(sourceResult)));
    await expect(organizeSourceWithAi(sourceInput)).resolves.toEqual(sourceResult);
    const [request, options] = sdk.generateText.mock.calls[0];
    expect(request).toMatchObject({ model: "console-confirmed-model", temperature: 0.1, max_tokens: 4000, maxSteps: 1 });
    expect(options).toEqual({ timeout: 40_000 });
    expect(request.messages[0].content).toContain("没有听出的字段必须为 null");
    expect(JSON.parse(request.messages[1].content)).toEqual(sourceInput);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("不把空字段或截断的口述整理冒充成功", async () => {
    sdk.generateText.mockResolvedValueOnce(completion(JSON.stringify({ ...sourceResult, sourceName: "" })));
    await expect(organizeSourceWithAi(sourceInput)).rejects.toMatchObject({ code: "INVALID_SOURCE_INTAKE" });
    sdk.generateText.mockResolvedValueOnce(completion(JSON.stringify(sourceResult), "length"));
    await expect(organizeSourceWithAi(sourceInput)).rejects.toMatchObject({ code: "INCOMPLETE_SOURCE_INTAKE" });
    await expect(organizeSourceWithAi({ ...sourceInput, transcript: " " })).rejects.toMatchObject({ code: "SOURCE_SPEECH_REQUIRED" });
  });
});
