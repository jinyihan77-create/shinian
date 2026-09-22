import type { EchoNote } from "./types";

/** Local art direction only. No image generation or external requests occur here. */
export const TICKET_STYLES = [
  { id: "watercolour", name: "透明水彩", treatment: "透明色层、湿画法晕染、温润纸纹", accent: "#b6cfc5" },
  { id: "woodblock", name: "浮世绘木版", treatment: "清晰轮廓、平涂套色、柔和矿物色与木版纹理", accent: "#b4c9df" },
  { id: "collage", name: "剪纸拼贴", treatment: "有色纸张、手工裁切边缘、错落叠层与细微投影", accent: "#e3bca6" },
  { id: "ink", name: "东方水墨", treatment: "有节制的彩墨、浓淡墨色、大面积留白、宣纸质感", accent: "#b8c9bd" },
  { id: "impressionist", name: "印象派油彩", treatment: "可见的碎笔触、丰富但柔和的色彩、自然光的空气感", accent: "#d2c6a0" },
  { id: "risograph", name: "双色孔版印刷", treatment: "两至三色叠印、轻微套印偏移、细密油墨颗粒", accent: "#cfb6db" },
  { id: "nouveau", name: "新艺术装饰", treatment: "流动植物曲线、精细装饰线条、低饱和宝石色", accent: "#cfbd8d" },
  { id: "geometric", name: "几何构成", treatment: "简洁几何形、节奏均衡的构图、克制的色块", accent: "#a9c3dc" },
  { id: "surreal", name: "超现实梦境", treatment: "物体的诗意组合、梦境空间、柔和光线与细腻质感", accent: "#c5b5e0" },
  { id: "pastel", name: "粉彩速写", treatment: "柔软的粉彩笔触、可见的纸张颗粒、松弛而明确的轮廓", accent: "#dcb7c1" },
  { id: "travel", name: "复古旅行海报", treatment: "平面插画构图、温暖的旧纸色、低对比套色印刷", accent: "#c4c99b" },
  { id: "pixel", name: "像素风景", treatment: "精心排列的像素、有限色板、细微的光影层次", accent: "#b1b8e0" },
] as const;

const SCENES = [
  { words: /阅读|读书|书籍|读完|书单/, scene: "窗边翻开的书，书页延伸成一条通向远山的小径", styles: [0, 4, 9] },
  { words: /跑步|运动|健身|散步|走一走|习惯|坚持/, scene: "晨光下向远方延伸的小路，每一枚足迹旁长出一片新叶", styles: [1, 4, 10] },
  { words: /旅行|旅途|出发|远方|海边|城市/, scene: "一扇打开的车窗，将远方的山海和城市收进同一个画框", styles: [1, 10, 0] },
  { words: /朋友|家人|陪伴|沟通|关系|交流/, scene: "两把相向的椅子，一束温暖的光在它们之间轻轻落下", styles: [2, 9, 6] },
  { words: /情绪|焦虑|休息|睡眠|内心|平静|冥想/, scene: "静谧湖面托着一盏小灯，微风将波纹慢慢推向岸边", styles: [0, 3, 8] },
  { words: /学习|理解|知识|记忆|大脑|思考/, scene: "散落的纸片成为一座桥，连接夜色中的两座小岛", styles: [2, 7, 8] },
  { words: /工作|项目|计划|目标|效率|任务|整理|门槛|开始做事/, scene: "散落的细小积木逐渐搭成阶梯，通向一扇微亮的窗", styles: [7, 5, 11] },
  { words: /播客|音乐|听|声音|节奏/, scene: "一圈圈声音涟漪化成彩色地形，细线连接远处的星点", styles: [5, 8, 11] },
  { words: /创作|写作|画画|设计|灵感|想法/, scene: "一粒落在纸上的种子，长成形状各异的花与彩色纸片", styles: [6, 2, 5] },
] as const;

function hash(text: string) {
  return [...text].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
}

export function ticketArtDirection(note: Pick<EchoNote, "id" | "title" | "userText" | "sourceExcerpt">) {
  const text = `${note.title} ${note.userText} ${note.sourceExcerpt}`;
  const seed = hash(`${note.id}:${text}`);
  const match = SCENES.find(item => item.words.test(text));
  const style = TICKET_STYLES[match ? match.styles[seed % match.styles.length] : seed % TICKET_STYLES.length];
  return {
    status: "pending" as const,
    style,
    scene: match?.scene ?? "一枚被风吹起的纸片，停在光线温柔的窗台，远处留出开放的风景",
    serial: String(hash(note.id) % 1000000).padStart(6, "0"),
  };
}
