/** These public-domain oil paintings are bundled locally. Provenance: public/artworks/credits.json. */
export const FLASHCARD_TAG = "闪卡收藏";

export const PAINTINGS = [
  { id: "vangogh-cypresses", title: "麦田与柏树", artist: "文森特·梵高", year: "1889", source: "https://www.metmuseum.org/art/collection/search/436535" },
  { id: "turner-saltash", title: "萨尔塔什渡口", artist: "J. M. W. 透纳", year: "1811", source: "https://www.metmuseum.org/art/collection/search/437852" },
  { id: "sisley-bridge", title: "维尔纳夫拉加伦的桥", artist: "阿尔弗雷德·西斯莱", year: "1872", source: "https://www.metmuseum.org/art/collection/search/437680" },
  { id: "pissarro-morning", title: "埃拉尼的清晨干草堆", artist: "卡米耶·毕沙罗", year: "1899", source: "https://www.metmuseum.org/art/collection/search/438738" },
] as const;

// Deterministic across devices, renders and revisits; no artwork choice is lost on refresh.
export function paintingForNote(id: string) {
  const seed = Array.from(id).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0);
  return PAINTINGS[seed % PAINTINGS.length];
}

/** New lines define thoughts. Legacy single-paragraph notes can use sentence punctuation.
 * Never truncate or rewrite the user's words, including thoughts beyond the first three. */
export function reflectionThoughts(text: string): string[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length !== 1) return lines;
  return lines[0].match(/[^。！？!?]+[。！？!?]*|[。！？!?]+/g)?.map(line => line.trim()).filter(Boolean) ?? lines;
}

export function withFlashcardFavorite(tags: string[], favorite: boolean): string[] {
  const next = tags.filter(tag => tag !== FLASHCARD_TAG);
  if (favorite) {
    if (next.length >= 30) throw new Error("这条灵感的标签已满，请先移除一个标签，再收藏闪卡。");
    next.push(FLASHCARD_TAG);
  }
  return next;
}
