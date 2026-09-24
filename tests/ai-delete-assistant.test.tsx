// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiDeleteAssistant } from "../src/components/ai-delete-assistant";
import { createExamples } from "../src/lib/examples";

beforeEach(() => { vi.stubGlobal("React", React); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AI 批量清理", () => {
  it("只显示暂未实现状态，不打开清理流程或执行回调", () => {
    const notes = createExamples().slice(0, 2);
    const onPlan = vi.fn();
    const onDelete = vi.fn();
    render(<AiDeleteAssistant notes={notes} onPlan={onPlan} onDelete={onDelete} />);

    const button = screen.getByRole("button", { name: "AI 清理（暂未实现）" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);

    expect(screen.queryByText("告诉我，想清理哪些？")).toBe(null);
    expect(onPlan).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
