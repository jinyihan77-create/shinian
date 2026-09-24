import { describe, expect, it } from "vitest";
import { createExamples } from "../src/lib/examples";
import { searchNotes } from "../src/lib/search";
import { createBackup, parseBackup, toMarkdown } from "../src/lib/backup";
import { applyTicketMeta, taskStatus, taskTags, preserveTaskTags, ticketMeta, ticketNumber, ticketPool, visibleTags } from "../src/lib/task-tickets";
import { captureContextTags } from "../src/lib/note-context";

describe("行动票独立于普通记录", () => {
  it("普通记录不进入行动票，只有明确行动会出现在状态视图", () => {
    const notes = createExamples();
    expect(taskStatus(notes[0])).toBe("none");
    expect(taskStatus(notes[1])).toBe("pending");
    notes[1] = { ...notes[1], tags: taskTags(notes[1], "start") };
    notes[1] = { ...notes[1], tags: taskTags(notes[1], "complete") };
    notes[2] = { ...notes[2], aiStatus: "done", reflectionText: "我已经写好理解，但还没有亲手完成事项" };
    expect(taskStatus(notes[2])).toBe("none");
    const departure = searchNotes(notes, "", "departure").map(item => item.note.id);
    const arrival = searchNotes(notes, "", "arrival").map(item => item.note.id);
    expect(departure).toHaveLength(0);
    expect(arrival).toEqual([notes[1].id]);
  });

  it("重新启程沿用同一事项与票号，保存与备份保留进度而阅读版不泄露内部标记", () => {
    const seed = { ...createExamples()[0], tags: ["计划", "闪卡收藏"] };
    const original = { ...seed, tags: taskTags(seed, "queue") };
    const active = { ...original, tags: taskTags(original, "start") };
    const completed = { ...active, tags: taskTags(active, "complete") };
    const restored = parseBackup(JSON.stringify(createBackup([completed]))).backup!.notes[0];
    expect(taskStatus(restored)).toBe("completed");
    expect(toMarkdown([restored])).toContain("事项进度：已完成");
    expect(toMarkdown([restored])).not.toContain("shinian");
    expect(searchNotes([restored], "__shinian_task")).toHaveLength(0);
    const reopened = { ...restored, tags: taskTags(restored, "reopen") };
    expect(taskStatus(reopened)).toBe("active");
    expect(visibleTags(reopened.tags)).toEqual(["计划", "闪卡收藏"]);
    expect(reopened.userText).toBe(original.userText);
    expect(reopened.reflectionText).toBe(original.reflectionText);
    expect(ticketNumber(reopened.id)).toBe(ticketNumber(original.id));
  });

  it("编辑标题标签不会重置进度，非法跳步和标签超限明确报错", () => {
    const plain = createExamples()[0];
    const note = { ...plain, tags: taskTags(plain, "queue") };
    expect(() => taskTags(note, "complete")).toThrow("状态已变化");
    const active = { ...note, tags: taskTags(note, "start") };
    expect(() => taskTags(active, "start")).toThrow("状态已变化");
    expect(taskStatus({ tags: preserveTaskTags(["新标签"], active.tags) })).toBe("active");
    expect(visibleTags(preserveTaskTags(["新标签"], active.tags))).toEqual(["新标签"]);
    const full = Array.from({ length: 30 }, (_, index) => "主题" + index);
    expect(() => taskTags({ tags: full }, "queue")).toThrow("标签已满");
    expect(() => preserveTaskTags(full, active.tags)).toThrow("标签已满");
  });

  it("私人记录去向不会污染主题筛选，并在事项流转和标签编辑后保留", () => {
    const plain = { ...createExamples()[0], tags: [...captureContextTags("relationship"), "相处"] };
    const note = { ...plain, tags: taskTags(plain, "queue") };
    expect(visibleTags(note.tags)).toEqual(["相处"]);
    const active = { ...note, tags: taskTags(note, "start") };
    expect(active.tags).toEqual(expect.arrayContaining(captureContextTags("relationship")));
    expect(preserveTaskTags(["新主题"], active.tags)).toEqual(expect.arrayContaining([...captureContextTags("relationship"), "新主题"]));
  });

  it("AI 只把明确行动变成票，并允许用户改回普通记录", () => {
    const plain = createExamples()[0];
    const suggested = { ...plain, aiResult: {
      title: plain.title, thoughtSummary: plain.userText, sourceSummary: null, keyPoints: [], tags: [],
      reflectionQuestions: ["你如何理解？"], possibleApplication: null,
      actionItem: { title: "写下三句话", nextStep: "打开备忘录，先写第一句。" },
    } };
    expect(taskStatus(suggested)).toBe("pending");
    const dismissed = { ...suggested, tags: taskTags(suggested, "dismiss") };
    expect(taskStatus(dismissed)).toBe("none");
    expect(searchNotes([dismissed], "", "departure")).toHaveLength(0);
  });

  it("行动建议确认后才写入分区元数据，等待清单不会进入抽卡池", () => {
    const plain = createExamples()[0];
    const queuedTags = applyTicketMeta(taskTags(plain, "queue"), { pool: "one_time", durationMinutes: 10, resistance: "low", cadence: "none" });
    const queued = { ...plain, tags: queuedTags };
    expect(taskStatus(queued)).toBe("pending");
    expect(ticketPool(queued)).toBe("one_time");
    expect(ticketMeta(queued.tags)).toMatchObject({ durationMinutes: 10, resistance: "low", cadence: "none" });
    const waiting = { ...plain, tags: applyTicketMeta(taskTags(plain, "hold"), { pool: "waiting", durationMinutes: 20, resistance: "high", cadence: "none", prerequisite: "等对方回复" }) };
    expect(taskStatus(waiting)).toBe("none");
    expect(ticketPool(waiting)).toBe("waiting");
    expect(visibleTags(waiting.tags)).toEqual(visibleTags(plain.tags));
  });
});
