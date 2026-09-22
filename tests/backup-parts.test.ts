import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackup, MAX_BACKUP_BYTES, parseBackup, splitBackup } from "../src/lib/backup";
import { noteSchema } from "../src/lib/schema";
import { DEFAULT_QUESTION, emptyCapture, type EchoNote } from "../src/lib/types";

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function makeNote(index: number, text = "说出自己的理解"): EchoNote {
  return { ...emptyCapture(), id: `${index.toString(16).padStart(8, "0")}-dddd-4ddd-8ddd-dddddddddddd`,
    userText: text, title: "灵感", tags: [], aiStatus: "not_started", aiResult: null, aiInputRevision: null, aiError: null,
    reflectionPrompt: DEFAULT_QUESTION, reflectionText: "", revision: 1, storageVersion: 1,
    createdAt: "2026-09-21T00:00:00.000Z", updatedAt: "2026-09-21T00:00:00.000Z", isExample: false };
}
afterEach(() => vi.useRealTimers());

describe("independently restorable cloud backup parts", () => {
  it("counts actual UTF-8 bytes, accepts the exact size and splits one byte below it", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-21T00:00:00.000Z"));
    const notes = [makeNote(1, "中文🙂".repeat(100)), makeNote(2, '引号"换行\n'.repeat(100))];
    const original = createBackup(notes);
    expect(byteLength(original)).toBeGreaterThan(JSON.stringify(original).length);
    const exact = splitBackup(notes, byteLength(original));
    expect(exact).toHaveLength(1); expect(exact[0]).toEqual(original);
    const smaller = splitBackup(notes, byteLength(original) - 1);
    expect(smaller).toHaveLength(2);
    for (const part of smaller) expect(byteLength(part)).toBeLessThanOrEqual(byteLength(original) - 1);
  });

  it("round-trips every field and every unique ID across independently valid parts", () => {
    const notes = Array.from({ length: 39 }, (_, index) => makeNote(index + 1, `想法 ${index}：` + "知识🧠".repeat(50)));
    notes[10].isExample = true; notes[11].reflectionText = "个人输出不能遗失";
    const snapshot = structuredClone(notes);
    const parts = splitBackup(notes, 4000);
    expect(parts.length).toBeGreaterThan(1);
    const restored = parts.flatMap(part => {
      const parsed = parseBackup(JSON.stringify(part));
      expect(parsed.error).toBeNull(); expect(part.schemaVersion).toBe(1);
      expect(byteLength(part)).toBeLessThanOrEqual(4000);
      expect(byteLength({ notes: part.notes })).toBeLessThanOrEqual(4000);
      return parsed.backup!.notes;
    });
    expect(restored).toEqual(notes); expect(notes).toEqual(snapshot);
    expect(new Set(restored.map(note => note.id)).size).toBe(notes.length);
  });

  it("rejects a single record that cannot fit, instead of returning an incomplete backup", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-21T00:00:00.000Z"));
    const small = makeNote(1); const large = makeNote(2, "很长的记录".repeat(1500));
    const exact = byteLength(createBackup([large]));
    expect(() => splitBackup([small, large], exact - 1)).toThrow("单条记录");
    expect(splitBackup([large], exact)).toHaveLength(1);
  });

  it("retains the 25 MiB parser ceiling and an empty library remains restorable", () => {
    const empty = splitBackup([]);
    expect(empty).toHaveLength(1); expect(parseBackup(JSON.stringify(empty[0])).backup?.notes).toEqual([]);
    const tooLarge = " ".repeat(MAX_BACKUP_BYTES + 1);
    expect(parseBackup(tooLarge)).toMatchObject({ backup: null, error: expect.stringContaining("25 MB") });
  });

  it("keeps a cloud record with maximal fields and JSON escapes below one MiB", () => {
    // Control characters use six JSON bytes per UTF-16 unit, exceeding Chinese
    // and emoji byte expansion. Cloud timestamps are generated as 24 chars.
    const fill = (length: number) => "\u0001".repeat(length);
    const note: EchoNote = { ...makeNote(1), userText: fill(20000), sourceExcerpt: fill(40000),
      sourceName: fill(200), sourceTimestamp: fill(80), sourceUrl: "https://example.com/" + "a".repeat(2028),
      title: fill(100), tags: Array.from({ length: 30 }, () => fill(40)), reflectionPrompt: fill(1000), reflectionText: fill(30000),
      aiStatus: "done", aiInputRevision: 1, aiError: fill(2000), aiResult: {
        title: fill(100), thoughtSummary: fill(6000), sourceSummary: fill(10000),
        keyPoints: Array.from({ length: 3 }, () => ({ text: fill(2000), origin: "用户记录" as const })),
        tags: Array.from({ length: 5 }, () => fill(40)), reflectionQuestions: [fill(500), fill(500)], possibleApplication: fill(2000),
      } };
    expect(noteSchema.safeParse(note).success).toBe(true);
    expect(byteLength({ note })).toBeLessThan(1024 * 1024);
    expect(byteLength(splitBackup([note])[0])).toBeLessThan(3.5 * 1024 * 1024);
  });
});
