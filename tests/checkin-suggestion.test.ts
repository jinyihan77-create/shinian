import { describe, expect, it } from "vitest";
import { checkinKeywordsFromNotes, checkinSourceNoteIds, suggestCheckinFromNotes } from "../src/lib/checkin";
import { createExamples } from "../src/lib/examples";

describe("suggestCheckinFromNotes", () => {
  it("uses the latest note from the current Shanghai day", () => {
    const notes = createExamples().map((note, index) => ({
      ...note,
      updatedAt: index === 0 ? "2026-09-23T12:00:00.000Z" : "2026-09-22T12:00:00.000Z",
      createdAt: index === 0 ? "2026-09-23T12:00:00.000Z" : "2026-09-22T12:00:00.000Z",
    }));
    const suggestion = suggestCheckinFromNotes(notes, "2026-09-23");
    expect(suggestion.sourceCount).toBe(1);
    expect(suggestion.mood).toBe("充满好奇");
    expect(suggestion.quote).toContain("我发现自己听了很多播客");
  });

  it("is honest when there is no note today", () => {
    expect(suggestCheckinFromNotes([], "2026-09-23")).toEqual({ mood: "", quote: "", sourceCount: 0 });
  });

  it("links source notes by the Shanghai calendar day", () => {
    const examples = createExamples();
    const notes = [
      { ...examples[0], id: "after-midnight", createdAt: "2026-09-22T16:30:00.000Z", updatedAt: "2026-09-22T16:30:00.000Z" },
      { ...examples[1], id: "before-midnight", createdAt: "2026-09-22T15:30:00.000Z", updatedAt: "2026-09-22T15:30:00.000Z" },
    ];
    expect(checkinSourceNoteIds(notes, "2026-09-23")).toEqual(["after-midnight"]);
  });

  it("uses only traceable note labels for the journey and removes duplicates", () => {
    const example = createExamples()[0];
    const note = {
      ...example,
      title: "重新理解主动表达",
      tags: ["主动表达", "播客笔记", "主动表达"],
      aiResult: example.aiResult ? { ...example.aiResult, tags: ["播客笔记", "行动门槛"] } : {
        title: "", thoughtSummary: "", sourceSummary: null, keyPoints: [], tags: ["播客笔记", "行动门槛"], reflectionQuestions: [], possibleApplication: null,
      },
      createdAt: "2026-09-23T08:00:00.000Z",
      updatedAt: "2026-09-23T08:00:00.000Z",
    };
    expect(checkinKeywordsFromNotes([note], "2026-09-23")).toEqual(["主动表达", "播客笔记", "行动门槛", "重新理解主动表达"]);
    expect(checkinKeywordsFromNotes([], "2026-09-23")).toEqual([]);
  });
});
