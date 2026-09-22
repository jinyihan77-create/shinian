// @vitest-environment jsdom
// Gesture and lifecycle checks only; the browser verifies the visual spring motion.
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StarCurtain } from "../src/components/star-curtain";

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

let frameId = 0;
let now = 100;
const frames = new Map<number, FrameRequestCallback>();
const requestFrame = vi.fn((callback: FrameRequestCallback) => {
  frames.set(++frameId, callback);
  return frameId;
});
const cancelFrame = vi.fn((id: number) => { frames.delete(id); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  frameId = 0; now = 100; frames.clear(); requestFrame.mockClear(); cancelFrame.mockClear();
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); frames.clear();
});

function star(index = 4) {
  const button = screen.getByRole("button", { name: `摘下第 ${index} 颗星星` }) as HTMLButtonElement;
  const captured = new Set<number>();
  Object.defineProperties(button, {
    setPointerCapture: { configurable: true, value: (id: number) => captured.add(id) },
    hasPointerCapture: { configurable: true, value: (id: number) => captured.has(id) },
    releasePointerCapture: { configurable: true, value: (id: number) => captured.delete(id) },
  });
  return button;
}

const down = (button: HTMLButtonElement, pointerId = 1) => fireEvent.pointerDown(button, { pointerId, button: 0, clientX: 100, clientY: 100 });
const move = (button: HTMLButtonElement, dy: number, pointerId = 1) => fireEvent.pointerMove(button, { pointerId, clientX: 100, clientY: 100 + dy });
const release = (button: HTMLButtonElement, dy: number, pointerId = 1) => fireEvent.pointerUp(button, { pointerId, clientX: 100, clientY: 100 + dy });
const finish = () => act(() => { now += 1000; vi.advanceTimersByTime(1000); });
function drawFrame() {
  const pending = [...frames.values()]; frames.clear(); now += 16;
  act(() => { for (const callback of pending) callback(now); });
}

describe("star curtain selection gestures", () => {
  it("returns a partial pull without selecting even when the browser emits a click", () => {
    const picked = vi.fn(); render(<StarCurtain theme={17} onPick={picked} />);
    const button = star(); down(button); move(button, 71);
    expect(screen.getByText("再向下一点，接住这束微光。")).toBeTruthy();
    release(button, 71); fireEvent.click(button, { detail: 1 }); finish();
    expect(picked).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    expect(screen.getByText("往下轻轻一拉，把喜欢的光带走。")).toBeTruthy();
  });

  it("selects exactly once on a 72-pixel downward release, after the landing transition", () => {
    const picked = vi.fn(); render(<StarCurtain theme={17} onPick={picked} />);
    const button = star(); down(button); move(button, 72);
    expect(screen.getByText("松开手，这颗星就属于你了。")).toBeTruthy();
    expect(picked).not.toHaveBeenCalled();
    release(button, 72); fireEvent.click(button, { detail: 1 });
    expect(picked).not.toHaveBeenCalled();
    finish(); expect(picked).toHaveBeenCalledExactlyOnceWith(3);
  });

  it.each(["pointerCancel", "lostPointerCapture"] as const)("never selects when a long pull ends in %s", (event) => {
    const picked = vi.fn(); render(<StarCurtain theme={17} onPick={picked} />);
    const button = star(); down(button); move(button, 110);
    fireEvent[event](button, { pointerId: 1, clientX: 100, clientY: 210 });
    release(button, 110); fireEvent.click(button, { detail: 1 }); finish();
    expect(picked).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });

  it("ignores a different pointer's release while preserving the initiating pull", () => {
    const picked = vi.fn(); render(<StarCurtain theme={17} onPick={picked} />);
    const button = star(); down(button, 4); move(button, 90, 4);
    release(button, 90, 5); finish();
    expect(picked).not.toHaveBeenCalled();
    release(button, 90, 4); finish();
    expect(picked).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("does not pick when the window loses focus during a long pull", () => {
    const picked = vi.fn(); render(<StarCurtain theme={17} onPick={picked} />);
    const button = star(); down(button); move(button, 110);
    fireEvent.blur(window);
    release(button, 110); fireEvent.click(button, { detail: 1 }); finish();
    expect(picked).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });

  it("stops drawing when hidden and cancels the active pull before returning", () => {
    const picked = vi.fn(); render(<StarCurtain theme={17} onPick={picked} />);
    const button = star(); down(button); move(button, 110);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    hidden.mockReturnValue(false); fireEvent(document, new Event("visibilitychange"));
    expect(frames.size).toBe(1);
    release(button, 110); fireEvent.click(button, { detail: 1 }); finish();
    expect(picked).not.toHaveBeenCalled();
  });

  it("supports native keyboard activation and blocks a second selection", () => {
    const picked = vi.fn(); render(<StarCurtain theme={17} onPick={picked} />);
    const button = star(); const other = star(2);
    button.focus(); fireEvent.click(button, { detail: 0 }); fireEvent.click(other, { detail: 0 });
    expect(button.disabled).toBe(true); expect(other.disabled).toBe(true);
    finish(); expect(picked).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("supports a small stationary touch tap without a duplicate synthetic click", () => {
    const picked = vi.fn(); render(<StarCurtain theme={17} onPick={picked} />);
    const button = star(2); down(button); release(button, 3); fireEvent.click(button, { detail: 1 });
    finish(); expect(picked).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("delivers reduced-motion selection immediately without waiting for a landing animation", () => {
    const picked = vi.fn(); render(<StarCurtain theme={17} onPick={picked} reduceMotion />);
    fireEvent.click(star(2), { detail: 0 });
    expect(picked).toHaveBeenCalledExactlyOnceWith(1);
    finish(); expect(picked).toHaveBeenCalledTimes(1);
  });

  it("draws reduced-motion cords once, then only redraws in response to input", () => {
    render(<StarCurtain theme={17} onPick={vi.fn()} reduceMotion />);
    const button = star();
    expect(frames.size).toBe(1); drawFrame(); expect(frames.size).toBe(0);
    down(button); move(button, 40);
    expect(frames.size).toBe(1); drawFrame(); expect(frames.size).toBe(0);
    release(button, 40);
    expect(frames.size).toBe(1); drawFrame(); expect(frames.size).toBe(0);
  });

  it("cancels pending selection and animation when the curtain unmounts", () => {
    const picked = vi.fn(); const view = render(<StarCurtain theme={17} onPick={picked} />);
    fireEvent.click(star(), { detail: 0 }); view.unmount(); finish();
    expect(picked).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("prevents selection while paused and stops its animation loop", () => {
    const picked = vi.fn(); const view = render(<StarCurtain theme={17} onPick={picked} />);
    expect(frames.size).toBe(1);
    view.rerender(<StarCurtain theme={17} onPick={picked} paused />);
    const button = star(); expect(button.disabled).toBe(true);
    expect(frames.size).toBe(1); drawFrame();
    fireEvent.click(button, { detail: 0 }); finish();
    expect(picked).not.toHaveBeenCalled(); expect(frames.size).toBe(0);
  });
});
