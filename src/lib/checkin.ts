import { z } from "zod";

export const CHECKIN_TIME_ZONE = "Asia/Shanghai";
export const CHECKIN_LIMITS = { mood: 24, quote: 100 } as const;

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
}).strict();
export type CheckinInput = z.infer<typeof checkinInputSchema>;

export const checkinEntrySchema = z.object({
  day: checkinDaySchema,
  mood: z.string().max(CHECKIN_LIMITS.mood),
  quote: z.string().max(CHECKIN_LIMITS.quote),
  createdAt: z.iso.datetime(),
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
