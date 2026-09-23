import Dexie, { type Table } from "dexie";
import { aiResultSchema, backupSchema, CAPTURE_LIMITS, captureInputSchema, noteSchema } from "./schema";
import { DEFAULT_QUESTION, type AiResult, type CaptureInput, type EchoNote } from "./types";

interface Setting { key: string; value: unknown }

class EchoDatabase extends Dexie {
  notes!: Table<EchoNote, string>;
  settings!: Table<Setting, string>;
  constructor() {
    super("inspiration-echo");
    this.version(1).stores({ notes: "&id,createdAt,updatedAt,aiStatus,*tags", settings: "&key" });
  }
}

const db = new EchoDatabase();
const interruptedMessage = "上次整理中断了，你的记录和已有结果都还在，可以重新整理。";
const captureKeys: (keyof CaptureInput)[] = ["userText", "sourceType", "sourceName", "sourceUrl", "sourceTimestamp", "sourceExcerpt"];

function createId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Local network previews may use HTTP; getRandomValues still provides secure IDs.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function storageError(error: unknown): Error {
  const name = error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError") return new Error("浏览器存储空间不足。请先导出已有资料，再释放空间后重试。");
  if (["MissingAPIError", "SecurityError", "InvalidStateError", "OpenFailedError", "DatabaseClosedError", "UnknownError"].includes(name)) {
    return new Error("暂时无法打开本地回声屿。请检查浏览器是否允许网站保存数据，或退出隐私模式后重试。");
  }
  if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)) return error;
  return new Error("本地资料保存或读取失败，请重试。已输入的内容仍为你保留。");
}

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { throw storageError(error); }
}

function cleanInput(input: CaptureInput): CaptureInput {
  const cleaned = { ...input };
  for (const key of captureKeys) {
    if (typeof input[key] === "string") (cleaned as Record<string, string>)[key] = input[key].trim();
  }
  const parsed = captureInputSchema.safeParse(cleaned);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "请检查输入的内容。");
  if (![cleaned.userText, cleaned.sourceName, cleaned.sourceUrl, cleaned.sourceTimestamp, cleaned.sourceExcerpt].some(Boolean)) {
    throw new Error("先记下一句话，或补充一个来源再保存。");
  }
  return parsed.data;
}

export function temporaryTitle(input: CaptureInput): string {
  const text = input.userText || input.sourceName || input.sourceExcerpt;
  if (text) return text.replace(/\s+/g, " ").slice(0, 24);
  if (input.sourceUrl) {
    try { return `来自 ${new URL(input.sourceUrl).hostname}`.slice(0, CAPTURE_LIMITS.title); } catch { /* validated on save */ }
  }
  return "待补充的灵感";
}

async function requireNote(id: string): Promise<EchoNote> {
  const note = await db.notes.get(id);
  if (!note) throw new Error("这条记录已不存在，可能已经被删除。");
  return note;
}

function validateProvenance(note: EchoNote, result: AiResult): void {
  if ((!note.sourceExcerpt.trim() && (result.sourceSummary !== null || result.keyPoints.some(point => point.origin === "来源片段"))) || (!note.userText.trim() && (result.thoughtSummary !== "" || result.keyPoints.some(point => point.origin === "用户记录")))) {
    throw new Error("整理结果与实际提供的材料不一致：没有提供的内容应留空，不应添加相应来源的要点。");
  }
}

let initialization: Promise<void> | null = null;

