import { describe, expect, it } from "vitest";
import { createExamples } from "../src/lib/examples";
import { searchNotes } from "../src/lib/search";
import { createBackup, parseBackup, toMarkdown } from "../src/lib/backup";
import { taskStatus, taskTags, preserveTaskTags, visibleTags, ticketNumber } from "../src/lib/task-tickets";
import { captureContextTags } from "../src/lib/note-context";

describe("独立于 AI 与理解的事项进度", () => {
  it("只有显式完成才进入终点票，两个列表互斥且覆盖所有事项", () => {
    const notes = createExamples();
    notes[0] = { ...notes[0], tags: taskTags(notes[0], "start") };
    notes[1] = { ...notes[1], tags: taskTags(notes[1], "start") };
    notes[1] = { ...notes[1], tags: taskTags(notes[1], "complete") };
    notes[2] = { ...notes[2], aiStatus: "done", reflectionText: "我已经写好理解，但还没有亲手完成事项" };
    expect(taskStatus(notes[2])).toBe("pending");
    const departure = searchNotes(notes, "", "departure").map(item => item.note.id);
    const arrival = searchNotes(notes, "", "arrival").map(item => item.note.id);
    expect(departure).toHaveLength(2);
    expect(arrival).toEqual([notes[1].id]);
    expect(departure.some(id => arrival.includes(id))).toBe(false);
    expect(new Set([...departure, ...arrival]).size).toBe(3);
  });

  it("重新启程沿用同一事项与票号，保存与备份保留进度而阅读版不泄露内部标记", () => {
    const original = { ...createExamples()[0], tags: ["计划", "闪卡收藏"] };
    const active = { ...original, tags: taskTags(original, "start") };
    const completed = { ...active, tags: taskTags(active, "complete") };
    const restored = parseBackup(JSON.stringify(createBackup([completed]))).backup!.notes[0];
    expect(taskStatus(restored)).toBe("completed");
    expect(toMarkdown([restored])).toContain("事项进度：已完成");
    expect(toMarkdown([restored])).not.toContain("shinian");
    expect(searchNotes([restored], "__shinian_task")).toHaveLength(0);
    const reopened = { ...restored, tags: taskTags(restored, "reopen") };
    expect(taskStatus(reopened)).toBe("active");
    expect(visibleTags(reopened.tags)).toEqual(original.tags);
    expect(reopened.userText).toBe(original.userText);
    expect(reopened.reflectionText).toBe(original.reflectionText);
    expect(ticketNumber(reopened.id)).toBe(ticketNumber(original.id));
  });

  it("编辑标题标签不会重置进度，非法跳步和标签超限明确报错", () => {
    const note = createExamples()[0];
    expect(() => taskTags(note, "complete")).toThrow("状态已变化");
    const active = { ...note, tags: taskTags(note, "start") };
    expect(() => taskTags(active, "start")).toThrow("状态已变化");
    expect(taskStatus({ tags: preserveTaskTags(["新标签"], active.tags) })).toBe("active");
    expect(visibleTags(preserveTaskTags(["新标签"], active.tags))).toEqual(["新标签"]);
    const full = Array.from({ length: 30 }, (_, index) => "主题" + index);
    expect(() => taskTags({ tags: full }, "start")).toThrow("标签已满");
    expect(() => preserveTaskTags(full, active.tags)).toThrow("标签已满");
  });

  it("私人记录去向不会污染主题筛选，并在事项流转和标签编辑后保留", () => {
    const note = { ...createExamples()[0], tags: [...captureContextTags("relationship"), "相处"] };
    expect(visibleTags(note.tags)).toEqual(["相处"]);
    const active = { ...note, tags: taskTags(note, "start") };
    expect(active.tags).toEqual(expect.arrayContaining(captureContextTags("relationship")));
    expect(preserveTaskTags(["新主题"], active.tags)).toEqual(expect.arrayContaining([...captureContextTags("relationship"), "新主题"]));
  });
});
