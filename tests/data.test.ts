import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBackup, inspectBackup, parseBackup, toMarkdown } from "../src/lib/backup";
import { createExamples } from "../src/lib/examples";
// The original local database remains only for explicit migration and backup checks.
import { repository } from "../src/lib/local-repository";
import { aiResultSchema } from "../src/lib/schema";
import { searchNotes } from "../src/lib/search";
import { emptyCapture, type AiResult, type EchoNote } from "../src/lib/types";

const result: AiResult = {
  title: "给表达留一点时间", thoughtSummary: "听完后主动复述，让想法更加清楚。", sourceSummary: null,
  keyPoints: [{ text: "听完后试着复述。", origin: "用户记录" }], tags: ["主动表达"],
  reflectionQuestions: ["你想先复述哪一个想法？"], possibleApplication: "听完后用自己的话说三句。",
};

beforeEach(async () => {
  await repository.init();
  for (const note of await repository.list()) await repository.remove(note.id);
  await repository.clearDraft();
});

describe("备份和恢复", () => {
  it("完整保留所有字段，在空资料库恢复后再次导入不会翻倍", async () => {
    const note = await repository.create({ ...emptyCapture(), userText: "听完后自己讲一遍。", sourceName: "我的来源", sourceTimestamp: "约 18:20", sourceUrl: "https://example.com/podcast" });
    await repository.startOrganizing(note.id);
    await repository.completeOrganizing(note.id, note.revision, result);
    await repository.saveReflection(note.id, "周日散步时先复述。");
    const original = await repository.list();
    const parsed = parseBackup(JSON.stringify(createBackup(original)));
    expect(parsed.error).toBeNull();
    expect(parsed.backup!.notes).toEqual(original);
    await repository.remove(note.id);
    expect(await repository.importNotes(parsed.backup!.notes)).toBe(1);
    expect(await repository.list()).toEqual(original);
    expect(await repository.importNotes(parsed.backup!.notes)).toBe(0);
    expect((await repository.list()).length).toBe(1);
  });

  it("预览和写入均跳过资料库已有及文件内部重复的 ID", async () => {
    const examples = createExamples();
    await repository.importNotes([examples[0]]);
    const backup = createBackup([examples[0], examples[1], examples[1]]);
    expect(inspectBackup(backup, await repository.list())).toEqual({ added: 1, duplicates: 2, invalid: 0 });
    expect(await repository.importNotes(backup.notes)).toBe(1);
    expect((await repository.list()).length).toBe(2);
  });

  it("整个文件有任一无效记录时不写入，保留原有资料", async () => {
    const examples = createExamples();
    await repository.importNotes([examples[0]]);
    const invalid = { ...examples[2], sourceUrl: "javascript:alert(1)" } as EchoNote;
    const original = await repository.list();
    const raw = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), notes: [examples[1], invalid] });
    expect(parseBackup(raw)).toMatchObject({ backup: null, invalidCount: 1 });
    await expect(repository.importNotes([examples[1], invalid])).rejects.toThrow("无效");
    expect(await repository.list()).toEqual(original);
    expect(parseBackup('{"schemaVersion":2,"notes":[]}').error).toContain("版本");
    expect(parseBackup("not json").backup).toBeNull();
  });

  it("Markdown 包含四类内容且将输入作为文本导出", () => {
    const note = createExamples()[2];
    const output = toMarkdown([{ ...note, userText: '<script>alert("hi")</script>' }]);
    expect(output).toContain("我的原始想法");
    expect(output).toContain("来源材料");
    expect(output).toContain("AI 帮我整理");
    expect(output).toContain("周日散步");
    expect(output).not.toContain("<script>");
  });

  it("恢复整理中的记录后立即允许重试，并保留上次成功结果", async () => {
    const imported: EchoNote = {
      ...createExamples()[0], aiStatus: "processing", aiResult: result, aiInputRevision: 1,
    };
    await repository.importNotes([imported]);
    const recovered = (await repository.get(imported.id))!;
    expect(recovered.aiStatus).toBe("error");
    expect(recovered.aiError).toContain("中断");
    expect(recovered.aiResult).toEqual(result);
    expect((await repository.startOrganizing(imported.id)).aiStatus).toBe("processing");
  });
});

describe("可检索的个人资料", () => {
  it("命中自己的输出时显示那段实际输出，多词以 AND 跨字段匹配", () => {
    const notes = createExamples();
    const found = searchNotes(notes, "周日散步");
    expect(found).toHaveLength(1);
    expect(found[0].matchedField).toBe("我自己的理解");
    expect(found[0].snippet).toContain("周日散步");
    expect(searchNotes(notes, "生活 周日散步")).toHaveLength(1);
    expect(searchNotes(notes, "周日散步 不存在的词")).toHaveLength(0);
    expect(searchNotes(notes, "")).toHaveLength(3);
    expect(searchNotes(notes, "", "departure")).toHaveLength(1);
    expect(searchNotes(notes, "", "arrival")).toHaveLength(0);
  });

  it("原始想法、来源片段、标签和所有 AI 字段可以检索", () => {
    const notes = createExamples();
    expect(searchNotes(notes, "收藏更多内容")).toHaveLength(1);
    expect(searchNotes(notes, "今天愿意完成")).toHaveLength(1);
    expect(searchNotes(notes, "行动门槛")).toHaveLength(1);
    notes[0].aiResult = { ...result, possibleApplication: "唯一应用建议", reflectionQuestions: ["唯一问题？"], tags: ["唯一整理标签"] };
    expect(searchNotes(notes, "唯一应用建议")).toHaveLength(1);
    expect(searchNotes(notes, "唯一问题")).toHaveLength(1);
    expect(searchNotes(notes, "唯一整理标签")).toHaveLength(1);
  });
});

