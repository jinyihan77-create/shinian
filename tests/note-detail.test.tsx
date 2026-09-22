// @vitest-environment jsdom
// Component interaction tests with a mocked repository boundary. These do not
// exercise a deployed database, real account, cross-device session or AI service.
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteDetail } from "../src/components/note-detail";
import { repository, RepositoryError } from "../src/lib/repository";
import { createExamples } from "../src/lib/examples";
import type { EchoNote } from "../src/lib/types";

vi.mock("../src/lib/repository", async importOriginal => {
  const original = await importOriginal<typeof import("../src/lib/repository")>();
  return { ...original, repository: { saveReflection: vi.fn(), remove: vi.fn(), updateMeta: vi.fn() } };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  // Vitest's TSX transform can use the classic React runtime; production uses
  // Next.js automatic JSX. Supply React in this isolated test environment only.
  vi.stubGlobal("React", React);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fixture() {
  const note: EchoNote = { ...createExamples()[2], reflectionText: "最初在云端保存的理解。", reflectionPrompt: "你会怎样解释？", storageVersion: 7 };
  const handlers = { onBack: vi.fn(), onUpdated: vi.fn<() => Promise<void>>().mockResolvedValue(undefined), onOrganize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined), onNotify: vi.fn() };
  const view = render(<NoteDetail note={note} {...handlers} />);
  const rerender = (updated: EchoNote) => view.rerender(<NoteDetail note={updated} {...handlers} />);
  const reflection = () => screen.getByRole("textbox", { name: "我自己的理解" }) as HTMLTextAreaElement;
  return { note, handlers, rerender, reflection };
}

describe("详情同步保护（模拟repository边界的实际组件交互）", () => {
  it("收藏传当前版本、保留标签，只有收到保存确认后才显示已收藏", async () => {
    const { note, handlers, rerender } = fixture();
    let acknowledge!: (note: EchoNote) => void;
    vi.mocked(repository.updateMeta).mockReturnValueOnce(new Promise(resolve => { acknowledge = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "收藏闪卡" }));
    expect(repository.updateMeta).toHaveBeenCalledWith(note.id, { title: note.title, tags: [...note.tags, "闪卡收藏"] }, 7);
    expect(screen.queryByRole("button", { name: "已收藏" })).toBeNull();
    const saved = { ...note, tags: [...note.tags, "闪卡收藏"], storageVersion: 8 };
    await act(async () => { acknowledge(saved); });
    expect(handlers.onUpdated).toHaveBeenCalledWith(saved);
    rerender(saved);
    expect(screen.getByRole("button", { name: "已收藏" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("收藏失败不会假报成功，尚未保存的理解也不能被误收藏", async () => {
    const { reflection, handlers } = fixture();
    fireEvent.change(reflection(), { target: { value: "第一句\n第二句\n第三句" } });
    expect((screen.getByRole("button", { name: "收藏闪卡" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "取消本次修改" }));
    vi.mocked(repository.updateMeta).mockRejectedValueOnce(new RepositoryError("暂时无法连接云端", "NETWORK_ERROR"));
    fireEvent.click(screen.getByRole("button", { name: "收藏闪卡" }));
    await waitFor(() => expect(handlers.onNotify).toHaveBeenCalledWith("暂时无法连接云端", "error"));
    expect(handlers.onUpdated).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "已收藏" })).toBeNull();
  });

  it("取消收藏只移除收藏标记，不删除笔记或理解", async () => {
    const { note, handlers, rerender } = fixture();
    rerender({ ...note, tags: [...note.tags, "闪卡收藏"], storageVersion: 8 });
    vi.mocked(repository.updateMeta).mockResolvedValueOnce({ ...note, storageVersion: 9 });
    fireEvent.click(screen.getByRole("button", { name: "已收藏" }));
    await waitFor(() => expect(handlers.onUpdated).toHaveBeenCalled());
    expect(repository.updateMeta).toHaveBeenCalledWith(note.id, { title: note.title, tags: note.tags }, 8);
    expect(repository.remove).not.toHaveBeenCalled();
    expect(repository.saveReflection).not.toHaveBeenCalled();
  });

  it("没有输入时显示他端同步的新理解，并且不会误报未保存修改", () => {
    const { note, rerender, reflection } = fixture();
    rerender({ ...note, reflectionText: "手机上更新的理解。", reflectionPrompt: "手机上选择的问题？", storageVersion: 8 });
    expect(reflection().value).toBe("手机上更新的理解。");
    expect(screen.getByText("手机上选择的问题？")).toBeTruthy();
    expect(screen.queryByText("有尚未保存的修改")).toBeNull();
    expect((screen.getByRole("button", { name: "保存我的理解" }) as HTMLButtonElement).disabled).toBe(true);
    const navigation = new CustomEvent("echo:before-navigate", { cancelable: true, detail: { proceed: vi.fn() } });
    act(() => { window.dispatchEvent(navigation); });
    expect(navigation.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("首次输入后同步保留本地文字，保存传首次输入版本并只交付repository确认结果", async () => {
    const { note, rerender, reflection, handlers } = fixture();
    fireEvent.change(reflection(), { target: { value: "尚未保存的个人解释。" } });
    rerender({ ...note, reflectionText: "另一设备的新理解。", reflectionPrompt: "远端新问题？", storageVersion: 10 });
    expect(reflection().value).toBe("尚未保存的个人解释。");
    expect(screen.getByText(note.reflectionPrompt)).toBeTruthy();
    const navigation = new CustomEvent("echo:before-navigate", { cancelable: true, detail: { proceed: vi.fn() } });
    act(() => { window.dispatchEvent(navigation); });
    expect(navigation.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog", { name: "还有修改没有保存" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    const acknowledged = { ...note, reflectionText: "尚未保存的个人解释。", storageVersion: 11 };
    vi.mocked(repository.saveReflection).mockResolvedValueOnce(acknowledged);
    fireEvent.click(screen.getByRole("button", { name: "保存我的理解" }));
    await waitFor(() => expect(handlers.onUpdated).toHaveBeenCalledWith(acknowledged));
    expect(repository.saveReflection).toHaveBeenCalledWith(note.id, "尚未保存的个人解释。", note.reflectionPrompt, 7);
  });

  it("409冲突保留输入并提供复制与重开说明，取消修改后才显示最新云端内容", async () => {
    const { note, rerender, reflection, handlers } = fixture();
    fireEvent.change(reflection(), { target: { value: "冲突时也不能丢的想法。" } });
    rerender({ ...note, reflectionText: "远端最新理解。", storageVersion: 8 });
    vi.mocked(repository.saveReflection).mockRejectedValueOnce(new RepositoryError("其他设备已更新。", "CONFLICT", 409));
    fireEvent.click(screen.getByRole("button", { name: "保存我的理解" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("请先复制"));
    expect(reflection().value).toBe("冲突时也不能丢的想法。");
    expect(repository.saveReflection).toHaveBeenCalledWith(note.id, "冲突时也不能丢的想法。", note.reflectionPrompt, 7);
    expect(handlers.onUpdated).not.toHaveBeenCalled();
    expect(handlers.onNotify).toHaveBeenCalledWith(expect.stringContaining("当前输入仍保留"), "error");
    fireEvent.click(screen.getByRole("button", { name: "取消本次修改" }));
    expect(reflection().value).toBe("远端最新理解。");
    expect(screen.queryByText("有尚未保存的修改")).toBeNull();
  });

  it("删除使用打开确认时的版本，期间他端更新导致409且不宣告删除成功", async () => {
    const { note, rerender, handlers } = fixture();
    fireEvent.click(screen.getByRole("button", { name: "删除这条记录" }));
    rerender({ ...note, title: "他端刚改的标题", storageVersion: 9 });
    vi.mocked(repository.remove).mockRejectedValueOnce(new RepositoryError("其他设备已更新。", "CONFLICT", 409));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("尚未删除"));
    expect(repository.remove).toHaveBeenCalledWith(note.id, 7);
    expect(handlers.onUpdated).not.toHaveBeenCalled();
    expect(handlers.onBack).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保留记录" })).toBeTruthy();
    expect(handlers.onNotify).not.toHaveBeenCalledWith("记录已删除。");
  });
});
