import { z } from "zod";
import { SOURCE_TYPES } from "./types";

export const CAPTURE_LIMITS = {
  userText: 20_000,
  sourceName: 200,
  sourceUrl: 2_048,
  sourceTimestamp: 80,
  sourceExcerpt: 40_000,
  reflectionText: 30_000,
  title: 100,
} as const;

export function isSafeSourceUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export const captureInputSchema = z.object({
  userText: z.string().max(CAPTURE_LIMITS.userText, "想法最多可以保存 20,000 个字。"),
  sourceType: z.enum(SOURCE_TYPES),
  sourceName: z.string().max(CAPTURE_LIMITS.sourceName, "来源名称最多 200 个字。"),
  sourceUrl: z.string().max(CAPTURE_LIMITS.sourceUrl, "来源链接过长，请使用原始链接。")
    .refine(isSafeSourceUrl, "请输入完整的 http:// 或 https:// 链接，草稿仍为你保留。"),
  sourceTimestamp: z.string().max(CAPTURE_LIMITS.sourceTimestamp, "时间点最多 80 个字。"),
  sourceExcerpt: z.string().max(CAPTURE_LIMITS.sourceExcerpt, "来源片段最多可以保存 40,000 个字。"),
}).strict();

export const aiResultSchema = z.object({
  title: z.string().trim().min(1).max(CAPTURE_LIMITS.title),
  thoughtSummary: z.string().max(6_000),
  sourceSummary: z.string().max(10_000).nullable(),
  keyPoints: z.array(z.object({
    text: z.string().trim().min(1).max(2_000),
    origin: z.enum(["用户记录", "来源片段"]),
  }).strict()).max(3),
  tags: z.array(z.string().trim().min(1).max(40)).max(5),
  reflectionQuestions: z.array(z.string().trim().min(1).max(500)).min(1).max(2),
  possibleApplication: z.string().max(2_000).nullable(),
}).strict();

export const noteSchema = captureInputSchema.extend({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(CAPTURE_LIMITS.title),
  tags: z.array(z.string().trim().min(1).max(40)).max(30),
  aiStatus: z.enum(["not_started", "processing", "done", "error", "outdated"]),
  aiResult: aiResultSchema.nullable(),
  aiInputRevision: z.number().int().min(1).nullable(),
  aiError: z.string().max(2_000).nullable(),
  reflectionPrompt: z.string().max(1_000),
  reflectionText: z.string().max(CAPTURE_LIMITS.reflectionText),
  revision: z.number().int().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  isExample: z.boolean(),
  storageVersion: z.number().int().positive().optional(),
}).strict().superRefine((note, ctx) => {
  if ((note.aiResult === null) !== (note.aiInputRevision === null)) {
    ctx.addIssue({ code: "custom", message: "整理结果与对应版本不完整。", path: ["aiInputRevision"] });
  }
  if (note.aiInputRevision !== null && note.aiInputRevision > note.revision) {
    ctx.addIssue({ code: "custom", message: "整理结果版本不能晚于记录版本。", path: ["aiInputRevision"] });
  }
  if (note.aiStatus === "done" && (!note.aiResult || note.aiInputRevision !== note.revision)) {
    ctx.addIssue({ code: "custom", message: "已整理状态必须对应当前内容。", path: ["aiStatus"] });
  }
  if (note.aiStatus === "outdated" && !note.aiResult) {
    ctx.addIssue({ code: "custom", message: "待更新的记录缺少旧整理结果。", path: ["aiStatus"] });
  }
});

export const backupSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  notes: z.array(noteSchema).max(10_000),
}).strict();