export const repository = {
  init(): Promise<void> {
    if (!initialization) {
      initialization = safely(async () => {
        await db.open();
        await db.notes.where("aiStatus").equals("processing").modify({ aiStatus: "error", aiError: interruptedMessage });
      }).catch(error => { initialization = null; throw error; });
    }
    return initialization;
  },
  list(): Promise<EchoNote[]> {
    return safely(() => db.notes.orderBy("createdAt").reverse().toArray());
  },
  get(id: string): Promise<EchoNote | undefined> {
    return safely(() => db.notes.get(id));
  },
  create(input: CaptureInput): Promise<EchoNote> {
    return safely(async () => {
      const content = cleanInput(input);
      const now = new Date().toISOString();
      const note: EchoNote = {
        ...content, id: createId(), title: temporaryTitle(content), tags: [],
        aiStatus: "not_started", aiResult: null, aiInputRevision: null, aiError: null,
        reflectionPrompt: DEFAULT_QUESTION, reflectionText: "", revision: 1,
        createdAt: now, updatedAt: now, isExample: false,
      };
      await db.transaction("rw", db.notes, db.settings, async () => {
        await db.notes.add(note);
        await db.settings.delete("draft");
        await db.settings.put({ key: "sourceType", value: content.sourceType });
      });
      return note;
    });
  },
  updateContent(id: string, input: CaptureInput): Promise<EchoNote> {
    return safely(() => db.transaction("rw", db.notes, async () => {
      const content = cleanInput(input);
      const note = await requireNote(id);
      if (captureKeys.every(key => note[key] === content[key])) return note;
      const updated: EchoNote = {
        ...note, ...content, revision: note.revision + 1, updatedAt: new Date().toISOString(),
        aiStatus: note.aiResult ? "outdated" : "not_started", aiError: null,
      };
      await db.notes.put(updated);
      return updated;
    }));
  },
  updateMeta(id: string, input: { title: string; tags: string[] }): Promise<EchoNote> {
    return safely(() => db.transaction("rw", db.notes, async () => {
      const note = await requireNote(id);
      const updated = { ...note, title: input.title.trim(), tags: [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))], updatedAt: new Date().toISOString() };
      if (!noteSchema.safeParse(updated).success) throw new Error("标题请填写 1～100 个字；标签最多 30 个，每个不超过 40 个字。");
      await db.notes.put(updated);
      return updated;
    }));
  },
  saveReflection(id: string, text: string, prompt?: string): Promise<EchoNote> {
    return safely(() => db.transaction("rw", db.notes, async () => {
      const note = await requireNote(id);
      if (text.length > CAPTURE_LIMITS.reflectionText || (prompt?.length ?? 0) > 1_000) throw new Error("自己的理解最多可以保存 30,000 个字，问题最多 1,000 个字。");
      const updated = { ...note, reflectionText: text, reflectionPrompt: prompt ?? note.reflectionPrompt, updatedAt: new Date().toISOString() };
      await db.notes.put(updated);
      return updated;
    }));
  },
  remove(id: string): Promise<void> {
    return safely(() => db.notes.delete(id));
  },
  getDraft(): Promise<CaptureInput | null> {
    return safely(async () => {
      const value = (await db.settings.get("draft"))?.value;
      if (!value || typeof value !== "object" || !captureKeys.every(key => typeof (value as CaptureInput)[key] === "string")) return null;
      return value as CaptureInput;
    });
  },
  saveDraft(input: CaptureInput): Promise<void> {
    // Drafts deliberately keep unvalidated URLs so a failed save never erases input.
    return safely(async () => { await db.settings.put({ key: "draft", value: { ...input } }); });
  },
  clearDraft(): Promise<void> {
    return safely(() => db.settings.delete("draft"));
  },
  getPreference(key: string): Promise<string | null> {
    return safely(async () => {
      const value = (await db.settings.get(key))?.value;
      return typeof value === "string" ? value : null;
    });
  },
  setPreference(key: string, value: string): Promise<void> {
    return safely(async () => { await db.settings.put({ key, value }); });
  },
  startOrganizing(id: string): Promise<EchoNote> {
    return safely(() => db.transaction("rw", db.notes, async () => {
      const note = await requireNote(id);
      if (note.aiStatus === "processing") throw new Error("这条记录正在整理，请稍等。");
      if (!note.userText.trim() && !note.sourceExcerpt.trim()) throw new Error("只有来源信息，还需要补充一点想法或来源文字。");
      const updated: EchoNote = { ...note, aiStatus: "processing", aiError: null };
      await db.notes.put(updated);
      return updated;
    }));
  },
  completeOrganizing(id: string, revision: number, result: AiResult): Promise<boolean> {
    return safely(() => db.transaction("rw", db.notes, async () => {
      const parsed = aiResultSchema.safeParse(result);
      if (!parsed.success) throw new Error("整理结果格式不完整，请重新整理。");
      const note = await db.notes.get(id);
      if (!note || note.revision !== revision || note.aiStatus !== "processing") return false;
      validateProvenance(note, parsed.data);
      const firstResult = note.aiResult === null;
      await db.notes.put({
        ...note, aiResult: parsed.data, aiInputRevision: revision, aiStatus: "done", aiError: null,
        title: firstResult && note.title === temporaryTitle(note) ? parsed.data.title : note.title,
        tags: firstResult && note.tags.length === 0 ? parsed.data.tags : note.tags,
        reflectionPrompt: !note.reflectionText.trim() && note.reflectionPrompt === DEFAULT_QUESTION ? parsed.data.reflectionQuestions[0] : note.reflectionPrompt,
        updatedAt: new Date().toISOString(),
      });
      return true;
    }));
  },
  failOrganizing(id: string, revision: number, message: string): Promise<void> {
    return safely(() => db.transaction("rw", db.notes, async () => {
      const note = await db.notes.get(id);
      if (!note || note.revision !== revision || note.aiStatus !== "processing") return;
      await db.notes.put({ ...note, aiStatus: "error", aiError: message.slice(0, 2_000) || "整理暂时失败，你的记录已经保存。" });
    }));
  },
  updateAiResult(id: string, result: AiResult): Promise<EchoNote> {
    return safely(() => db.transaction("rw", db.notes, async () => {
      const parsed = aiResultSchema.safeParse(result);
      if (!parsed.success) throw new Error("请检查整理内容：最多 3 条要点、5 个标签和 2 个思考问题。");
      const note = await requireNote(id);
      if (!note.aiResult) throw new Error("这条记录还没有整理结果。");
      if (note.aiStatus === "processing") throw new Error("正在整理，完成后再编辑结果。");
      validateProvenance(note, parsed.data);
      const updated = { ...note, aiResult: parsed.data, updatedAt: new Date().toISOString() };
      await db.notes.put(updated);
      return updated;
    }));
  },
  importNotes(notes: EchoNote[]): Promise<number> {
    return safely(async () => {
      const parsed = backupSchema.safeParse({ schemaVersion: 1, exportedAt: new Date().toISOString(), notes });
      if (!parsed.success) throw new Error("备份中包含无效资料，本次没有导入任何记录。");
      return db.transaction("rw", db.notes, async () => {
        let count = 0;
        for (const note of parsed.data.notes) {
          if (await db.notes.get(note.id)) continue;
          // A request from the exported browser cannot complete in this session.
          // Keep its last successful result and immediately offer a retry.
          await db.notes.add(note.aiStatus === "processing"
            ? { ...note, aiStatus: "error", aiError: interruptedMessage }
            : note);
          count += 1;
        }
        return count;
      });
    });
  },
};
