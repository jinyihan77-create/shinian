import type { DataClient } from "./data-client";
import { z } from "zod";
import { aiResultSchema, backupSchema, CAPTURE_LIMITS, captureInputSchema, noteSchema } from "../schema";
import { DEFAULT_QUESTION, type AiResult, type CaptureInput, type EchoNote } from "../types";
import { ApiError } from "./http";

const captureKeys = ["userText", "sourceType", "sourceName", "sourceUrl", "sourceTimestamp", "sourceExcerpt"] as const;
const versionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const idSchema = z.string().uuid();
const conflictMessage = "这条记录已在另一处更新。你的输入仍在，请先刷新记录并核对后再保存。";

export function validateNoteId(id: string): string {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new ApiError(400, "INVALID_ID", "记录地址不正确。");
  return parsed.data;
}

function expectedVersion(version: number) {
  if (!versionSchema.safeParse(version).success) throw new ApiError(400, "VERSION_REQUIRED", "缺少记录版本，请刷新记录后重试。输入仍为你保留。");
  return version;
}

function cleanInput(input: CaptureInput): CaptureInput {
  const parsed = captureInputSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", parsed.error.issues[0]?.message || "请检查输入内容。");
  const cleaned = Object.fromEntries(captureKeys.map(key => [key, parsed.data[key].trim()])) as unknown as CaptureInput;
  if (![cleaned.userText, cleaned.sourceName, cleaned.sourceUrl, cleaned.sourceTimestamp, cleaned.sourceExcerpt].some(Boolean)) {
    throw new ApiError(400, "EMPTY_NOTE", "先记下一句话，或补充一个来源再保存。");
  }
  return cleaned;
}

function temporaryTitle(input: CaptureInput): string {
  const text = input.userText || input.sourceName || input.sourceExcerpt;
  if (text) return text.replace(/\s+/g, " ").slice(0, 24);
  if (input.sourceUrl) return `来自 ${new URL(input.sourceUrl).hostname}`.slice(0, CAPTURE_LIMITS.title);
  return "待补充的灵感";
}

function databaseError(error: { message?: string; code?: string }): never {
  const errors: Record<string, [number, string]> = {
    CONFLICT: [409, conflictMessage],
    CONTENT_CHANGED: [409, "内容已在另一处修改，请刷新后重新整理。"],
    NOT_FOUND: [404, "这条记录不存在，可能已在另一台设备删除。"],
    ALREADY_PROCESSING: [409, "这条记录正在整理，请等待本次完成。"],
    NO_AI_RESULT: [409, "这条记录还没有整理结果。"],
    NO_AI_INPUT: [400, "请先补充一点想法或来源文字，再进行整理。"],
    RATE_LIMITED: [429, "整理请求较多，请稍后重试。你的记录仍然保留。"],
    PRIVATE_ACCOUNT_REQUIRED: [403, "当前账号没有这个私人资料库的访问权限。"],
  };
  const matched = errors[error.message ?? ""];
  if (matched) throw new ApiError(matched[0], error.message!, matched[1]);
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "")) {
    throw new ApiError(503, "DATABASE_NOT_READY", "云端资料库尚未初始化，请先完成部署配置。此次操作没有确认保存成功。");
  }
  throw new ApiError(503, "CLOUD_UNAVAILABLE", "暂时无法连接云端资料库，无法确认此次操作是否保存。请保留输入，恢复连接后刷新核对。");
}

async function rpc<T>(client: DataClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) databaseError(error);
  return data as T;
}

function readNote(raw: unknown): EchoNote {
  const parsed = noteSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.storageVersion) {
    throw new ApiError(502, "INVALID_CLOUD_RECORD", "云端记录格式异常，未确认操作成功。请保留输入并联系维护者。");
  }
  return parsed.data;
}

function rowNote(row: { id: string; data: unknown; storage_version: number; created_at: string; updated_at: string }) {
  const data = row.data && typeof row.data === "object" ? row.data : {};
  return readNote({ ...data, id: row.id, storageVersion: row.storage_version,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() });
}

function validatedResult(note: EchoNote, result: AiResult): AiResult {
  const parsed = aiResultSchema.safeParse(result);
  if (!parsed.success) throw new ApiError(400, "INVALID_AI_RESULT", "整理结果格式不完整，请检查要点、标签和思考问题。");
  if ((!note.sourceExcerpt.trim() && (parsed.data.sourceSummary !== null || parsed.data.keyPoints.some(point => point.origin === "来源片段")))
    || (!note.userText.trim() && (parsed.data.thoughtSummary !== "" || parsed.data.keyPoints.some(point => point.origin === "用户记录")))) {
    throw new ApiError(400, "INVALID_PROVENANCE", "整理结果引用了没有提供的材料，未保存这个结果。");
  }
  return parsed.data;
}

