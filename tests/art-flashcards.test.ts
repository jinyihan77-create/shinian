import { describe, expect, it } from "vitest";
import { FLASHCARD_TAG, paintingForNote, reflectionThoughts, withFlashcardFavorite } from "../src/lib/art-flashcards";

describe("personal oil-painting flashcards", () => {
  it("preserves every thought, including more than three and punctuation", () => {
    expect(reflectionThoughts("第一句。\n第二句？！\n第三句\n补充的一句")).toEqual(["第一句。", "第二句？！", "第三句", "补充的一句"]);
    expect(reflectionThoughts("听见不是理解。我要自己解释！下一次试试？")).toEqual(["听见不是理解。", "我要自己解释！", "下一次试试？"]);
    expect(reflectionThoughts(" \n\n ")).toEqual([]);
  });
  it("retains existing tags and prevents exceeding the server's tag limit", () => {
    const tags = ["学习", "表达"];
    expect(withFlashcardFavorite(tags, true)).toEqual([...tags, FLASHCARD_TAG]);
    expect(withFlashcardFavorite([...tags, FLASHCARD_TAG], false)).toEqual(tags);
    expect(tags).toEqual(["学习", "表达"]);
    expect(() => withFlashcardFavorite(Array.from({ length: 30 }, (_, n) => `${n}`), true)).toThrow("标签已满");
  });
  it("keeps the same oil painting when reopening a note on another device", () => {
    expect(paintingForNote("test-note")).toEqual(paintingForNote("test-note"));
    expect(paintingForNote("test-note").source).toMatch(/^https:\/\/www\.metmuseum\.org\//);
  });
});
