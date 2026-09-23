/** These public-domain oil paintings are bundled locally. Provenance: public/artworks/credits.json. */
export const FLASHCARD_TAG = "闪卡收藏";

export const PAINTINGS = [
  {
    id: "vangogh-cypresses", title: "麦田与柏树", artist: "文森特·梵高", year: "1889", source: "https://www.metmuseum.org/art/collection/search/436535",
    palette: { name: "云蓝与柏树青", paper: "#a8c4c8", ink: "#173f43", accent: "#d4bb6e", glow: "#a9dce36b", sheen: "#f3dea62e", shade: "#153f4652", deep: "#071f23dc", border: "#dff2ef70" },
  },
  {
    id: "turner-saltash", title: "萨尔塔什渡口", artist: "J. M. W. 透纳", year: "1811", source: "https://www.metmuseum.org/art/collection/search/437852",
    palette: { name: "雾金与焦茶", paper: "#d2c39f", ink: "#4b2c20", accent: "#b8733d", glow: "#ebc9825c", sheen: "#fff2c42b", shade: "#5b351f4d", deep: "#24140fdf", border: "#f1d7a66b" },
  },
  {
    id: "sisley-bridge", title: "维尔纳夫拉加伦的桥", artist: "阿尔弗雷德·西斯莱", year: "1872", source: "https://www.metmuseum.org/art/collection/search/437680",
    palette: { name: "河蓝与桥石灰", paper: "#aac5cd", ink: "#304b52", accent: "#8d7758", glow: "#9ed9e86b", sheen: "#f1e4c92b", shade: "#284b5550", deep: "#10262cdf", border: "#d8edf173" },
  },
  {
    id: "pissarro-morning", title: "埃拉尼的清晨干草堆", artist: "卡米耶·毕沙罗", year: "1899", source: "https://www.metmuseum.org/art/collection/search/438738",
    palette: { name: "晨雾与草木绿", paper: "#afc2a1", ink: "#2f523b", accent: "#b98263", glow: "#c6dba964", sheen: "#f1d5b02b", shade: "#31533d4f", deep: "#13281bdf", border: "#e0e8c66b" },
  },
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