const fields = "id,data,storage_version,created_at,updated_at";
const pageSize = 10;
// Below the host's 4.5 MB response ceiling, including JSON escaping/UTF-8.
const pageByteLimit = 3500 * 1024;

export const cloudNotes = {
  async listPage(client: DataClient, cursor?: string | null): Promise<{ notes: EchoNote[]; nextCursor: string | null }> {
    if (cursor !== undefined && cursor !== null && !idSchema.safeParse(cursor).success) {
      throw new ApiError(400, "INVALID_CURSOR", "资料库分页位置无效，请重新打开回声屿。");
    }
    await rpc(client, "echo_recover_ai");
    let query = client.from("echo_notes").select(fields).order("id", { ascending: true }).limit(pageSize + 1);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) databaseError(error);
    if (!data) throw new ApiError(502, "INVALID_CLOUD_RESPONSE", "云端没有返回有效资料，未确认读取成功。");
    const notes: EchoNote[] = [];
    // Reserve enough for the wrapper, commas and a full UUID cursor.
    let bytes = 128;
    for (const row of data) {
      if (notes.length === pageSize) break;
      const note = rowNote(row);
      const noteBytes = Buffer.byteLength(JSON.stringify(note), "utf8") + 1;
      if (bytes + noteBytes > pageByteLimit) {
        if (!notes.length) throw new ApiError(413, "NOTE_TOO_LARGE", "有一条记录超过单次读取限制，请联系维护者处理，原记录仍在云端。");
        break;
      }
      notes.push(note); bytes += noteBytes;
    }
    return { notes, nextCursor: notes.length < data.length ? notes[notes.length - 1].id : null };
  },
  // Internal helper only. HTTP uses bounded listPage responses.
  async list(client: DataClient): Promise<EchoNote[]> {
    await rpc(client, "echo_recover_ai");
    const notes: EchoNote[] = [];
    // Page by immutable ID: another device inserting or deleting rows must not
    // shift offsets and silently drop already-existing records from a backup.
    let cursor: string | undefined;
    for (;;) {
      let query = client.from("echo_notes").select(fields).order("id", { ascending: true }).limit(500);
      if (cursor) query = query.gt("id", cursor);
      const { data, error } = await query;
      if (error) databaseError(error);
      if (!data) throw new ApiError(502, "INVALID_CLOUD_RESPONSE", "云端没有返回有效资料，未确认读取成功。");
      notes.push(...data.map(rowNote));
      if (data.length < 500) break;
      cursor = data[data.length - 1].id;
    }
    return notes.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
  },
  async get(client: DataClient, id: string): Promise<EchoNote> {
    validateNoteId(id);
    await rpc(client, "echo_recover_ai");
    const { data, error } = await client.from("echo_notes").select(fields).eq("id", id).maybeSingle();
    if (error) databaseError(error);
    if (!data) throw new ApiError(404, "NOT_FOUND", "这条记录不存在，可能已在另一台设备删除。");
    return rowNote(data);
  },
  async create(client: DataClient, id: string, input: CaptureInput, tags: string[] = []): Promise<EchoNote> {
    const content = cleanInput(input);
    const note = { ...content, title: temporaryTitle(content), tags, aiStatus: "not_started", aiResult: null,
      aiInputRevision: null, aiError: null, reflectionPrompt: DEFAULT_QUESTION, reflectionText: "", revision: 1, isExample: false };
    return readNote(await rpc(client, "echo_create_note", { p_id: validateNoteId(id), p_note: note, p_capture: content }));
  },
  async updateContent(client: DataClient, id: string, version: number, input: CaptureInput): Promise<EchoNote> {
    return readNote(await rpc(client, "echo_update_note", { p_id: validateNoteId(id), p_expected_version: expectedVersion(version), p_action: "content", p_patch: cleanInput(input) }));
  },
  async updateMeta(client: DataClient, id: string, version: number, input: { title: string; tags: string[] }): Promise<EchoNote> {
    const parsed = z.object({ title: z.string().trim().min(1).max(100), tags: z.array(z.string().trim().min(1).max(40)).max(30) }).strict().safeParse(input);
    if (!parsed.success) throw new ApiError(400, "INVALID_META", "标题请填写 1～100 个字；标签最多 30 个，每个不超过 40 个字。");
    return readNote(await rpc(client, "echo_update_note", { p_id: validateNoteId(id), p_expected_version: expectedVersion(version), p_action: "meta", p_patch: { ...parsed.data, tags: [...new Set(parsed.data.tags)] } }));
  },
  async saveReflection(client: DataClient, id: string, version: number, text: string, prompt?: string): Promise<EchoNote> {
    const parsed = z.object({ text: z.string().max(CAPTURE_LIMITS.reflectionText), prompt: z.string().max(1000).optional() }).safeParse({ text, prompt });
    if (!parsed.success) throw new ApiError(400, "INVALID_REFLECTION", "自己的理解最多可以保存 30,000 个字，问题最多 1,000 个字。");
    return readNote(await rpc(client, "echo_update_note", { p_id: validateNoteId(id), p_expected_version: expectedVersion(version), p_action: "reflection", p_patch: parsed.data }));
  },
  async remove(client: DataClient, id: string, version: number): Promise<void> {
    const result = await rpc(client, "echo_delete_note", { p_id: validateNoteId(id), p_expected_version: expectedVersion(version) });
    if (result !== true) throw new ApiError(502, "DELETE_NOT_CONFIRMED", "云端没有确认删除，请刷新后核对。");
  },
  async updateAiResult(client: DataClient, id: string, version: number, result: AiResult): Promise<EchoNote> {
    const note = await cloudNotes.get(client, id);
    if (note.storageVersion !== expectedVersion(version)) throw new ApiError(409, "CONFLICT", conflictMessage);
    return readNote(await rpc(client, "echo_update_note", { p_id: id, p_expected_version: version, p_action: "aiResult", p_patch: validatedResult(note, result) }));
  },
  async importNotes(client: DataClient, notes: EchoNote[]): Promise<number> {
    const parsed = backupSchema.safeParse({ schemaVersion: 1, exportedAt: new Date().toISOString(), notes });
    if (!parsed.success) throw new ApiError(400, "INVALID_BACKUP", "备份包含无效记录，本次没有导入任何记录。");
    // Never trust a backup's optimistic lock version. The database assigns a fresh version.
    const records = parsed.data.notes.map(({ storageVersion: _version, ...note }) => note);
    const count = await rpc<number>(client, "echo_import_notes", { p_notes: records });
    if (!Number.isInteger(count) || count < 0 || count > records.length) throw new ApiError(502, "IMPORT_NOT_CONFIRMED", "云端没有返回有效导入结果，请刷新核对后重试。");
    return count;
  },
  async beginAi(client: DataClient, id: string, revision: number): Promise<{ note: EchoNote; token: string }> {
    if (!versionSchema.safeParse(revision).success) throw new ApiError(400, "INVALID_REVISION", "记录版本无效，请刷新后重试。");
    const result = await rpc<{ note: unknown; token: string }>(client, "echo_begin_ai", { p_id: validateNoteId(id), p_revision: revision });
    if (!result || !idSchema.safeParse(result.token).success) throw new ApiError(502, "AI_START_NOT_CONFIRMED", "云端没有确认开始整理，请刷新后重试。");
    return { note: readNote(result.note), token: result.token };
  },
  async finishAi(client: DataClient, id: string, token: string, revision: number, result: AiResult): Promise<boolean> {
    let note: EchoNote;
    try { note = await cloudNotes.get(client, id); }
    catch (error) { if (error instanceof ApiError && error.code === "NOT_FOUND") return false; throw error; }
    if (note.revision !== revision || note.aiStatus !== "processing") return false;
    const saved = await rpc(client, "echo_finish_ai", { p_id: id, p_token: validateNoteId(token), p_revision: revision,
      p_result: validatedResult(note, result), p_default_title: temporaryTitle(note) });
    if (typeof saved !== "boolean") throw new ApiError(502, "AI_SAVE_NOT_CONFIRMED", "云端没有确认整理结果保存成功，请刷新核对。");
    return saved;
  },
  async failAi(client: DataClient, id: string, token: string, message: string): Promise<void> {
    await rpc(client, "echo_fail_ai", { p_id: validateNoteId(id), p_token: validateNoteId(token), p_message: message.slice(0, 2000) || "整理失败，原记录仍然保留。" });
  },
};
