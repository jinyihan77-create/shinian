import type { EchoNote, TicketCadence, TicketPool, TicketResistance } from "./types";
import { isCaptureContextTag } from "./note-context";

export type TaskStatus = "none" | "pending" | "active" | "completed";
export type TaskAction = "queue" | "start" | "complete" | "reopen" | "dismiss" | "hold";

// Persist with the existing version-checked metadata write, so tasks share the
// same private storage, synchronization and backup contract as their notes.
const ACTIVE_TAG = "__shinian_task:active";
const COMPLETED_TAG = "__shinian_task:completed";
const PENDING_TAG = "__shinian_task:pending";
const DISMISSED_TAG = "__shinian_task:dismissed";
const POOL_PREFIX = "__shinian_pool:";
const DURATION_PREFIX = "__shinian_duration:";
const RESISTANCE_PREFIX = "__shinian_resistance:";
const CADENCE_PREFIX = "__shinian_cadence:";
const PREREQUISITE_PREFIX = "__shinian_prerequisite:";
export interface TicketMeta { pool?: TicketPool; durationMinutes?: 5 | 10 | 20 | 30 | 45 | 60; resistance?: TicketResistance; cadence?: TicketCadence; prerequisite?: string | null }
export const isTaskTag = (tag: string) => [PENDING_TAG, ACTIVE_TAG, COMPLETED_TAG, DISMISSED_TAG].includes(tag);
export const isTicketMetaTag = (tag: string) => tag.startsWith(POOL_PREFIX) || tag.startsWith(DURATION_PREFIX) || tag.startsWith(RESISTANCE_PREFIX) || tag.startsWith(CADENCE_PREFIX) || tag.startsWith(PREREQUISITE_PREFIX);
export const isSystemTag = (tag: string) => isTaskTag(tag) || isTicketMetaTag(tag) || isCaptureContextTag(tag);
export const visibleTags = (tags: string[]) => tags.filter(tag => !isSystemTag(tag));

export function ticketMeta(tags: string[]): Required<Pick<TicketMeta, "pool" | "durationMinutes" | "resistance" | "cadence">> & Pick<TicketMeta, "prerequisite"> {
  const poolValue = tags.find(tag => tag.startsWith(POOL_PREFIX))?.slice(POOL_PREFIX.length) as TicketPool | undefined;
  const durationValue = Number(tags.find(tag => tag.startsWith(DURATION_PREFIX))?.slice(DURATION_PREFIX.length));
  const resistanceValue = tags.find(tag => tag.startsWith(RESISTANCE_PREFIX))?.slice(RESISTANCE_PREFIX.length) as TicketResistance | undefined;
  const cadenceValue = tags.find(tag => tag.startsWith(CADENCE_PREFIX))?.slice(CADENCE_PREFIX.length) as TicketCadence | undefined;
  const prerequisiteValue = tags.find(tag => tag.startsWith(PREREQUISITE_PREFIX))?.slice(PREREQUISITE_PREFIX.length);
  return { pool: ["inbox", "one_time", "recurring", "waiting", "archive"].includes(poolValue || "") ? poolValue! : "inbox",
    durationMinutes: [5, 10, 20, 30, 45, 60].includes(durationValue) ? durationValue as NonNullable<TicketMeta["durationMinutes"]> : 20,
    resistance: ["low", "medium", "high"].includes(resistanceValue || "") ? resistanceValue! : "medium",
    cadence: ["none", "daily", "weekly", "monthly"].includes(cadenceValue || "") ? cadenceValue! : "none",
    prerequisite: prerequisiteValue || null };
}

export function ticketPool(note: Pick<EchoNote, "tags"> & Partial<Pick<EchoNote, "aiResult">>): TicketPool {
  const stored = ticketMeta(note.tags).pool;
  if (stored !== "inbox") return stored;
  return taskStatus(note) === "completed" ? "archive" : taskStatus(note) === "pending" || taskStatus(note) === "active" ? "one_time" : "inbox";
}

export function applyTicketMeta(tags: string[], meta: TicketMeta): string[] {
  const clean = tags.filter(tag => !isTicketMetaTag(tag));
  const next = [...clean];
  if (meta.pool) next.push(`${POOL_PREFIX}${meta.pool}`);
  if (meta.durationMinutes) next.push(`${DURATION_PREFIX}${meta.durationMinutes}`);
  if (meta.resistance) next.push(`${RESISTANCE_PREFIX}${meta.resistance}`);
  if (meta.cadence) next.push(`${CADENCE_PREFIX}${meta.cadence}`);
  if (meta.prerequisite?.trim()) next.push(`${PREREQUISITE_PREFIX}${meta.prerequisite.trim().slice(0, 300)}`);
  if (next.length > 30) throw new Error("标签已满，请先减少一个主题标签，再保存行动建议。");
  return [...new Set(next)];
}

export function taskStatus(note: Pick<EchoNote, "tags"> & Partial<Pick<EchoNote, "aiResult">>): TaskStatus {
  if (note.tags.includes(COMPLETED_TAG)) return "completed";
  if (note.tags.includes(ACTIVE_TAG)) return "active";
  if (note.tags.includes(DISMISSED_TAG)) return "none";
  return note.tags.includes(PENDING_TAG) || Boolean(note.aiResult?.actionItem) ? "pending" : "none";
}

export const taskLabels: Record<TaskStatus, string> = { none: "普通记录", pending: "想做", active: "进行中", completed: "已完成" };

export function taskTags(note: Pick<EchoNote, "tags">, action: TaskAction): string[] {
  const current = taskStatus(note);
  if ((action === "queue" && current !== "none") || (action === "start" && current !== "pending") || (action === "complete" && current !== "active") || (action === "reopen" && current !== "completed") || (action === "dismiss" && current !== "pending")) {
    throw new Error("事项状态已变化，请刷新后再试。");
  }
  const tags = note.tags.filter(tag => !isTaskTag(tag));
  if (tags.length >= 30) throw new Error("这条记录的标签已满，请先减少一个标签，再更新事项状态。");
  if (action === "hold") return tags;
  const next = action === "queue" ? PENDING_TAG : action === "complete" ? COMPLETED_TAG : action === "dismiss" ? DISMISSED_TAG : ACTIVE_TAG;
  return [...tags, next];
}

export function actionTicketCopy(note: Pick<EchoNote, "title" | "aiResult">) {
  return {
    title: note.aiResult?.actionItem?.title || note.title,
    nextStep: note.aiResult?.actionItem?.nextStep || "打开记录，先完成最小的一步。",
  };
}

/** Title/tag editing cannot silently reset a task's progress. */
export function preserveTaskTags(tags: string[], original: string[]): string[] {
  const next = [...visibleTags(tags), ...original.filter(isSystemTag)];
  if (next.length > 30) throw new Error("标签已满，请减少一个标签后保存，事项进度会保留。");
  return next;
}

export function ticketNumber(id: string): string {
  const hash = Array.from(id).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  return String(hash % 1_000_000).padStart(6, "0");
}
