import { describe, expect, it } from "vitest";
import { composeSpeechInput, type SpeechResultLike } from "../src/lib/speech-input";

function results(...items: Array<[string, boolean]>) {
  return items.map(([transcript, isFinal]) => ({ 0: { transcript }, isFinal })) as ArrayLike<SpeechResultLike>;
}

describe("composeSpeechInput", () => {
  it("does not duplicate a phrase when interim recognition becomes final", () => {
    expect(composeSpeechInput("原来的文字", results(["今天很开心", false]))).toBe("原来的文字 今天很开心");
    expect(composeSpeechInput("原来的文字", results(["今天很开心", true]))).toBe("原来的文字 今天很开心");
  });

  it("keeps final and current interim phrases in their original order", () => {
    expect(composeSpeechInput("", results(["先说第一句", true], ["再说第二句", false]))).toBe("先说第一句 再说第二句");
  });
});
