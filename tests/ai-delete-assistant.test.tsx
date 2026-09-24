// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiDeleteAssistant } from "../src/components/ai-delete-assistant";
import { createExamples } from "../src/lib/examples";

beforeEach(() => { vi.stubGlobal("React", React); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.style.overflow = ""; });

describe("AI 批量清理", () => {
  it("先展示逐条候选，允许取消选择，明确确认后才删除", async () => {
    const notes = createExamples().slice(0, 2).map((note, index) => ({ ...note, storageVersion: index + 1 }));
    const onPlan = vi.fn().mockResolvedValue({
      interpretation: "清理与行动门槛有关的记录。",
      matches: notes.map(note => ({ id: note.id, reason: "标题或正文符合这个主题。" })),
    });
    const onDelete = vi.fn().mockImplementation(async selected => ({ deletedIds: selected.map((note: { id: string }) => note.id), failed: [] }));
    render(<AiDeleteAssistant notes={notes} onPlan={onPlan} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole("button", { name: "AI 清理" }));
    fireEvent.change(screen.getByLabelText("说一句自然的话就好"), { target: { value: "删掉关于行动门槛的记录" } });
    fireEvent.click(screen.getByRole("button", { name: "开始清理" }));
    await screen.findByText("清理与行动门槛有关的记录。");
    expect(onDelete).not.toHaveBeenCalled();

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: "确认删除 1 条" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
    expect(onDelete.mock.calls[0][0]).toEqual([notes[0]]);
    expect(await screen.findByText("已从回声屿删除 1 条记录。")).toBeTruthy();
  });

  it("预览只演示流程，不调用 AI 或删除回调", async () => {
    const notes = createExamples().slice(0, 2);
    const onPlan = vi.fn();
    const onDelete = vi.fn();
    render(<AiDeleteAssistant notes={notes} preview onPlan={onPlan} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "AI 清理" }));
    fireEvent.change(screen.getByLabelText("说一句自然的话就好"), { target: { value: "删掉播客记录" } });
    fireEvent.click(screen.getByRole("button", { name: "开始清理" }));
    expect(await screen.findByText(/界面预览只演示核对流程/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /演示确认/ }));
    expect(await screen.findByText(/没有调用 AI，也没有删除资料/)).toBeTruthy();
    expect(onPlan).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
