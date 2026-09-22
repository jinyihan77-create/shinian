import { backupSchema, isSafeSourceUrl, noteSchema } from "./schema";
import type { Backup, EchoNote } from "./types";
import { taskLabels, taskStatus, visibleTags } from "./task-tickets";

export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

export function createBackup(notes: EchoNote[]): Backup {
  return backupSchema.parse({ schemaVersion: 1, exportedAt: new Date().toISOString(), notes });
}

/** Each part is a complete backup small enough for an atomic cloud import. */
export function splitBackup(notes: EchoNote[], maxBytes = 3.5 * 1024 * 1024): Backup[] {
  const validated = createBackup(notes);
  const parts: Backup[] = [];
  let current: Backup = { ...validated, notes: [] };
  const bytes = (value: Backup) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  for (const note of validated.notes) {
    const candidate = { ...current, notes: [...current.notes, note] };
    if (bytes(candidate) <= maxBytes) { current = candidate; continue; }
    if (current.notes.length) parts.push(current);
    current = { ...validated, notes: [note] };
    if (bytes(current) > maxBytes) throw new Error("单条记录超出备份大小限制，未生成备份。请先缩短这条记录的内容。");
  }
  if (current.notes.length || !parts.length) parts.push(current);
  return parts;
}

export function parseBackup(text: string): { backup: Backup | null; invalidCount: number; error: string | null } {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    return { backup: null, invalidCount: 1, error: "备份文件超过 25 MB，请使用较小的备份文件。没有修改现有资料。" };
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch {
    return { backup: null, invalidCount: 1, error: "这个文件不是有效的 JSON 备份。请导入从拾念导出的完整备份。" };
  }
  const parsed = backupSchema.safeParse(raw);
  if (parsed.success) return { backup: parsed.data, invalidCount: 0, error: null };
  const candidate = raw as { schemaVersion?: unknown; notes?: unknown } | null;
  if (candidate && typeof candidate === "object" && candidate.schemaVersion !== 1) {
    return { backup: null, invalidCount: 1, error: "这个备份版本暂不支持。请使用 schemaVersion 为 1 的完整备份，现有资料没有改变。" };
  }
  const invalidCount = Array.isArray(candidate?.notes)
    ? Math.max(1, candidate.notes.filter(note => !noteSchema.safeParse(note).success).length)
    : 1;
  return { backup: null, invalidCount, error: `备份中有 ${invalidCount} 处无效资料或结构错误，本次不会导入任何记录。现有资料没有改变。` };
}

export function inspectBackup(backup: Backup, existingNotes: EchoNote[]): { added: number; duplicates: number; invalid: number } {
  const seen = new Set(existingNotes.map(note => note.id));
  let added = 0;
  let duplicates = 0;
  let invalid = 0;
  for (const note of backup.notes) {
    if (!noteSchema.safeParse(note).success) { invalid += 1; continue; }
    if (seen.has(note.id)) duplicates += 1;
    else { seen.add(note.id); added += 1; }
  }
  return { added, duplicates, invalid };
}

function safeText(text: string): string {
  // Markdown is an external artifact too: escape raw HTML and markdown syntax.
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1");
}

export function toMarkdown(notes: EchoNote[]): string {
  const lines = ["# 拾念 · 我的灵感集", "", `导出时间：${new Date().toISOString()}`, "", "此文件用于阅读；恢复资料请使用 JSON 完整备份。", ""];
  for (const note of notes) {
    lines.push(`## ${safeText(note.title)}`, "");
    if (note.isExample) lines.push("**演示资料**", "");
    lines.push(`记录 ID：${note.id}`, "", `创建于：${note.createdAt}  ·  修改于：${note.updatedAt}`, "", `事项进度：${taskLabels[taskStatus(note)]}`, "", `标签：${visibleTags(note.tags).length ? visibleTags(note.tags).map(safeText).join("、") : "暂无"}`, "", "### 我的原始想法", "", safeText(note.userText) || "（未填写）", "", "### 来源材料", "", `来源类型：${note.sourceType}`, "", `来源名称：${safeText(note.sourceName) || "（未填写）"}`, "");
    if (note.sourceUrl) lines.push(`来源链接：${isSafeSourceUrl(note.sourceUrl) ? `[打开来源](${note.sourceUrl.replace(/[()<>\s]/g, character => encodeURIComponent(character))})` : safeText(note.sourceUrl)}`, "");
    if (note.sourceTimestamp) lines.push(`时间点：${safeText(note.sourceTimestamp)}`, "");
    lines.push("提供的来源片段：", "", safeText(note.sourceExcerpt) || "（未提供；未读取来源正文）", "", "### AI 帮我整理", "");
    const result = note.aiResult;
    if (result) {
      if (note.aiInputRevision !== note.revision) lines.push("内容已修改，以下为旧版本整理结果，建议重新整理。", "");
      lines.push(`标题建议：${safeText(result.title)}`, "", "我的想法提炼：", "", safeText(result.thoughtSummary) || "（未提供个人想法）", "", "来源片段概括：", "", result.sourceSummary ? safeText(result.sourceSummary) : "（未提供来源片段，未读取来源正文）", "");
      if (result.keyPoints.length) lines.push("核心要点：", "", ...result.keyPoints.map(point => `- ［${point.origin}］${safeText(point.text)}`), "");
      lines.push(`建议标签：${result.tags.map(safeText).join("、") || "暂无"}`, "", "思考问题：", "", ...result.reflectionQuestions.map(question => `- ${safeText(question)}`), "");
      if (result.possibleApplication) lines.push("可尝试的应用：", "", safeText(result.possibleApplication), "");
    } else lines.push("（尚未整理）", "");
    if (note.aiError) lines.push(`最近一次整理提示：${safeText(note.aiError)}`, "");
    lines.push("### 我自己的理解", "", `问题：${safeText(note.reflectionPrompt)}`, "", safeText(note.reflectionText) || "（等待写下自己的理解）", "", "---", "");
  }
  return lines.join("\n");
}
