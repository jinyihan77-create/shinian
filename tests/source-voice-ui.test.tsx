// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureComposer } from "../src/components/studio-ui";
import { emptyCapture, type SourceIntakeResult } from "../src/lib/types";

class MockSpeechRecognition {
  static current: MockSpeechRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: never) => void) | null = null;
  onerror: ((event: never) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() { MockSpeechRecognition.current = this; }
  start() {}
  stop() { this.onend?.(); }
  say(transcript: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript } }] } as never);
  }
}

function composer(preview = false, onOrganizeSource = vi.fn<(_transcript: string) => Promise<SourceIntakeResult>>()) {
  const onChange = vi.fn();
  render(<CaptureComposer capture={emptyCapture()} onChange={onChange} sourceOpen onSourceToggle={() => {}} saving={false} draftState="idle" onSave={() => {}} onOrganizeSource={onOrganizeSource} preview={preview} />);
  return { onChange, onOrganizeSource };
}

afterEach(() => {
  cleanup();
  MockSpeechRecognition.current = null;
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
});

describe("来源语音入口", () => {
  it("主记录使用卡片内的Siri式语音底座，不再渲染悬浮录音气泡", () => {
    window.SpeechRecognition = MockSpeechRecognition as never;
    composer(true);
    expect(document.querySelector(".voice-siri-dock")).toBeTruthy();
    expect(document.querySelector(".voice-strands")).toBeTruthy();
    expect(document.querySelector(".voice-live")).toBeNull();
    expect(screen.getByRole("button", { name: "开始口述记录" })).toBeTruthy();
  });

  it("说完后只调用一次AI，并把返回的来源字段一次填入", async () => {
    window.SpeechRecognition = MockSpeechRecognition as never;
    const result: SourceIntakeResult = { sourceType: "播客", sourceName: "得意忘形", sourceTimestamp: "18:20", sourceExcerpt: "不要急着给答案。" };
    const organize = vi.fn().mockResolvedValue(result);
    const { onChange } = composer(false, organize);
    fireEvent.click(screen.getByRole("button", { name: /告诉 AI 来源/ }));
    MockSpeechRecognition.current?.say("这是播客得意忘形，十八分二十秒，原话是不要急着给答案。");
    fireEvent.click(screen.getByRole("button", { name: /说完了/ }));
    await waitFor(() => expect(organize).toHaveBeenCalledOnce());
    expect(organize).toHaveBeenCalledWith("这是播客得意忘形，十八分二十秒，原话是不要急着给答案。");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(result));
    expect(await screen.findByText("已填好类型、名称、时间点、原话，可以直接记下。")).toBeTruthy();
  });

  it("界面预览可以接收语音，但不调用AI也不声称已填写", async () => {
    window.SpeechRecognition = MockSpeechRecognition as never;
    const organize = vi.fn();
    const { onChange } = composer(true, organize);
    fireEvent.click(screen.getByRole("button", { name: /告诉 AI 来源/ }));
    MockSpeechRecognition.current?.say("这是一本书。 ");
    fireEvent.click(screen.getByRole("button", { name: /说完了/ }));
    expect(await screen.findByText("预览已收到语音；正式入口才会调用 AI 并填写来源。")).toBeTruthy();
    expect(organize).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
