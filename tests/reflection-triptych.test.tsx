// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReflectionTriptych } from "../src/components/reflection-triptych";

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
  say(transcript: string) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript } }] } as never); }
}

const questions = ["你听懂了什么？", "它为什么触动你？", "你想先做哪一步？"] as const;

beforeEach(() => { vi.stubGlobal("React", React); });
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); MockSpeechRecognition.current = null;
  delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
});

describe("三段式理解输入", () => {
  it("每栏显示独立问题，回车后进入下一栏", async () => {
    const onChange = vi.fn();
    render(<ReflectionTriptych idPrefix="test" value="第一句\n第二句\n第三句" questions={questions} onChange={onChange} />);
    expect(screen.getByText(questions[0])).toBeTruthy();
    expect(screen.getByText(questions[1])).toBeTruthy();
    expect(screen.getByText(questions[2])).toBeTruthy();
    const first = screen.getByRole("textbox", { name: "我自己的理解" });
    const second = screen.getByRole("textbox", { name: "我的理解第 2 句" });
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(second));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("识别到换行时自动分配到后续栏，不再把三句塞进同一栏", async () => {
    const onChange = vi.fn();
    render(<ReflectionTriptych idPrefix="test" value="" questions={questions} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "我自己的理解" }), { target: { value: "第一句\n第二句\n第三句" } });
    expect(onChange).toHaveBeenLastCalledWith("第一句\n第二句\n第三句");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "我的理解第 3 句" })));
  });

  it("一段语音只写入一次，结束后自动聚焦下一栏", async () => {
    window.SpeechRecognition = MockSpeechRecognition as never;
    let value = "";
    const view = render(<ReflectionTriptych idPrefix="test" value={value} questions={questions} onChange={next => {
      value = next;
      view.rerender(<ReflectionTriptych idPrefix="test" value={value} questions={questions} onChange={() => {}} />);
    }} />);
    fireEvent.click(screen.getByRole("button", { name: "用语音回答第 1 个问题" }));
    MockSpeechRecognition.current?.say("这是我的理解");
    expect(value).toBe("这是我的理解");
    MockSpeechRecognition.current?.stop();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "我的理解第 2 句" })));
  });
});
