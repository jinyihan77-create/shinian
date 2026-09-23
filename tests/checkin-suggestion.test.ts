import { describe, expect, it } from "vitest";
import { suggestCheckinFromNotes } from "../src/lib/checkin";
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
});