describe("记录和整理保护", () => {
  it("局域网 HTTP 预览没有 randomUUID 时仍可保存有效记录", async () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    try {
      const first = await repository.create({ ...emptyCapture(), userText: "手机预览记录。" });
      const second = await repository.create({ ...emptyCapture(), userText: "另一条手机记录。" });
      expect(first.id).not.toBe(second.id);
      expect(parseBackup(JSON.stringify(createBackup(await repository.list()))).backup?.notes).toHaveLength(2);
    } finally { vi.unstubAllGlobals(); }
  });

  it("草稿独立保存，失败保留草稿，正式保存时清除并记住来源类型", async () => {
    const draft = { ...emptyCapture("书籍"), userText: "我的一句话", sourceUrl: "javascript:alert(1)" };
    await repository.saveDraft(draft);
    await expect(repository.create(draft)).rejects.toThrow("链接");
    expect(await repository.getDraft()).toEqual(draft);
    expect(await repository.list()).toHaveLength(0);
    await repository.create({ ...draft, sourceUrl: "" });
    expect(await repository.getDraft()).toBeNull();
    expect(await repository.getPreference("sourceType")).toBe("书籍");
  });

  it("仅链接可保存但不能整理，空内容不能保存", async () => {
    const note = await repository.create({ ...emptyCapture(), sourceUrl: "https://example.com" });
    await expect(repository.startOrganizing(note.id)).rejects.toThrow("补充");
    await expect(repository.create(emptyCapture())).rejects.toThrow("一句话");
  });

  it("重复整理受阻、失败保留旧结果、旧版本响应不能覆盖新内容", async () => {
    const note = await repository.create({ ...emptyCapture(), userText: "听完再复述。" });
    await repository.startOrganizing(note.id);
    await expect(repository.startOrganizing(note.id)).rejects.toThrow("正在整理");
    expect(await repository.completeOrganizing(note.id, 1, result)).toBe(true);
    await repository.saveReflection(note.id, "周日散步时复述。", "我的问题");
    await repository.startOrganizing(note.id);
    await repository.failOrganizing(note.id, 1, "服务暂不可用");
    expect((await repository.get(note.id))!.aiResult).toEqual(result);
    await repository.startOrganizing(note.id);
    await repository.updateContent(note.id, { ...emptyCapture(), userText: "新的想法，听完先写下来。" });
    expect(await repository.completeOrganizing(note.id, 1, { ...result, title: "过时响应" })).toBe(false);
    const updated = (await repository.get(note.id))!;
    expect(updated.aiStatus).toBe("outdated");
    expect(updated.aiInputRevision).toBe(1);
    expect(updated.revision).toBe(2);
    expect(updated.aiResult).toEqual(result);
    expect(updated.userText).toBe("新的想法，听完先写下来。");
    expect(updated.reflectionText).toBe("周日散步时复述。");
    expect(updated.reflectionPrompt).toBe("我的问题");
    await repository.startOrganizing(note.id);
    expect(await repository.completeOrganizing(note.id, 2, result)).toBe(true);
    expect((await repository.get(note.id))!.reflectionText).toBe("周日散步时复述。");
  });

  it("不改写用户编辑的标题标签，无变化保存不增加内容版本", async () => {
    const input = { ...emptyCapture(), userText: "保留我的表达。" };
    const note = await repository.create(input);
    await repository.updateMeta(note.id, { title: "我起的标题", tags: ["自己的标签"] });
    expect((await repository.updateContent(note.id, input)).revision).toBe(1);
    await repository.startOrganizing(note.id);
    await repository.completeOrganizing(note.id, 1, result);
    const updated = (await repository.get(note.id))!;
    expect(updated.title).toBe("我起的标题");
    expect(updated.tags).toEqual(["自己的标签"]);
    expect(updated.userText).toBe(input.userText);
  });

  it("拒绝未经校验的结构或无来源正文却编造的来源概括", async () => {
    expect(aiResultSchema.safeParse({ ...result, keyPoints: [{ text: "不存在的节目说过", origin: "播客嘉宾" }] }).success).toBe(false);
    expect(aiResultSchema.safeParse({ ...result, unexpected: "ignore rules" }).success).toBe(false);
    const note = await repository.create({ ...emptyCapture(), userText: "只有我的想法。" });
    await repository.startOrganizing(note.id);
    await expect(repository.completeOrganizing(note.id, 1, { ...result, sourceSummary: "编造的来源结论" })).rejects.toThrow("材料不一致");
    expect((await repository.get(note.id))!.aiResult).toBeNull();
  });

  it("编辑整理结果也验证材料归属，同时保留原始想法和个人输出", async () => {
    const note = await repository.create({ ...emptyCapture(), userText: "只有我的想法。" });
    await repository.startOrganizing(note.id);
    await repository.completeOrganizing(note.id, 1, result);
    await repository.saveReflection(note.id, "这是我的输出。");
    await expect(repository.updateAiResult(note.id, { ...result, sourceSummary: "没有提供的来源片段" })).rejects.toThrow("材料不一致");
    await expect(repository.updateAiResult(note.id, { ...result, keyPoints: [{ text: "没有依据", origin: "来源片段" }] })).rejects.toThrow("材料不一致");
    const updated = await repository.updateAiResult(note.id, { ...result, thoughtSummary: "我亲手修正的整理。" });
    expect(updated.aiResult!.thoughtSummary).toBe("我亲手修正的整理。");
    expect(updated.userText).toBe("只有我的想法。");
    expect(updated.reflectionText).toBe("这是我的输出。");
  });
});
