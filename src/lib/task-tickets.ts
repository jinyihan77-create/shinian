import type { EchoNote } from "./types";
import { isCaptureContextTag } from "./note-context";

export type TaskStatus = "pending" | "active" | "completed";
export type TaskAction = "start" | "complete" | "reopen";

// Persist with the existing version-checked metadata write, so tasks share the
// same private storage, synchronization and backup contract as their notes.
const ACTIVE_TAG = "__shinian_task:active";
const COMPLETED_TAG = "__shinian_task:completed";
export const isTaskTag = (tag: string) => tag === ACTIVE_TAG || tag === COMPLETED_TAG;
export const isSystemTag = (tag: string) => isTaskTag(tag) || isCaptureContextTag(tag);
export const visibleTags = (tags: string[]) => tags.filter(tag => !isSystemTag(tag));

export function taskStatus(note: Pick<EchoNote, "tags">): TaskStatus {
  if (note.tags.includes(COMPLETED_TAG)) return "completed";
  return note.tags.includes(ACTIVE_TAG) ? "active" : "pending";
}

export const taskLabels: Record<TaskStatus, string> = { pending: "待开始", active: "进行中", completed: "已完成" };

export function taskTags(note: Pick<EchoNote, "tags">, action: TaskAction): string[] {
  const current = taskStatus(note);
  if ((action === "start" && current !== "pending") || (action === "complete" && current !== "active") || (action === "reopen" && current !== "completed")) {
    throw new Error("事项状态已变化，请刷新后再试。");
  }
  const tags = note.tags.filter(tag => !isTaskTag(tag));
  if (tags.length >= 30) throw new Error("这条记录的标签已满，请先减少一个标签，再更新事项状态。");
  return [...tags, action === "complete" ? COMPLETED_TAG : ACTIVE_TAG];
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
