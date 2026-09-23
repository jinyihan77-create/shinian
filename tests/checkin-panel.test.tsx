// @vitest-environment jsdom
// Real panel interaction with a mocked network and static artwork. This does not
// exercise a deployed account, database or WebGL renderer.
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckinPanel } from "../src/components/checkin-panel";
import type { CheckinSummary } from "../src/lib/checkin";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
// Exercise the real stage transition and persistence guards separately from
// the curtain's pointer animation and rendering, which are checked in-browser.
vi.mock("../src/components/star-curtain", () => ({
  StarCurtain: ({ onPick }: { onPick: (index: number) => void }) =>
    <button aria-label="摘下第 1 颗星星" onClick={() => onPick(0)}>摘星</button>,
}));
vi.mock("../src/lib/checkin-art", () => ({
  CHECKIN_ART_THEMES: Array.from({ length: 4 }, (_, i) => ({ name: `测试材质${i}` })),
  createCheckinArtwork: () => ({ frontImage: "data:image/png;base64,AA==", backImage: "data:image/png;base64,AA==" }),
}));

const fetchMock = vi.fn<typeof fetch>();
const base: CheckinSummary = { today: "2026-09-21", totalDays: 3, currentStreak: 2, entry: null };
const saved: CheckinSummary = { ...base, totalDays: 4, currentStreak: 3,
  entry: { day: base.today, mood: "好奇", quote: "留住今天的一点光。", createdAt: "2026-09-21T01:00:00.000Z" } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const mood = () => screen.getByRole("textbox", { name: "此刻的心情" }) as HTMLInputElement;
const quote = () => screen.getByRole("textbox", { name: /挂在牌上的一句话/ }) as HTMLTextAreaElement;
const stats = () => document.querySelector('[aria-live="polite"]')!.textContent;
const syncStatus = () => screen.getByRole("status", { name: "星笺同步状态" });
const pickStar = () => fireEvent.click(screen.getByRole("button", { name: "摘下第 1 颗星星" }));
function openCard() {
  fireEvent.click(screen.getByRole("button", { name: "打开星空打卡牌" }));
  pickStar();
}
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

beforeEach(() => {
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("React", React);
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const [name, descriptor] of [["showModal", originalShowModal], ["close", originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

async function openReal() {
  fetchMock.mockResolvedValueOnce(json(base));
  render(<CheckinPanel userId="owner-1" />);
  openCard();
  await waitFor(() => expect(syncStatus().textContent).toContain("正在把这颗星"));
  fireEvent.change(mood(), { target: { value: "好奇" } });
  fireEvent.change(quote(), { target: { value: "留住今天的一点光。" } });
}

describe("check-in panel confirmed-save behavior", () => {
  it("reveals the generated card before the automatic save changes any counts", async () => {
    fetchMock.mockResolvedValueOnce(json(base));
    render(<CheckinPanel userId="owner-1" />);
    fireEvent.click(screen.getByRole("button", { name: "打开星空打卡牌" }));
    expect(screen.getByRole("dialog", { name: "给今天，摘一颗星" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "摘下第 1 颗星星" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "此刻的心情" })).toBeNull();
    pickStar();
    await waitFor(() => expect(syncStatus().textContent).toContain("正在把这颗星"));
    expect(stats()).toContain("累计 3 天");
    expect(stats()).toContain("连续 2 天");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
    expect(syncStatus().textContent).toContain("正在把这颗星");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: /给今天，\s*留一颗星。/ }));
  });

  it("saves once automatically after a star is picked", async () => {
    fetchMock.mockResolvedValueOnce(json(base)).mockResolvedValueOnce(json(saved));
    render(<CheckinPanel userId="owner-1" />);
    openCard();

    await waitFor(() => expect(syncStatus().textContent).toContain("已留在今天"), { timeout: 3000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
    expect(stats()).toContain("累计 4 天");
  });

  it("keeps the unsaved mood, quote and counts when choosing another star", async () => {
    await openReal();
    fireEvent.click(screen.getByRole("button", { name: "再摘一颗" }));
    expect(screen.queryByRole("textbox", { name: "此刻的心情" })).toBeNull();
    pickStar();
    expect(mood().value).toBe("好奇");
    expect(quote().value).toBe("留住今天的一点光。");
    expect(stats()).toContain("累计 3 天");
    expect(syncStatus().textContent).toContain("正在把这颗星");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("starts a new visit with star selection while retaining the unsaved draft", async () => {
    await openReal();
    fireEvent.click(screen.getByRole("button", { name: "关闭打卡牌" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fetchMock.mockResolvedValueOnce(json(base));
    fireEvent.click(screen.getByRole("button", { name: "打开星空打卡牌" }));
    expect(screen.getByRole("button", { name: "摘下第 1 颗星星" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "此刻的心情" })).toBeNull();
    pickStar();
    await waitFor(() => expect(syncStatus().textContent).toContain("正在把这颗星"));
    expect(mood().value).toBe("好奇");
    expect(quote().value).toBe("留住今天的一点光。");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });

  it("preview never calls the API and labels simulated counts as unsaved", async () => {
    render(<CheckinPanel preview />);
    openCard();
    expect(stats()).toContain("累计 0 天");
    await waitFor(() => expect(syncStatus().textContent).toContain("演示星笺"));
    expect(screen.getAllByText(/不会保存/).length).toBeGreaterThan(0);
    expect(screen.getByText("演示天数")).toBeTruthy();
    expect(stats()).toContain("累计 1 天");
    expect(screen.queryByRole("button", { name: "再摘一颗" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits for acknowledgment, blocks duplicate submits and uses returned counts", async () => {
    await openReal();
    let acknowledge!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise(resolve => { acknowledge = resolve; }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", credentials: "same-origin",
      headers: { "x-echo-user-id": "owner-1" } });
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toMatchObject({
      expectedDay: base.today, mood: "好奇", quote: "留住今天的一点光。",
      starVariant: 0, experienceVersion: 2, sourceNoteIds: [],
    });
    expect(stats()).toContain("累计 3 天");
    expect((screen.getByRole("button", { name: "再摘一颗" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "关闭打卡牌" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("今天的打卡已保存到你的私人账号。")).toBeNull();
    await act(async () => { acknowledge(json(saved)); });
    expect(syncStatus().textContent).toContain("已留在今天");
    expect(stats()).toContain("累计 4 天");
    expect(screen.getByText("今天的打卡已保存到你的私人账号。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "再摘一颗" })).toBeNull();
    expect(stats()).toContain("累计 4 天");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps text and unchanged counts after an unknown network result", async () => {
    await openReal(); fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("尚未确认打卡"));
    expect(mood().value).toBe("好奇"); expect(quote().value).toBe("留住今天的一点光。");
    expect(stats()).toContain("累计 3 天");
    expect(syncStatus().textContent).toContain("还没有同步");
    fetchMock.mockResolvedValueOnce(json(base)).mockResolvedValueOnce(json(saved));
    fireEvent.click(screen.getByRole("button", { name: "重新核对并同步" }));
    await waitFor(() => expect(syncStatus().textContent).toContain("已留在今天"), { timeout: 2500 });
    expect(quote().value).toBe("留住今天的一点光。");
  });

  it("refreshes the server date after 409 without submitting again or discarding text", async () => {
    await openReal();
    fetchMock.mockResolvedValueOnce(json({ error: "日期已经变化，请刷新后再试。", code: "DAY_CHANGED" }, 409))
      .mockResolvedValueOnce(json({ ...base, today: "2026-09-22" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(syncStatus().textContent).toContain("正在把这颗星"));
    expect(mood().value).toBe("好奇"); expect(quote().value).toBe("留住今天的一点光。");
    expect(screen.queryByText("今天的打卡已保存到你的私人账号。")).toBeNull();
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });

  it("does not turn a malformed successful HTTP response into a saved state", async () => {
    await openReal(); fetchMock.mockResolvedValueOnce(json({ ...base, totalDays: 4 }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("尚未确认有效"));
    expect(stats()).toContain("累计 3 天"); expect(quote().value).toBe("留住今天的一点光。");
    expect(syncStatus().textContent).toContain("还没有同步");
  });

  it("never reuses an old confirmed entry as today's success when a new read fails", async () => {
    fetchMock.mockResolvedValueOnce(json(saved));
    render(<CheckinPanel userId="owner-1" />);
    openCard();
    await waitFor(() => expect(syncStatus().textContent).toContain("已留在今天"));
    fireEvent.click(screen.getByRole("button", { name: "关闭打卡牌" }));
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    openCard();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("尚未确认打卡"));
    expect(syncStatus().textContent).not.toContain("已留在今天");
    expect(screen.queryByText("今天的心情已经收好。明天再挂上一句新的话。")).toBeNull();
    expect(quote().value).toBe("");
  });

  it("auto-saves a manual star-note edit with revision protection", async () => {
    const versioned = { ...saved, entry: { ...saved.entry!, revision: 1, updatedAt: "2026-09-21T01:00:00.000Z" } };
    const updated = { ...versioned, entry: { ...versioned.entry!, quote: "这是我手动留下的文字。", revision: 2, updatedAt: "2026-09-21T02:00:00.000Z" } };
    fetchMock.mockResolvedValueOnce(json(versioned)).mockResolvedValueOnce(json(updated));
    render(<CheckinPanel userId="owner-1" />);
    fireEvent.click(screen.getByRole("button", { name: "打开星空打卡牌" }));
    await waitFor(() => expect(syncStatus().textContent).toContain("已留在今天"));
    fireEvent.change(quote(), { target: { value: "这是我手动留下的文字。" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 2500 });
    expect(fetchMock.mock.calls[1][1]?.method).toBe("PATCH");
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({
      expectedDay: base.today, mood: "好奇", quote: "这是我手动留下的文字。", expectedRevision: 1,
    });
    expect(await screen.findByText("星笺调整已保存。")).toBeTruthy();
    expect(stats()).toContain("累计 4 天");
  });
});
