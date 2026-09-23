import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExamples } from "../src/lib/examples";
import { repository } from "../src/lib/repository";
import { taskTags, taskStatus } from "../src/lib/task-tickets";
import { emptyCapture, type CaptureInput, type EchoNote } from "../src/lib/types";
import { captureContextTags } from "../src/lib/note-context";

const fetchMock = vi.fn<typeof fetch>();
const input = { ...emptyCapture("书籍"), userText: "今天听完再用自己的话说一遍。" };
let account: string;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function remoteNote(id = crypto.randomUUID(), content: CaptureInput = input): EchoNote {
  return { ...createExamples()[0], ...content, id, isExample: false, storageVersion: 1 };
}

function submittedBody(index = 0): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[index][1]?.body as string) as Record<string, unknown>;
}

beforeEach(async () => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  account = crypto.randomUUID();
  repository.setUser(account);
  await repository.init();
});

afterEach(() => {
  repository.setUser(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("云端确认与私人账号隔离", () => {
  it("未登录或云端未配置时拒绝访问，不回退到旧本地资料或伪造空列表", async () => {
    repository.setUser(null);
    await expect(repository.init()).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    await expect(repository.list()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
    repository.setUser(account);
    fetchMock.mockResolvedValueOnce(json({ error: "云端资料库尚未配置。", code: "NOT_CONFIGURED" }, 503));
    await expect(repository.list()).rejects.toMatchObject({ code: "NOT_CONFIGURED", status: 503 });
  });

  it("各账号的草稿和偏好互不混用，网络请求携带当前账号用于服务端一致性检查", async () => {
    await repository.saveDraft(input);
    await repository.setPreference("sourceType", "书籍");
    const otherAccount = crypto.randomUUID();
    repository.setUser(otherAccount);
    await expect(repository.getDraft()).resolves.toBeNull();
    await expect(repository.getPreference("sourceType")).resolves.toBeNull();
    await repository.saveDraft({ ...input, userText: "另一个账号的私人想法。" });
    fetchMock.mockResolvedValueOnce(json({ notes: [], nextCursor: null }));
    await repository.list();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store", headers: { "x-echo-user-id": otherAccount } });
    repository.setUser(account);
    await expect(repository.getDraft()).resolves.toEqual(input);
    await expect(repository.getPreference("sourceType")).resolves.toBe("书籍");
  });

  it("账号变化后拒绝旧请求响应，避免把前一账号记录放进新账号页面", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const pending = repository.list();
    repository.setUser(crypto.randomUUID());
    resolve(json({ notes: [remoteNote()], nextCursor: null }));
    await expect(pending).rejects.toMatchObject({ code: "SESSION_CHANGED" });
  });

  it("只有401通知页面重新登录，409保留编辑页面和草稿", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    const note = remoteNote();
    await repository.saveDraft(input);
    fetchMock.mockResolvedValueOnce(json({ error: "其他设备已经修改。", code: "CONFLICT" }, 409));
    await expect(repository.updateContent(note.id, input, 1)).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    expect(dispatchEvent).not.toHaveBeenCalled();
    await expect(repository.getDraft()).resolves.toEqual(input);
    fetchMock.mockResolvedValueOnce(json({ code: "AUTH_REQUIRED" }, 401));
    await expect(repository.list()).rejects.toMatchObject({ status: 401 });
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe("echo:session-expired");
  });

  it("来源语音只在登录后发送，并拒绝不完整的AI响应", async () => {
    const request = { transcript: "这是播客随机波动，十二分，原话是先观察自己的感受。", currentSourceType: "播客" as const };
    const source = { sourceType: "播客" as const, sourceName: "随机波动", sourceTimestamp: "12:00", sourceExcerpt: "先观察自己的感受。" };
    fetchMock.mockResolvedValueOnce(json({ source }));
    await expect(repository.organizeSource(request)).resolves.toEqual(source);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/source-intake");
    expect(submittedBody()).toEqual(request);
    fetchMock.mockResolvedValueOnce(json({ source: { ...source, sourceName: "" } }));
    await expect(repository.organizeSource(request)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    repository.setUser(null);
    await expect(repository.organizeSource(request)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

describe("分页读取完整资料库", () => {
  const idAt = (index: number) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;

  it("顺序读取所有页，完成后按创建时间排列，并始终传递同一账号", async () => {
    const first = { ...remoteNote(idAt(1)), createdAt: "2026-09-20T00:00:00.000Z" };
    const second = { ...remoteNote(idAt(2)), createdAt: "2026-09-21T00:00:00.000Z" };
    const third = { ...remoteNote(idAt(3)), createdAt: "2026-09-19T00:00:00.000Z" };
    fetchMock.mockResolvedValueOnce(json({ notes: [first, second], nextCursor: second.id }))
      .mockResolvedValueOnce(json({ notes: [third], nextCursor: null }));
    await expect(repository.list()).resolves.toEqual([second, first, third]);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/notes", `/api/notes?cursor=${second.id}`]);
    for (const [, options] of fetchMock.mock.calls) expect(options?.headers).toMatchObject({ "x-echo-user-id": account });
  });

  it("中途断网拒绝整次读取，不返回部分资料，也不把部分页的新版本当作编辑依据", async () => {
    const note = remoteNote(idAt(1));
    fetchMock.mockResolvedValueOnce(json({ notes: [{ ...note, storageVersion: 2 }], nextCursor: note.id }))
      .mockRejectedValueOnce(new TypeError("offline"));
    await expect(repository.list()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    await expect(repository.saveReflection(note.id, "仍未覆盖的输入")).rejects.toMatchObject({ code: "VERSION_REQUIRED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("拒绝缺少完成标记、重复游标和超过单页数量的响应，防止静默截断或无限循环", async () => {
    const note = remoteNote(idAt(1));
    fetchMock.mockResolvedValueOnce(json({ notes: [note] }));
    await expect(repository.list()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetchMock.mockResolvedValueOnce(json({ notes: [note], nextCursor: note.id }))
      .mockResolvedValueOnce(json({ notes: [note], nextCursor: note.id }));
    await expect(repository.list()).rejects.toMatchObject({ code: "INVALID_PAGINATION" });
    fetchMock.mockResolvedValueOnce(json({ notes: Array.from({ length: 11 }, (_, index) => ({ ...note, id: idAt(index + 1) })), nextCursor: null }));
    await expect(repository.list()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("第二页返回前切换账号，拒绝整批旧账号资料并停止请求后续页", async () => {
    const first = remoteNote(idAt(1));
    const second = remoteNote(idAt(2));
    let resolveSecond!: (response: Response) => void;
    let secondStarted!: () => void;
    const started = new Promise<void>(resolve => { secondStarted = resolve; });
    fetchMock.mockResolvedValueOnce(json({ notes: [first], nextCursor: first.id }))
      .mockImplementationOnce(() => { secondStarted(); return new Promise<Response>(resolve => { resolveSecond = resolve; }); });
    const pending = repository.list();
    await started;
    repository.setUser(crypto.randomUUID());
    resolveSecond(json({ notes: [second], nextCursor: second.id }));
    await expect(pending).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("超过10,000条时明确拒绝，不把截断资料当成完整备份", async () => {
    const base = remoteNote(idAt(1));
    let offset = 0;
    fetchMock.mockImplementation(async () => {
      const notes = Array.from({ length: 10 }, () => ({ ...base, id: idAt(++offset) }));
      return json({ notes, nextCursor: notes[notes.length - 1].id });
    });
    await expect(repository.list()).rejects.toMatchObject({ code: "LIBRARY_TOO_LARGE" });
    expect(offset).toBe(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1000);
  });
});

describe("真实保存与失败重试", () => {
  it("把今日片刻和关系去向与正文一起提交，服务器确认后才视为保存", async () => {
    const tags = captureContextTags("relationship");
    fetchMock.mockImplementationOnce(async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { id: string; input: CaptureInput; tags: string[] };
      expect(body.tags).toEqual(tags);
      return json({ note: { ...remoteNote(body.id, body.input), tags: body.tags } });
    });
    const saved = await repository.create(input, tags);
    expect(saved.tags).toEqual(tags);
    await expect(repository.getDraft()).resolves.toBeNull();
  });

  it("断网不宣布成功，保留草稿，重试使用同一UUID而且收到服务器确认后才清草稿", async () => {
    await repository.saveDraft(input);
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(repository.create(input)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    const firstBody = submittedBody();
    await expect(repository.getDraft()).resolves.toEqual(input);
    fetchMock.mockImplementationOnce(async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { id: string; input: CaptureInput };
      expect(body.id).toBe(firstBody.id);
      expect(await repository.getDraft()).toEqual(input);
      return json({ note: remoteNote(body.id, body.input) });
    });
    const saved = await repository.create(input);
    expect(saved.id).toBe(firstBody.id);
    await expect(repository.getDraft()).resolves.toBeNull();
    await expect(repository.getPreference("sourceType")).resolves.toBe("书籍");
  });

  it("页面重新载入后仍使用持久化的提交UUID，避免服务器已收到而响应丢失造成重复", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("lost response"));
    await expect(repository.create(input)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    const originalId = submittedBody().id;
    vi.resetModules();
    const { repository: reloaded } = await import("../src/lib/repository");
    reloaded.setUser(account);
    await reloaded.init();
    fetchMock.mockImplementationOnce(async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { id: string; input: CaptureInput };
      return json({ note: remoteNote(body.id, body.input) });
    });
    try {
      expect((await reloaded.create(input)).id).toBe(originalId);
      await expect(reloaded.getDraft()).resolves.toBeNull();
    } finally { reloaded.setUser(null); }
  });

  it("响应声称success但缺少有效已存记录时仍保留草稿，不显示保存成功", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true }));
    await expect(repository.create(input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(repository.getDraft()).resolves.toEqual(input);
    const previousId = submittedBody().id;
    fetchMock.mockImplementationOnce(async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { id: string; input: CaptureInput };
      expect(body.id).toBe(previousId);
      return json({ note: { ...remoteNote(body.id), storageVersion: undefined } });
    });
    await expect(repository.create(input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(repository.getDraft()).resolves.toEqual(input);
  });

  it("连续点击共享同一次提交，确认后的新草稿使用不同UUID", async () => {
    fetchMock.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { id: string; input: CaptureInput };
      return json({ note: remoteNote(body.id, body.input) });
    });
    const first = repository.create(input);
    const concurrent = repository.create(input);
    expect(concurrent).toBe(first);
    const initial = await first;
    const later = await repository.create({ ...input, userText: "另一条独立记录。" });
    expect(later.id).not.toBe(initial.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("服务器已提交而本地草稿清理失败时仍返回真实记录，再次点击不会生成重复记录", async () => {
    let failed = false;
    // Simulate local storage failure only after the server accepted the note.
    const originalDelete = IDBObjectStore.prototype.delete;
    const deleteSpy = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (this: IDBObjectStore, key) {
      if (this.transaction.db.name === "echo-account-drafts" && key === `${account}:draft` && !failed) {
        failed = true; throw new DOMException("simulated write failure", "QuotaExceededError");
      }
      return originalDelete.call(this, key);
    });
    fetchMock.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { id: string; input: CaptureInput };
      return json({ note: remoteNote(body.id, body.input) });
    });
    try {
      const first = await repository.create(input);
      expect(failed).toBe(true);
      await expect(repository.getDraft()).resolves.toBeNull();
      const retried = await repository.create(input);
      expect(retried.id).toBe(first.id);
    } finally { deleteSpy.mockRestore(); }
  });

  it("不确定提交后修改草稿，先确认旧记录并清楚提示，再保存新输入", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("connection lost after commit"));
    await expect(repository.create(input)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    const firstId = submittedBody().id;
    const changed = { ...input, userText: "后来补充的新想法。" };
    await repository.saveDraft(changed);
    fetchMock.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { id: string; input: CaptureInput };
      return json({ note: remoteNote(body.id, body.input) });
    });
    await expect(repository.create(changed)).rejects.toMatchObject({ code: "PREVIOUS_SUBMISSION_SAVED" });
    expect(submittedBody(1).id).toBe(firstId);
    await expect(repository.getDraft()).resolves.toEqual(changed);
    const saved = await repository.create(changed);
    expect(saved.id).not.toBe(firstId);
    expect(saved.userText).toBe(changed.userText);
  });
});

describe("跨设备并发与服务端操作结果", () => {
  it("事项只有收到相符的云端状态后才成功，旧版本和断网不改动原记录", async () => {
    const plain = remoteNote();
    const note = { ...plain, tags: taskTags(plain, "queue") };
    const active = { ...note, tags: taskTags(note, "start"), storageVersion: 2 };
    fetchMock.mockResolvedValueOnce(json({ note: active }));
    expect(taskStatus(await repository.updateTask(note, "start"))).toBe("active");
    expect(submittedBody()).toEqual({ action: "meta", input: { title: note.title, tags: active.tags }, expectedVersion: 1 });
    fetchMock.mockResolvedValueOnce(json({ note: active }));
    await expect(repository.updateTask(active, "complete")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetchMock.mockResolvedValueOnce(json({ code: "CONFLICT", error: "另一设备已更新" }, 409));
    await expect(repository.updateTask(active, "complete")).rejects.toMatchObject({ code: "CONFLICT" });
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(repository.updateTask(active, "complete")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(taskStatus(active)).toBe("active");
    const completed = { ...active, tags: taskTags(active, "complete"), storageVersion: 3 };
    fetchMock.mockResolvedValueOnce(json({ note: completed }));
    await expect(repository.updateTask(active, "complete")).resolves.toEqual(completed);
    fetchMock.mockResolvedValueOnce(json({ notes: [completed], nextCursor: null }));
    expect(taskStatus((await repository.list())[0])).toBe("completed");
  });

  it("使用编辑开始时的版本；冲突不先读取并覆盖其他设备的新版本", async () => {
    const note = remoteNote();
    fetchMock.mockResolvedValueOnce(json({ notes: [note], nextCursor: null }));
    await repository.list();
    fetchMock.mockResolvedValueOnce(json({ error: "其他设备已更新。", code: "CONFLICT" }, 409));
    await expect(repository.saveReflection(note.id, "我的新理解", undefined, 1)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(submittedBody(1)).toEqual({ action: "reflection", input: { text: "我的新理解" }, expectedVersion: 1 });
    fetchMock.mockResolvedValueOnce(json({ notes: [{ ...note, storageVersion: 3 }], nextCursor: null }));
    await repository.list();
    fetchMock.mockResolvedValueOnce(json({ code: "CONFLICT" }, 409));
    await expect(repository.updateMeta(note.id, { title: "旧编辑的标题", tags: [] }, 1)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(submittedBody(3).expectedVersion).toBe(1);
  });

  it("没有读过版本时拒绝修改，并且没有有效删除确认不宣告成功", async () => {
    const note = remoteNote();
    await expect(repository.remove(note.id)).rejects.toMatchObject({ code: "VERSION_REQUIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json({}));
    await expect(repository.remove(note.id, 1)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("整理只接受已真实写回的结果，未接通与不完整成功响应均拒绝", async () => {
    const note = remoteNote();
    fetchMock.mockResolvedValueOnce(json({ error: "AI 尚未配置。", code: "AI_NOT_CONFIGURED" }, 503));
    await expect(repository.organize(note.id, 1)).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    fetchMock.mockResolvedValueOnce(json({ applied: true, note }));
    await expect(repository.organize(note.id, 1)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetchMock.mockResolvedValueOnce(json({ applied: false, note }));
    await expect(repository.organize(note.id, 1)).resolves.toEqual({ applied: false, note });
  });

  it("导入只报告服务器确认数量，非法内容和超量文件不会发送请求", async () => {
    const notes = createExamples();
    fetchMock.mockResolvedValueOnce(json({ added: 2 }));
    await expect(repository.importNotes(notes)).resolves.toBe(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/notes/import");
    expect(submittedBody()).toEqual({ notes });
    await expect(repository.importNotes([{ ...notes[0], sourceUrl: "javascript:alert(1)" }])).rejects.toMatchObject({ code: "INVALID_IMPORT" });
    const large = Array.from({ length: 50 }, () => ({ ...notes[0], id: crypto.randomUUID(), sourceExcerpt: "字".repeat(40_000) }));
    await expect(repository.importNotes(large)).rejects.toMatchObject({ code: "IMPORT_TOO_LARGE" });
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValueOnce(json({ success: true }));
    await expect(repository.importNotes(notes)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
