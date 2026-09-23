import Dexie, { type Table } from "dexie";
import { aiResultSchema, backupSchema, CAPTURE_LIMITS, captureInputSchema, noteSchema } from "./schema";
import type { AiResult, CaptureInput, EchoNote } from "./types";
import { taskStatus, taskTags, type TaskAction } from "./task-tickets";

interface Setting { key: string; value: unknown }
interface Submission { id: string; input: CaptureInput; tags?: string[] }
class AccountDraftDatabase extends Dexie {
  settings!: Table<Setting, string>;
  constructor() {
    super("echo-account-drafts");
    this.version(1).stores({ settings: "&key" });
  }
}

// Only drafts and preferences live here. Saved notes always come from the server.
const drafts = new AccountDraftDatabase();
const noteVersions = new Map<string, number>();
const confirmedSubmissions = new Map<string, string>();
const createInFlight = new Map<string, Promise<EchoNote>>();
const captureKeys: (keyof CaptureInput)[] = ["userText", "sourceType", "sourceName", "sourceUrl", "sourceTimestamp", "sourceExcerpt"];
const MAX_CLOUD_IMPORT_BYTES = 4 * 1024 * 1024;
let userId: string | null = null;

export class RepositoryError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 0) {
    super(message);
    this.name = "RepositoryError";
  }
}

function requireUser(): string {
  if (!userId) throw new RepositoryError("请先登录你的私人账号。输入的内容仍保留在当前页面。", "AUTH_REQUIRED", 401);
  return userId;
}

function assertUser(expected: string): void {
  if (userId !== expected) throw new RepositoryError("登录账号已变化，请重新进入回声屿。", "SESSION_CHANGED", 401);
}

function scopedKey(scope: string, key: string): string { return `${scope}:${key}`; }

async function local<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof RepositoryError) throw error;
    throw new RepositoryError("浏览器暂时无法保存草稿。请保留页面中的输入，检查网站存储权限后重试。", "DRAFT_STORAGE_FAILED");
  }
}

async function request(scope: string, url: string, options: { method?: string; body?: unknown; timeout?: number } = {}): Promise<Record<string, unknown>> {
  assertUser(scope);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 25_000);
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "x-echo-user-id": scope },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });
    assertUser(scope);
    const body: unknown = await response.json().catch(() => null);
    assertUser(scope);
    const record = body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
    if (!response.ok) {
      if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("echo:session-expired"));
      const code = typeof record?.code === "string" ? record.code : `HTTP_${response.status}`;
      const fallback = response.status === 401 ? "登录已过期，请重新登录。输入的内容仍为你保留。"
        : response.status === 409 ? "这条记录已在其他设备更新。请保留当前输入，刷新后核对再保存。"
          : response.status === 413 ? "这次导入超过服务器大小限制，请使用小于 4 MB 的备份文件。"
            : "云端操作未确认成功，请稍后重试。输入的内容仍为你保留。";
      throw new RepositoryError(typeof record?.error === "string" ? record.error : fallback, code, response.status);
    }
    if (!record) throw new RepositoryError("服务器返回的数据不完整，暂时无法确认操作结果，请重试。", "INVALID_RESPONSE", response.status);
    return record;
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    if (controller.signal.aborted) throw new RepositoryError("连接超时，尚未确认云端结果。输入仍保留，重试不会重复创建记录。", "TIMEOUT");
    throw new RepositoryError("暂时连接不到云端，尚未确认操作成功。请检查网络后重试，输入仍为你保留。", "NETWORK_ERROR");
  } finally { clearTimeout(timer); }
}

function readNote(value: unknown, cacheVersion = true): EchoNote {
  const parsed = noteSchema.safeParse(value);
  if (!parsed.success || !parsed.data.storageVersion) throw new RepositoryError("云端记录不完整，暂时无法确认操作结果，请重试。", "INVALID_RESPONSE");
  if (cacheVersion) noteVersions.set(parsed.data.id, parsed.data.storageVersion);
  return parsed.data;
}

function expectedVersion(id: string, version?: number): number {
  const expected = version ?? noteVersions.get(id);
  if (!Number.isInteger(expected) || !expected || expected < 1) {
    throw new RepositoryError("请先重新打开这条记录，再保存修改。当前输入仍为你保留。", "VERSION_REQUIRED");
  }
  return expected;
}

