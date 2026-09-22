import type { EchoNote } from "./types";
import { taskStatus, visibleTags } from "./task-tickets";

export type LibraryFilter = "all" | "departure" | "arrival";
export interface SearchMatch { note: EchoNote; snippet: string; matchedField: string }

function fieldsFor(note: EchoNote): { name: string; value: string }[] {
  return [
    { name: "标题", value: note.title },
    { name: "我的原始想法", value: note.userText },
    { name: "来源名称", value: note.sourceName },
    { name: "来源片段", value: note.sourceExcerpt },
    { name: "我自己的理解", value: note.reflectionText },
    { name: "标签", value: visibleTags(note.tags).join(" · ") },
    { name: "来源链接", value: note.sourceUrl },
    { name: "来源时间点", value: note.sourceTimestamp },
    { name: "来源类型", value: note.sourceType },
    { name: "思考问题", value: note.reflectionPrompt },
    ...(note.aiResult ? [
      { name: "AI 标题建议", value: note.aiResult.title },
      { name: "AI 想法整理", value: note.aiResult.thoughtSummary },
      { name: "AI 来源片段整理", value: note.aiResult.sourceSummary || "" },
      ...note.aiResult.keyPoints.map(point => ({ name: `AI 要点 · ${point.origin}`, value: point.text })),
      { name: "AI 标签建议", value: note.aiResult.tags.join(" · ") },
      ...note.aiResult.reflectionQuestions.map(value => ({ name: "AI 思考问题", value })),
      { name: "可尝试的应用", value: note.aiResult.possibleApplication || "" },
    ] : []),
  ];
}

function excerpt(text: string, position = 0): string {
  const beginning = Math.max(0, position - 28);
  const ending = Math.min(text.length, beginning + 150);
  return `${beginning > 0 ? "…" : ""}${text.slice(beginning, ending).replace(/\s+/g, " ")}${ending < text.length ? "…" : ""}`;
}

/** Space-separated words use AND matching, and may appear in different fields. */
export function searchNotes(
  notes: EchoNote[],
  query: string,
  filter: LibraryFilter = "all",
  tag = "",
  sort: "created" | "updated" = "created",
): SearchMatch[] {
  const words = [...new Set(query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean))];
  return notes.filter(note => {
    if (filter === "departure" && taskStatus(note) === "completed") return false;
    if (filter === "arrival" && taskStatus(note) !== "completed") return false;
    return !tag || note.tags.includes(tag);
  }).flatMap(note => {
    const fields = fieldsFor(note);
    if (words.length > 0) {
      const searchable = fields.map(field => field.value.toLocaleLowerCase());
      if (!words.every(word => searchable.some(value => value.includes(word)))) return [];
      // Show the field containing the most query words. Ties keep the natural
      // reading order, with a real snippet from the field that actually matched.
      const ranked = fields.map((field, index) => ({
        ...field, index, matches: words.filter(word => field.value.toLocaleLowerCase().includes(word)),
      })).filter(field => field.matches.length > 0).sort((a, b) => b.matches.length - a.matches.length || a.index - b.index);
      const best = ranked[0];
      const position = Math.min(...best.matches.map(word => best.value.toLocaleLowerCase().indexOf(word)));
      return [{ note, snippet: excerpt(best.value, position), matchedField: best.name }];
    }
    const snippet = note.aiResult?.thoughtSummary || note.userText || note.aiResult?.sourceSummary || note.sourceExcerpt || note.sourceName || "已保存来源，等你补充想法。";
    return [{ note, snippet: excerpt(snippet), matchedField: "" }];
  }).sort((a, b) => {
    const key = sort === "updated" ? "updatedAt" : "createdAt";
    return b.note[key].localeCompare(a.note[key]) || b.note.id.localeCompare(a.note.id);
  });
}
