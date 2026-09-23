import { DEFAULT_QUESTION, type EchoNote } from "./types";

export const REFLECTION_STAGE_LABELS = ["先说清楚", "再靠近自己", "落到下一步"] as const;

export function splitReflectionText(text: string): [string, string, string] {
  if (!text) return ["", "", ""];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return [lines[0] ?? "", lines[1] ?? "", lines.slice(2).join("\n")];
}

export function joinReflectionParts(parts: readonly string[]): string {
  const last = parts.findLastIndex(part => part.length > 0);
  return last < 0 ? "" : parts.slice(0, last + 1).join("\n");
}

export function guidedReflectionQuestions(note: EchoNote): [string, string, string] {
  const title = note.title.trim() || "这条想法";
  const aiQuestions = note.aiResult?.reflectionQuestions ?? [];
  const saved = note.reflectionPrompt.trim() && note.reflectionPrompt !== DEFAULT_QUESTION ? [note.reflectionPrompt.trim()] : [];
  const fallbacks = [
    `如果只用自己的话解释“${title}”，你会怎么说？`,
    "它和你此刻的经历、情绪或判断有什么联系？",
    "如果把它变成一个很小的行动，你最先会做什么？",
  ];
  const unique = [...new Set([...saved, ...aiQuestions.map(question => question.trim()).filter(Boolean), ...fallbacks])];
  return [unique[0], unique[1], unique[2]];
}