function cleanInput(input: CaptureInput): CaptureInput {
  const cleaned = { ...input };
  for (const key of captureKeys) cleaned[key] = input[key].trim() as never;
  const parsed = captureInputSchema.safeParse(cleaned);
  if (!parsed.success) throw new RepositoryError(parsed.error.issues[0]?.message || "请检查输入内容。", "INVALID_INPUT");
  if (![cleaned.userText, cleaned.sourceName, cleaned.sourceUrl, cleaned.sourceTimestamp, cleaned.sourceExcerpt].some(Boolean)) {
    throw new RepositoryError("先记下一句话，或补充一个来源再保存。", "INVALID_INPUT");
  }
  return parsed.data;
}

function sameInput(first: CaptureInput, second: CaptureInput): boolean {
  return captureKeys.every(key => first[key].trim() === second[key].trim());
}

function cleanInitialTags(tags: string[]): string[] {
  const cleaned = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
  if (cleaned.length > 2 || cleaned.some(tag => !tag.startsWith("__shinian_context:"))) {
    throw new RepositoryError("记录去向不正确，请重新选择后保存。", "INVALID_INPUT");
  }
  return cleaned;
}

function sameTags(first: readonly string[] = [], second: readonly string[] = []): boolean {
  return first.length === second.length && first.every((tag, index) => tag === second[index]);
}

function createId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function temporaryTitle(input: CaptureInput): string {
  const text = input.userText || input.sourceName || input.sourceExcerpt;
  if (text) return text.replace(/\s+/g, " ").slice(0, 24);
  if (input.sourceUrl) {
    try { return `来自 ${new URL(input.sourceUrl).hostname}`.slice(0, CAPTURE_LIMITS.title); } catch { /* checked before save */ }
  }
  return "待补充的灵感";
}

async function patch(id: string, action: string, input: unknown, version?: number): Promise<EchoNote> {
  const scope = requireUser();
  const body = await request(scope, `/api/notes/${encodeURIComponent(id)}`, {
    method: "PATCH", body: { action, input, expectedVersion: expectedVersion(id, version) },
  });
  const note = readNote(body.note);
  if (note.id !== id) throw new RepositoryError("服务器返回了不同的记录，请刷新后重试。", "INVALID_RESPONSE");
  return note;
}

async function create(scope: string, input: CaptureInput, initialTags: string[] = []): Promise<EchoNote> {
  const content = cleanInput(input);
  const tags = cleanInitialTags(initialTags);
  const submissionKey = scopedKey(scope, "draftSubmissionId");
  const draftKey = scopedKey(scope, "draft");
  const submission = await local(() => drafts.transaction("rw", drafts.settings, async () => {
    const stored = (await drafts.settings.get(submissionKey))?.value as Submission | undefined;
    if (stored && (stored.id !== confirmedSubmissions.get(scope) || (sameInput(stored.input, content) && sameTags(stored.tags, tags)))) return stored;
    const next: Submission = { id: createId(), input: content, tags };
    await drafts.settings.put({ key: submissionKey, value: next });
    // Ensure a caller without an autosaved draft also keeps their input on failure.
    await drafts.settings.put({ key: draftKey, value: { ...input } });
    return next;
  }));
  assertUser(scope);
  if (!sameInput(submission.input, content) || !sameTags(submission.tags, tags)) {
    // A previous timed-out request may have committed. Resolve it before assigning a new UUID.
    const previous = await request(scope, "/api/notes", { method: "POST", body: { id: submission.id, input: submission.input, tags: submission.tags ?? [] } });
    const resolved = readNote(previous.note);
    if (resolved.id !== submission.id) throw new RepositoryError("服务器返回的记录不一致，请重试。", "INVALID_RESPONSE");
    confirmedSubmissions.set(scope, submission.id);
    await local(() => drafts.settings.delete(submissionKey)).catch(() => {});
    throw new RepositoryError("上一次提交已确认保存在回声屿。当前草稿已有修改，请再次保存为新记录，或打开原记录继续编辑。", "PREVIOUS_SUBMISSION_SAVED");
  }
  const body = await request(scope, "/api/notes", { method: "POST", body: { id: submission.id, input: content, tags } });
  const note = readNote(body.note);
  if (note.id !== submission.id) throw new RepositoryError("服务器返回的记录不一致，请重试。", "INVALID_RESPONSE");
  confirmedSubmissions.set(scope, submission.id);
  // A committed cloud write stays successful even if local cleanup fails.
  // The in-memory ID also prevents accidental reuse for a subsequent create.
  await local(() => drafts.transaction("rw", drafts.settings, async () => {
    const current = (await drafts.settings.get(draftKey))?.value as CaptureInput | undefined;
    if (current && sameInput(current, content)) await drafts.settings.delete(draftKey);
    await drafts.settings.delete(submissionKey);
    await drafts.settings.put({ key: scopedKey(scope, "sourceType"), value: content.sourceType });
  })).catch(() => {});
  return note;
}

