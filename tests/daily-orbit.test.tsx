// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyOrbit } from "../src/components/daily-orbit";

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function core() {
  const button = screen.getByRole("button", { name: "把今日星核带到身边" }) as HTMLButtonElement;
  const captured = new Set<number>();
  Object.defineProperties(button, {
    setPointerCapture: { configurable: true, value: (id: number) => captured.add(id) },
    hasPointerCapture: { configurable: true, value: (id: number) => captured.has(id) },
    releasePointerCapture: { configurable: true, value: (id: number) => captured.delete(id) },
  });
  return button;
}

describe("daily orbit core interaction", () => {
  it("renders traceable keywords and the Aries coordinate", () => {
    render(<DailyOrbit theme={2} keywords={["主动表达", "行动门槛"]} onClaim={vi.fn()} />);
    expect(screen.getByLabelText("白羊座私人坐标")).toBeTruthy();
    expect(screen.getByLabelText("今天的关键词").textContent).toContain("主动表达");
    expect(screen.getByLabelText("今天的关键词").textContent).toContain("行动门槛");
  });

  it("opens a real thought from a landmark on the rotating planet", () => {
    render(<DailyOrbit theme={2} keywords={["主动表达"]} thoughts={[{
      id: "thought-1", title: "先说三句话", excerpt: "听完内容后，先用自己的语言讲三句话。", source: "播客",
    }]} onClaim={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "回看念头：先说三句话" }));
    expect(screen.getByText("听完内容后，先用自己的语言讲三句话。")).toBeTruthy();
    expect(screen.getByText("播客")).toBeTruthy();
  });

  it("returns a short pull without claiming the core", () => {
    const onClaim = vi.fn();
    render(<DailyOrbit theme={2} keywords={[]} onClaim={onClaim} />);
    const button = core();
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 100, clientY: 173 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 100, clientY: 173 });
    act(() => vi.advanceTimersByTime(800));
    expect(onClaim).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });

  it("claims once after a deliberate pull or keyboard click", () => {
    const onClaim = vi.fn();
    render(<DailyOrbit theme={2} keywords={[]} onClaim={onClaim} />);
    const button = core();
    fireEvent.pointerDown(button, { pointerId: 2, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(button, { pointerId: 2, clientX: 100, clientY: 174 });
    expect(screen.getByText("松开手，把今天带回来")).toBeTruthy();
    fireEvent.pointerUp(button, { pointerId: 2, clientX: 100, clientY: 174 });
    fireEvent.click(button);
    act(() => vi.advanceTimersByTime(700));
    expect(onClaim).toHaveBeenCalledTimes(1);
  });

  it("claims immediately when reduced motion is requested", () => {
    const onClaim = vi.fn();
    render(<DailyOrbit theme={2} keywords={[]} onClaim={onClaim} reduceMotion />);
    fireEvent.click(core());
    expect(onClaim).toHaveBeenCalledTimes(1);
  });
});
