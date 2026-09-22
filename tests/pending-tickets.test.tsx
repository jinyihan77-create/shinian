// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TearTicket from "../src/components/tear-ticket";
import { PendingTickets } from "../src/components/pending-tickets";
import { createExamples } from "../src/lib/examples";
import { taskTags } from "../src/lib/task-tickets";
import { TaskJourneyBar } from "../src/components/task-journey-bar";

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("撕票行为", () => {
  it("键盘撕票只触发一次，受控恢复后可再次使用", () => {
    const onTear = vi.fn();
    const view = render(<TearTicket onTear={onTear} torn={false} />);
    const stub = screen.getByRole("button", { name: "撕开票根" });
    fireEvent.keyDown(stub, { key: "Enter" });
    fireEvent.keyDown(stub, { key: "Enter", repeat: true });
    fireEvent.keyDown(stub, { key: " " });
    expect(onTear).toHaveBeenCalledTimes(1);
    view.rerender(<TearTicket onTear={onTear} torn />);
    expect(screen.queryByRole("button", { name: "撕开票根" })).toBeNull();
    view.rerender(<TearTicket onTear={onTear} torn={false} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "撕开票根" }), { key: " " });
    expect(onTear).toHaveBeenCalledTimes(2);
  });

  it("禁用票根不会通过键盘激活", () => {
    const onTear = vi.fn();
    render(<TearTicket disabled onTear={onTear} />);
    const stub = screen.getByRole("button", { name: "撕开票根" });
    fireEvent.keyDown(stub, { key: "Enter" });
    expect(onTear).not.toHaveBeenCalled();
    expect(stub.tabIndex).toBe(-1);
  });

  it("取消拖动不会进入任务，且可以重新撕开", () => {
    vi.useFakeTimers();
    const onTear = vi.fn();
    render(<TearTicket onTear={onTear} />);
    const stub = screen.getByRole("button", { name: "撕开票根" });
    // PointerEvent is not implemented in jsdom: define its public event fields.
    function pointer(type: string, x: number, y: number) {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, { pointerId: { value: 1 }, button: { value: 0 }, clientX: { value: x }, clientY: { value: y } });
      fireEvent(stub, event);
    }
    pointer("pointerdown", 430, 30);
    pointer("pointermove", 620, 180);
    act(() => { vi.advanceTimersByTime(500); });
    pointer("pointercancel", 620, 180);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onTear).not.toHaveBeenCalled();
    fireEvent.keyDown(stub, { key: "Enter" });
    expect(onTear).toHaveBeenCalledTimes(1);
  });
});

describe("启程和终点票", () => {
  it("撕开启程需等待保存确认，连点不重复提交，也不生成图片", async () => {
    const note = createExamples()[0];
    const before = structuredClone(note);
    let finish!: () => void;
    const onTransition = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const onOpen = vi.fn();
    render(<PendingTickets notes={[note]} kind="departure" preview paused onOpen={onOpen} onTransition={onTransition} />);
    fireEvent.keyDown(screen.getByRole("button", { name: `撕开票根，启程 · 开始做：${note.title}` }), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: `启程 · 开始做：${note.title}` }));
    expect(onTransition).toHaveBeenCalledExactlyOnceWith(note, "start");
    expect(onOpen).not.toHaveBeenCalled();
    expect(note).toEqual(before);
    expect(screen.queryByText("图片待生成")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("article").getAttribute("aria-busy")).toBe("true");
    await act(async () => finish());
    expect(screen.getByRole("article").getAttribute("aria-busy")).toBe("false");
  });

  it("保存失败保留启程票，恢复可重试的票根并明确显示失败", async () => {
    const note = createExamples()[0];
    const onTransition = vi.fn().mockRejectedValue(new Error("网络中断，尚未保存"));
    render(<PendingTickets notes={[note]} kind="departure" preview={false} paused onOpen={vi.fn()} onTransition={onTransition} />);
    fireEvent.keyDown(screen.getByRole("button", { name: `撕开票根，启程 · 开始做：${note.title}` }), { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toContain("尚未保存");
    fireEvent.click(screen.getByRole("button", { name: `启程 · 开始做：${note.title}` }));
    await waitFor(() => expect(onTransition).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("已完成")).toBeNull();
  });

  it("继续事项只打开内容，明确点击完成才申请终点票", async () => {
    const original = createExamples()[0];
    const note = { ...original, tags: taskTags(original, "start") };
    const onTransition = vi.fn().mockResolvedValue(undefined);
    const onOpen = vi.fn();
    render(<PendingTickets notes={[note]} kind="departure" preview paused onOpen={onOpen} onTransition={onTransition} />);
    fireEvent.click(screen.getByRole("button", { name: `继续这件事：${note.title}` }));
    expect(onOpen).toHaveBeenCalledWith(note);
    expect(onTransition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `完成，收下终点票：${note.title}` }));
    await waitFor(() => expect(onTransition).toHaveBeenCalledExactlyOnceWith(note, "complete"));
  });

  it("终点票可回看但不会自动重启，重新启程需要主动选择", async () => {
    const original = createExamples()[0];
    const active = { ...original, tags: taskTags(original, "start") };
    const note = { ...active, tags: taskTags(active, "complete") };
    const onTransition = vi.fn().mockResolvedValue(undefined);
    const onOpen = vi.fn();
    render(<PendingTickets notes={[note]} kind="arrival" preview paused onOpen={onOpen} onTransition={onTransition} />);
    fireEvent.keyDown(screen.getByRole("button", { name: `撕开票根，回看事项：${note.title}` }), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(note);
    expect(onTransition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `重新启程：${note.title}` }));
    await waitFor(() => expect(onTransition).toHaveBeenCalledExactlyOnceWith(note, "reopen"));
  });

  it("详情页有未保存修改时不能推进事项，失败不会变成终点票", async () => {
    const original = createExamples()[0];
    const note = { ...original, tags: taskTags(original, "start") };
    const onTransition = vi.fn().mockRejectedValue(new Error("云端未确认"));
    const view = render(<TaskJourneyBar note={note} onTransition={onTransition} blockedReason="先保存修改" />);
    fireEvent.click(screen.getByRole("button", { name: "完成，收下终点票" }));
    expect(onTransition).not.toHaveBeenCalled();
    view.rerender(<TaskJourneyBar note={note} onTransition={onTransition} />);
    fireEvent.click(screen.getByRole("button", { name: "完成，收下终点票" }));
    expect((await screen.findByRole("alert")).textContent).toContain("云端未确认");
    expect(screen.getByText("启程票 · 进行中")).toBeTruthy();
  });
});