export const repository = {
  setUser(nextUserId: string | null): void {
    if (nextUserId === userId) return;
    userId = nextUserId;
    noteVersions.clear();
  },
  async init(): Promise<void> {
    const scope = requireUser();
    await local(async () => { await drafts.open(); });
    assertUser(scope);
  },
  async list(): Promise<EchoNote[]> {
    const scope = requireUser();
    const notes: EchoNote[] = [];
    const seenCursors = new Set<string>();
    const seenIds = new Set<string>();
    let cursor: string | null = null;
    for (;;) {
      const body = await request(scope, cursor ? `/api/notes?cursor=${encodeURIComponent(cursor)}` : "/api/notes");
      if (!Array.isArray(body.notes) || body.notes.length > 10 || (body.nextCursor !== null && typeof body.nextCursor !== "string")) {
        throw new RepositoryError("云端资料列表不完整，请重试。", "INVALID_RESPONSE");
      }
      const page = body.notes.map(value => readNote(value, false));
      let previousId = cursor?.toLowerCase() ?? "";
      for (const note of page) {
        const id = note.id.toLowerCase();
        if (seenIds.has(id) || id <= previousId) throw new RepositoryError("云端资料分页重复或顺序异常，请刷新重试。", "INVALID_PAGINATION");
        seenIds.add(id); previousId = id; notes.push(note);
      }
      if (notes.length > 10_000 || (notes.length === 10_000 && body.nextCursor !== null)) {
        throw new RepositoryError("资料库超过当前一次读取的 10,000 条上限，未返回不完整资料。请联系维护者扩充读取容量。", "LIBRARY_TOO_LARGE");
      }
      if (body.nextCursor === null) break;
      const next = body.nextCursor as string;
      if (!page.length || next !== page[page.length - 1].id || seenCursors.has(next.toLowerCase())) {
        throw new RepositoryError("云端资料分页未继续前进，请刷新重试。", "INVALID_PAGINATION");
      }
      seenCursors.add(next.toLowerCase());
      cursor = next;
    }
    // Publish versions only when every page belongs to the same authenticated user
    // and the complete list has arrived; a partial refresh must not alter edits.
    assertUser(scope);
    for (const note of notes) noteVersions.set(note.id, note.storageVersion!);
    return notes.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
  },
  async get(id: string): Promise<EchoNote | undefined> {
    try {
      const body = await request(requireUser(), `/api/notes/${encodeURIComponent(id)}`);
      const note = readNote(body.note);
      if (note.id !== id) throw new RepositoryError("服务器返回了不同的记录，请刷新后重试。", "INVALID_RESPONSE");
      return note;
    } catch (error) {
      if (error instanceof RepositoryError && error.status === 404) return undefined;
      throw error;
    }
  },
  create(input: CaptureInput, initialTags: string[] = []): Promise<EchoNote> {
    const scope = requireUser();
    const existing = createInFlight.get(scope);
    if (existing) return existing;
    const pending = create(scope, input, initialTags).finally(() => { createInFlight.delete(scope); });
    createInFlight.set(scope, pending);
    return pending;
  },
  updateContent(id: string, input: CaptureInput, version?: number): Promise<EchoNote> {
    return patch(id, "content", cleanInput(input), version);
  },
  updateMeta(id: string, input: { title: string; tags: string[] }, version?: number): Promise<EchoNote> {
    return patch(id, "meta", { title: input.title.trim(), tags: [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))] }, version);
  },
  async updateTask(note: EchoNote, action: TaskAction): Promise<EchoNote> {
    if (!note.storageVersion) throw new RepositoryError("请刷新这条记录后再更新事项。", "VERSION_REQUIRED");
    const tags = taskTags(note, action);
    const saved = await patch(note.id, "meta", { title: note.title, tags }, note.storageVersion);
    if (taskStatus(saved) !== taskStatus({ tags })) throw new RepositoryError("服务器还未确认事项状态，请刷新核对后重试。", "INVALID_RESPONSE");
    return saved;
  },
  saveReflection(id: string, text: string, prompt?: string, version?: number): Promise<EchoNote> {
    return patch(id, "reflection", { text, ...(prompt === undefined ? {} : { prompt }) }, version);
  },
  updateAiResult(id: string, result: AiResult, version?: number): Promise<EchoNote> {
    const parsed = aiResultSchema.safeParse(result);
    if (!parsed.success) return Promise.reject(new RepositoryError("请检查整理内容：最多 3 条要点、5 个标签和 2 个思考问题。", "INVALID_INPUT"));
    return patch(id, "aiResult", parsed.data, version);
  },
  async remove(id: string, version?: number): Promise<void> {
    const body = await request(requireUser(), `/api/notes/${encodeURIComponent(id)}`, { method: "DELETE", body: { expectedVersion: expectedVersion(id, version) } });
    if (body.success !== true) throw new RepositoryError("服务器尚未确认删除成功，请刷新核对后重试。", "INVALID_RESPONSE");
    noteVersions.delete(id);
  },
  async getDraft(): Promise<CaptureInput | null> {
    const scope = requireUser();
    const value = await local(async () => (await drafts.settings.get(scopedKey(scope, "draft")))?.value);
    assertUser(scope);
    if (!value || typeof value !== "object" || !captureKeys.every(key => typeof (value as CaptureInput)[key] === "string")) return null;
    const submission = await local(async () => (await drafts.settings.get(scopedKey(scope, "draftSubmissionId")))?.value as Submission | undefined);
    assertUser(scope);
    if (submission && submission.id === confirmedSubmissions.get(scope) && sameInput(submission.input, value as CaptureInput)) return null;
    return { ...value as CaptureInput };
  },
  async saveDraft(input: CaptureInput): Promise<void> {
    const scope = requireUser();
    await local(async () => { await drafts.settings.put({ key: scopedKey(scope, "draft"), value: { ...input } }); });
  },
  async clearDraft(): Promise<void> {
    const scope = requireUser();
    await local(() => drafts.transaction("rw", drafts.settings, async () => {
      await drafts.settings.delete(scopedKey(scope, "draft"));
      await drafts.settings.delete(scopedKey(scope, "draftSubmissionId"));
    }));
  },
  async getPreference(key: string): Promise<string | null> {
    const scope = requireUser();
    const value = await local(async () => (await drafts.settings.get(scopedKey(scope, key)))?.value);
    assertUser(scope);
    return typeof value === "string" ? value : null;
  },
  async setPreference(key: string, value: string): Promise<void> {
    const scope = requireUser();
    await local(async () => { await drafts.settings.put({ key: scopedKey(scope, key), value }); });
  },
  async organize(id: string, revision: number): Promise<{ applied: boolean; note: EchoNote }> {
    const body = await request(requireUser(), "/api/organize", { method: "POST", body: { id, revision }, timeout: 60_000 });
    if (typeof body.applied !== "boolean") throw new RepositoryError("整理结果尚未确认保存，请刷新核对后重试。", "INVALID_RESPONSE");
    const note = readNote(body.note);
    if (note.id !== id || (body.applied && (note.aiStatus !== "done" || !note.aiResult))) {
      throw new RepositoryError("整理结果尚未确认保存，请刷新核对后重试。", "INVALID_RESPONSE");
    }
    return { applied: body.applied, note };
  },
  async importNotes(notes: EchoNote[]): Promise<number> {
    const scope = requireUser();
    const parsed = backupSchema.safeParse({ schemaVersion: 1, exportedAt: new Date().toISOString(), notes });
    if (!parsed.success) throw new RepositoryError("备份中包含无效资料，本次没有导入任何记录。", "INVALID_IMPORT");
    const payload = { notes: parsed.data.notes };
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_CLOUD_IMPORT_BYTES) {
      throw new RepositoryError("备份超过 4 MB 的单次导入限制，本次没有导入任何记录。", "IMPORT_TOO_LARGE");
    }
    const body = await request(scope, "/api/notes/import", { method: "POST", body: payload, timeout: 60_000 });
    if (typeof body.added !== "number" || !Number.isInteger(body.added) || body.added < 0 || body.added > notes.length) {
      throw new RepositoryError("服务器尚未确认导入结果。请刷新核对，重复导入会跳过已有记录。", "INVALID_RESPONSE");
    }
    return body.added;
  },
  async getLegacyNotes(): Promise<EchoNote[]> {
    requireUser();
    // Loading the old database is an explicit migration action, never a cloud fallback.
    const { repository: legacy } = await import("./local-repository");
    await legacy.init();
    return legacy.list();
  },
};
