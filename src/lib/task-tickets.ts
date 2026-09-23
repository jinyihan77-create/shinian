import type { EchoNote } from "./types";
import { isCaptureContextTag } from "./note-context";

export type TaskStatus = "none" | "pending" | "active" | "completed";
export type TaskAction = "queue" | "start" | "complete" | "reopen" | "dismiss";

// Persist with the existing version-checked metadata write, so tasks share the
// same private storage, synchronization and backup contract as their notes.
const ACTIVE_TAG = "__shinian_task:active";
const COMPLETED_TAG = "__shinian_task:completed";
const PENDING_TAG = "__shinian_task:pending";
const DISMISSED_TAG = "__shinian_task:dismissed";
export const isTaskTag = (tag: string) => [PENDING_TAG, ACTIVE_TAG, COMPLETED_TAG, DISMISSED_TAG].includes(tag);
export const isSystemTag = (tag: string) => isTaskTag(tag) || isCaptureContextTag(tag);
export const visibleTags = (tags: string[]) => tags.filter(tag => !isSystemTag(tag));

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
