// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FlipCard from "../src/components/flip-card";

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, options: PointerEventInit = {}) {
    super(type, options);
    this.pointerId = options.pointerId ?? 1;
    this.pointerType = options.pointerType ?? "mouse";
  }
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("oil painting flip interaction", () => {
  it("a fast drag turns only one face and pointer cancellation returns to the starting face", () => {
    const changed = vi.fn();
    render(<FlipCard front="Oil painting" back="My thoughts" onFlipChange={changed} />);
    const card = screen.getByRole("button", { name: "Flip card" });
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue({ width: 340, height: 440, left: 0, top: 0 } as DOMRect);
    fireEvent.pointerDown(card, { pointerId: 1, button: 0, clientX: 10 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 110 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 320 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 320 });
    expect(changed).toHaveBeenCalledWith(true);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(card, { key: "Enter" });
    expect(card.getAttribute("aria-pressed")).toBe("false");
    changed.mockClear();
    fireEvent.pointerDown(card, { pointerId: 2, button: 0, clientX: 10, pointerType: "touch" });
    fireEvent.pointerMove(card, { pointerId: 2, clientX: 100, pointerType: "touch" });
    fireEvent.pointerCancel(card, { pointerId: 2, clientX: 100, pointerType: "touch" });
    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(changed).not.toHaveBeenCalled();
  });
});
