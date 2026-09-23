// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TearTicket from "../src/components/tear-ticket";
import { orderTicketsByProgress, PendingTickets } from "../src/components/pending-tickets";
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

describe("待办票据", () => {
  it("待开始自动排在进行中之前，同一状态保留原有顺序", () => {
    const [first, second, third] = createExamples();
    const activeFirst = { ...first, tags: taskTags(first, "start") };
    const activeThird = { ...third, tags: taskTags(third, "start") };
    expect(orderTicketsByProgress([activeFirst, second, activeThird], "departure").map(note => note.id)).toEqual([
      second.id, activeFirst.id, activeThird.id,
    ]);
    expect(orderTicketsByProgress([activeFirst, second, activeThird], "arrival").map(note => note.id)).toEqual([
      activeFirst.id, second.id, activeThird.id,
    ]);
  });

  it("开始事项需等待保存确认，连点不重复提交，也不生成图片", async () => {
    const note = createExamples()[0];
    const before = structuredClone(note);
    let finish!: () => void;
    const onTransition = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const onOpen = vi.fn();
    render(<PendingTickets notes={[note]} kind="departure" preview paused onOpen={onOpen} onTransition={onTransition} />);
    fireEvent.keyDown(screen.getByRole("button", { name: `拖动票根，开始并打开：${note.title}` }), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: `开始并打开：${note.title}` }));
    expect(onTransition).toHaveBeenCalledExactlyOnceWith(note, "start");
    expect(onOpen).not.toHaveBeenCalled();
    expect(note).toEqual(before);
    expect(screen.queryByText("图片待生成")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("article").getAttribute("aria-busy")).toBe("true");
    await act(async () => finish());
    expect(screen.getByRole("article").getAttribute("aria-busy")).toBe("false");
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(note);
  });

  it("保存失败保留待办状态，恢复可重试的票根并明确显示失败", async () => {
    const note = createExamples()[0];
    const onTransition = vi.fn().mockRejectedValue(new Error("网络中断，尚未保存"));
    render(<PendingTickets notes={[note]} kind="departure" preview={false} paused onOpen={vi.fn()} onTransition={onTransition} />);
    fireEvent.keyDown(screen.getByRole("button", { name: `拖动票根，开始并打开：${note.title}` }), { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toContain("尚未保存");
    fireEvent.click(screen.getByRole("button", { name: `开始并打开：${note.title}` }));
    await waitFor(() => expect(onTransition).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("已完成")).toBeNull();
  });

  it("进行中的事项只打开内容，明确点击完成才更新状态", async () => {
    const original = createExamples()[0];
    const note = { ...original, tags: taskTags(original, "start") };
    const onTransition = vi.fn().mockResolvedValue(undefined);
    const onOpen = vi.fn();
    render(<PendingTickets notes={[note]} kind="departure" preview paused onOpen={onOpen} onTransition={onTransition} />);
    fireEvent.click(screen.getByRole("button", { name: `打开记录：${note.title}` }));
    expect(onOpen).toHaveBeenCalledWith(note);
    expect(onTransition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `标记完成：${note.title}` }));
    await waitFor(() => expect(onTransition).toHaveBeenCalledExactlyOnceWith(note, "complete"));
  });

  it("已完成事项可回看但不会自动重启，重新列入需要主动选择", async () => {
    const original = createExamples()[0];
    const active = { ...original, tags: taskTags(original, "start") };
    const note = { ...active, tags: taskTags(active, "complete") };
    const onTransition = vi.fn().mockResolvedValue(undefined);
    const onOpen = vi.fn();
    render(<PendingTickets notes={[note]} kind="arrival" preview paused onOpen={onOpen} onTransition={onTransition} />);
    fireEvent.keyDown(screen.getByRole("button", { name: `拖动票根，回看记录：${note.title}` }), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(note);
    expect(onTransition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `重新列入待办：${note.title}` }));
    await waitFor(() => expect(onTransition).toHaveBeenCalledExactlyOnceWith(note, "reopen"));
  });

  it("详情页有未保存修改时不能推进事项，失败不会变成已完成", async () => {
    const original = createExamples()[0];
    const note = { ...original, tags: taskTags(original, "start") };
    const onTransition = vi.fn().mockRejectedValue(new Error("云端未确认"));
    const view = render(<TaskJourneyBar note={note} onTransition={onTransition} blockedReason="先保存修改" />);
    fireEvent.click(screen.getByRole("button", { name: "标记完成" }));
    expect(onTransition).not.toHaveBeenCalled();
    view.rerender(<TaskJourneyBar note={note} onTransition={onTransition} />);
    fireEvent.click(screen.getByRole("button", { name: "标记完成" }));
    expect((await screen.findByRole("alert")).textContent).toContain("云端未确认");
    expect(screen.getByText("进行中")).toBeTruthy();
  });
});
