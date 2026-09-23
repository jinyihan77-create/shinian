import { z } from "zod";
import type { EchoNote } from "./types";

export const CHECKIN_TIME_ZONE = "Asia/Shanghai";
export const CHECKIN_LIMITS = { mood: 24, quote: 100 } as const;
export const CHECKIN_EXPERIENCE_VERSION = 2;
export const CHECKIN_VARIANTS = 3;

export function isCheckinDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const checkinDaySchema = z.string().refine(isCheckinDay, "打卡日期不正确，请刷新后重试。");
export const checkinInputSchema = z.object({
  expectedDay: checkinDaySchema,
  mood: z.string().trim().max(CHECKIN_LIMITS.mood),
  quote: z.string().trim().max(CHECKIN_LIMITS.quote),
  starVariant: z.number().int().min(0).max(CHECKIN_VARIANTS - 1).default(0),
  themeId: z.string().trim().min(1).max(64).default("climate-0"),
  materialId: z.string().trim().min(1).max(64).default("frost"),
  visualSeed: z.string().trim().min(1).max(128).default("0"),
  experienceVersion: z.number().int().positive().max(99).default(CHECKIN_EXPERIENCE_VERSION),
  sourceNoteIds: z.array(z.string().trim().min(1).max(128)).max(20).default([]),
}).strict();
export type CheckinInput = z.infer<typeof checkinInputSchema>;

export const checkinUpdateSchema = z.object({
  expectedDay: checkinDaySchema,
  mood: z.string().trim().max(CHECKIN_LIMITS.mood),
  quote: z.string().trim().max(CHECKIN_LIMITS.quote),
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type CheckinUpdate = z.infer<typeof checkinUpdateSchema>;

export const checkinEntrySchema = z.object({
  day: checkinDaySchema,
  mood: z.string().max(CHECKIN_LIMITS.mood),
  quote: z.string().max(CHECKIN_LIMITS.quote),
  createdAt: z.iso.datetime(),
  starVariant: z.number().int().min(0).max(CHECKIN_VARIANTS - 1).optional(),
  themeId: z.string().max(64).optional(),
  materialId: z.string().max(64).optional(),
  visualSeed: z.string().max(128).optional(),
  experienceVersion: z.number().int().positive().max(99).optional(),
  sourceNoteIds: z.array(z.string().max(128)).max(20).optional(),
  revision: z.number().int().positive().optional(),
  updatedAt: z.iso.datetime().optional(),
}).strict();
export type CheckinEntry = z.infer<typeof checkinEntrySchema>;

export const checkinSummarySchema = z.object({
  today: checkinDaySchema,
  totalDays: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currentStreak: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  entry: checkinEntrySchema.nullable(),
}).strict().refine(value => value.currentStreak <= value.totalDays && (
  value.entry === null || (value.entry.day === value.today && value.totalDays > 0 && value.currentStreak > 0)
));
export type CheckinSummary = z.infer<typeof checkinSummarySchema>;

/** A stable, account/day-scoped number for the star sea. It is intentionally non-random. */
export function stableVisualSeed(accountId: string, day: string): string {
  let hash = 2166136261;
  for (const character of `${accountId}:${day}:shinian-star-v2`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return String(hash >>> 0);
}

export function stableStarTheme(accountId: string, day: string, materialCount: number): number {
  const value = Number(stableVisualSeed(accountId, day));
  return Number.isFinite(value) && materialCount > 0 ? value % materialCount : 0;
}

/** Presentation and previews only. A real check-in day always comes from PostgreSQL. */
export function getCheckinDay(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHECKIN_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Counts calendar days, not 24-hour periods. Duplicate and future dates never inflate totals. */
export function summarizeCheckinDays(days: readonly string[], today: string): { totalDays: number; currentStreak: number } {
  if (!isCheckinDay(today)) throw new Error("INVALID_CHECKIN_DAY");
  const savedDays = new Set(days.filter(day => isCheckinDay(day) && day <= today));
  const previous = (day: string) => new Date(new Date(day + "T00:00:00.000Z").getTime() - 86_400_000).toISOString().slice(0, 10);
  let cursor = savedDays.has(today) ? today : previous(today);
  let currentStreak = 0;
  while (savedDays.has(cursor)) { currentStreak++; cursor = previous(cursor); }
  return { totalDays: savedDays.size, currentStreak };
}

export type CheckinSuggestion = { mood: string; quote: string; sourceCount: number };

function dayInShanghai(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? getCheckinDay(date) : "";
}

/** Returns the notes that can be traced back from a daily star card. */
export function checkinSourceNoteIds(notes: readonly EchoNote[], today = getCheckinDay()): string[] {
  return notes
    .filter(note => dayInShanghai(note.updatedAt || note.createdAt) === today)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(note => note.id)
    .slice(0, 20);
}

/** Short, traceable words used by the journey. Nothing is invented when notes are sparse. */
export function checkinKeywordsFromNotes(notes: readonly EchoNote[], today = getCheckinDay()): string[] {
  const todayNotes = notes
    .filter(note => dayInShanghai(note.updatedAt || note.createdAt) === today)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const candidates = todayNotes.flatMap(note => [
    ...note.tags,
    ...(note.aiResult?.tags ?? []),
    note.title,
  ]);
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const candidate of candidates) {
    const clean = candidate.replace(/^[#\s]+|[。！？!?，,；;：:\s]+$/g, "").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const short = Array.from(clean).slice(0, 10).join("");
    const key = short.toLocaleLowerCase("zh-CN");
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(short);
    if (keywords.length === 6) break;
  }
  return keywords;
}

function firstThought(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentence = clean.match(/^.*?[。！？!?](?:\s|$)/)?.[0]?.trim() || clean;
  return Array.from(sentence).length > 48 ? `${Array.from(sentence).slice(0, 47).join("")}…` : sentence;
}

/** Produces an editable daily card draft from notes already saved for today. */
export function suggestCheckinFromNotes(notes: readonly EchoNote[], today = getCheckinDay()): CheckinSuggestion {
  const todayNotes = notes
    .filter(note => dayInShanghai(note.updatedAt || note.createdAt) === today)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!todayNotes.length) return { mood: "", quote: "", sourceCount: 0 };
  const joined = todayNotes.map(note => `${note.title} ${note.userText} ${note.reflectionText}`).join(" ");
  const mood = /疲惫|累|困|倦/.test(joined) ? "有点疲惫"
    : /开心|轻松|轻快|兴奋|期待|喜欢/.test(joined) ? "轻快"
      : /焦虑|担心|难过|失落|纠结|混乱/.test(joined) ? "有些起伏"
        : /好奇|发现|原来|为什么|想知道/.test(joined) ? "充满好奇"
          : /散步|平静|慢慢|呼吸|安静/.test(joined) ? "平静" : "慢慢来";
  const latest = todayNotes[0];
  const quote = firstThought(latest.reflectionText) || firstThought(latest.userText) || firstThought(latest.title) || "今天也留下了一点属于自己的光。";
  return { mood, quote, sourceCount: todayNotes.length };
}
