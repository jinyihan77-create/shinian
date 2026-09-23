import { STAR_MATERIALS, starMaterial } from "./star-materials";

/** Browser-only artwork shared by the physical badge and its accessible fallback. */
export type CheckinArtworkOptions = {
  theme: number;
  mood: string;
  quote: string;
  totalDays: number;
  currentStreak: number;
  date: string;
  preview: boolean;
};
export { STAR_MATERIALS as CHECKIN_ART_THEMES } from "./star-materials";

const SIZE = 1024;
const WIDTH = 768;
const HEIGHT = 1024;
const ART_SCALE = 2;
const SCALE_X = WIDTH / SIZE;
const CENTER = SIZE / 2;
const SANS = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const SERIF = '"Songti SC", "Noto Serif CJK SC", "SimSun", serif';
type ArtTheme = (typeof STAR_MATERIALS)[number];

function seedFor(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function randomFrom(seed: number) {
  let state = seed || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(hex: string, alpha: number) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function cardPath(ctx: CanvasRenderingContext2D, inset = 0) {
  ctx.beginPath();
  const left = 34 + inset;
  const top = 28 + inset;
  const right = SIZE - 34 - inset;
  const bottom = SIZE - 28 - inset;
  const radius = Math.max(22, 52 - inset);
  ctx.moveTo(left + radius, top);
  ctx.lineTo(right - radius, top);
  ctx.quadraticCurveTo(right, top, right, top + radius);
  ctx.lineTo(right, bottom - radius);
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
  ctx.lineTo(left + radius, bottom);
  ctx.quadraticCurveTo(left, bottom, left, bottom - radius);
  ctx.lineTo(left, top + radius);
  ctx.quadraticCurveTo(left, top, left + radius, top);
  ctx.closePath();
}

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, strength: number) {
  const light = ctx.createRadialGradient(x, y, 0, x, y, radius);
  light.addColorStop(0, `rgba(${color}, ${strength})`);
  light.addColorStop(.45, `rgba(${color}, ${strength * .38})`);
  light.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = light;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function polygon(ctx: CanvasRenderingContext2D, points: number[][], color: string) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function glint(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number) {
  cloud(ctx, x, y, radius * 2.8, "255, 255, 255", alpha * .14);
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.quadraticCurveTo(x + radius * .12, y - radius * .12, x + radius * .7, y);
  ctx.quadraticCurveTo(x + radius * .12, y + radius * .12, x, y + radius);
  ctx.quadraticCurveTo(x - radius * .12, y + radius * .12, x - radius * .7, y);
  ctx.quadraticCurveTo(x - radius * .12, y - radius * .12, x, y - radius);
  ctx.fill();
}

/** Distinct structures: ground glass, crystal facets, pearl silk, rings, ice, gold dust, aurora. */
function paintFinish(ctx: CanvasRenderingContext2D, theme: ArtTheme, random: () => number) {
  if (theme.kind === "frost") {
    cloud(ctx, 268, 420, 340, "255, 255, 255", .55);
    cloud(ctx, 695, 720, 310, theme.secondary, .55);
    for (let index = 0; index < 17000; index++) {
      ctx.fillStyle = index % 3 ? "rgba(255, 255, 255, .075)" : "rgba(68, 99, 148, .025)";
      const radius = .4 + random() * .65;
      ctx.fillRect(random() * SIZE, random() * SIZE, radius, radius);
    }
    ctx.lineWidth = .75;
    for (let index = 0; index < 36; index++) {
      ctx.strokeStyle = `rgba(255,255,255,${.035 + index * .001})`;
      ctx.beginPath();
      ctx.moveTo(245 + index * 3, 92);
      ctx.bezierCurveTo(615, 215, 125, 363, 306 + index * 4, 482);
      ctx.stroke();
    }
  } else if (theme.kind === "crystal" || theme.kind === "ice") {
    const icy = theme.kind === "ice";
    polygon(ctx, [[511, 31], [612, 418], [365, 302]], "rgba(255,255,255,.27)");
    polygon(ctx, [[365, 302], [295, 582], [54, 363]], icy ? "rgba(205,255,255,.31)" : "rgba(249,235,255,.24)");
    polygon(ctx, [[970, 363], [717, 449], [665, 302]], "rgba(255,255,255,.32)");
    polygon(ctx, [[717, 449], [795, 901], [603, 696]], icy ? "rgba(140,175,239,.16)" : "rgba(169,155,213,.15)");
    polygon(ctx, [[229, 901], [349, 635], [512, 772]], "rgba(255,255,255,.30)");
    polygon(ctx, [[301, 579], [379, 454], [511, 31]], "rgba(255,255,255,.09)");
    ctx.strokeStyle = "rgba(255,255,255,.34)";
    ctx.lineWidth = 1.3;
    for (const points of [
      [[511, 65], [604, 391], [666, 314]],
      [[82, 370], [312, 437], [278, 573]],
      [[947, 372], [731, 455], [774, 846]],
      [[247, 850], [360, 656], [482, 753]],
    ]) {
      ctx.beginPath();
      points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.stroke();
    }
    if (icy) {
      ctx.lineWidth = .8;
      for (let index = 0; index < 95; index++) {
        const x = random() * SIZE;
        const y = random() * SIZE;
        if (x > 320 && x < 710 && y > 315 && y < 730) continue;
        ctx.strokeStyle = `rgba(255,255,255,${.16 + random() * .25})`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 4 + random() * 16, y - 8 - random() * 24);
        ctx.stroke();
      }
    }
  } else if (theme.kind === "pearl") {
    cloud(ctx, 245, 650, 440, "230, 185, 214", .58);
    cloud(ctx, 744, 330, 370, "235, 250, 223", .67);
    cloud(ctx, 690, 787, 300, "189, 221, 243", .53);
    for (let index = 0; index < 80; index++) {
      const ribbon = ctx.createLinearGradient(160, 210, 810, 760);
      ribbon.addColorStop(0, "rgba(255,255,255,.01)");
      ribbon.addColorStop(.35, `rgba(255,244,236,${.05 + Math.sin(index * .12) ** 2 * .10})`);
      ribbon.addColorStop(.68, "rgba(244,228,255,.13)");
      ribbon.addColorStop(1, "rgba(255,255,255,.02)");
      ctx.strokeStyle = ribbon;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-150, 275 + index * 5);
      ctx.bezierCurveTo(385, 56 + index * 5, 369, 726 + index * 3, 1100, 577 + index * 4);
      ctx.stroke();
    }
  } else if (theme.kind === "orbit") {
    cloud(ctx, 716, 359, 330, "255, 229, 196", .47);
    cloud(ctx, 289, 722, 300, "196, 211, 251", .47);
    ctx.save();
    ctx.translate(512, 526);
    ctx.rotate(-.42);
    for (let index = 0; index < 6; index++) {
      ctx.strokeStyle = `rgba(255,240,209,${.16 + index * .025})`;
      ctx.lineWidth = index === 2 ? 2.2 : .8;
      ctx.beginPath();
      ctx.ellipse(0, 0, 353 + index * 7, 133 + index * 5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  } else if (theme.kind === "sand") {
    cloud(ctx, 662, 192, 440, "255, 249, 219", .7);
    cloud(ctx, 321, 763, 330, "228, 171, 184", .3);
    for (let index = 0; index < 6700; index++) {
      const x = random() * SIZE;
      const y = random() * SIZE;
      const central = x > 330 && x < 700 && y > 330 && y < 715;
      const radius = .3 + random() * .85;
      ctx.fillStyle = index % 4 ? `rgba(255,251,225,${central ? .12 : .36})` : "rgba(173,125,65,.09)";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (theme.kind === "aurora") {
    for (let index = 0; index < 5; index++) {
      const ribbon = ctx.createLinearGradient(140, 260, 850, 800);
      ribbon.addColorStop(0, "rgba(211,188,246,0)");
      ribbon.addColorStop(.25, "rgba(223,196,252,.10)");
      ribbon.addColorStop(.52, "rgba(176,255,225,.21)");
      ribbon.addColorStop(.77, "rgba(255,207,232,.18)");
      ribbon.addColorStop(1, "rgba(227,222,255,0)");
      ctx.strokeStyle = ribbon;
      ctx.lineWidth = 35 + index * 9;
      ctx.beginPath();
      ctx.moveTo(20, 490 + index * 34);
      ctx.bezierCurveTo(388, 83 + index * 30, 577, 985 - index * 21, 996, 250 + index * 30);
      ctx.stroke();
    }
    for (let index = 0; index < 32; index++) {
      ctx.strokeStyle = `rgba(231,255,244,${.015 + random() * .035})`;
      ctx.lineWidth = .7;
      ctx.beginPath();
      ctx.moveTo(30, 568 + index * 3);
      ctx.bezierCurveTo(415, 128 + index * 4, 619, 871 - index * 3, 980, 380 + index * 2);
      ctx.stroke();
    }
  }
}

function paintBase(ctx: CanvasRenderingContext2D, theme: ArtTheme, seed: number, reverse: boolean) {
  const random = randomFrom(seed + (reverse ? 691 : 0));
  const base = ctx.createLinearGradient(192, 145, 816, 872);
  base.addColorStop(0, rgba(theme.accent, theme.opacity));
  base.addColorStop(.38, rgba(theme.base, theme.opacity));
  base.addColorStop(.78, `rgba(${theme.secondary}, ${theme.opacity})`);
  base.addColorStop(1, rgba(theme.accent, theme.opacity * .95));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  cloud(ctx, 407, 286, 355, "255, 255, 255", .24);
  cloud(ctx, 730, 615, 420, theme.glow, .27);
  paintFinish(ctx, theme, random);
  cloud(ctx, 512, 510, 315, "255, 255, 255", theme.kind === "ice" ? .24 : .20);
  for (let index = 0; index < 5500; index++) {
    ctx.fillStyle = index % 2 ? "rgba(255,255,255,.04)" : "rgba(73,59,91,.015)";
    ctx.fillRect(random() * SIZE, random() * SIZE, .4 + random() * .5, .4 + random() * .5);
  }
  for (let index = 0; index < 270; index++) {
    const x = random() * SIZE;
    const y = random() * SIZE;
    const central = x > 325 && x < 700 && y > 325 && y < 730;
    const alpha = (central ? .06 : .2) + random() * (central ? .12 : .52);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, .35 + random() * .8, 0, Math.PI * 2);
    ctx.fill();
  }
  const bevel = ctx.createLinearGradient(156, 118, 850, 890);
  bevel.addColorStop(0, "rgba(255,255,255,.95)");
  bevel.addColorStop(.24, "rgba(255,255,255,.60)");
  bevel.addColorStop(.45, rgba(theme.ink, .08));
  bevel.addColorStop(.66, "rgba(255,255,255,.63)");
  bevel.addColorStop(1, rgba(theme.ink, .14));
  ctx.lineJoin = "round";
  ctx.strokeStyle = bevel;
  ctx.lineWidth = 6;
  cardPath(ctx, 7);
  ctx.stroke();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = "rgba(255,255,255,.36)";
  cardPath(ctx, 25);
  ctx.stroke();
  for (const [x, y, size] of [[505, 146, 8], [156, 379, 6], [856, 390, 8], [267, 799, 7], [752, 805, 5]]) {
    glint(ctx, x + (random() - .5) * 13, y, size, .68);
  }
}

function centeredText(ctx: CanvasRenderingContext2D, text: string, y: number, font: string, color: string) {
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = font;
  ctx.shadowColor = "rgba(255,255,255,.26)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = "rgba(255,255,255,.22)";
  ctx.lineWidth = .7;
  ctx.strokeText(text, CENTER, y);
  ctx.fillStyle = color;
  ctx.fillText(text, CENTER, y);
}

function paintBrand(ctx: CanvasRenderingContext2D, theme: ArtTheme) {
  centeredText(ctx, "拾 念", 277, `500 29px ${SERIF}`, rgba(theme.ink, .9));
  centeredText(ctx, "S H I N I A N", 302, `400 11px ${SANS}`, rgba(theme.ink, .58));
  ctx.strokeStyle = rgba(theme.ink, .18);
  ctx.lineWidth = .9;
  ctx.beginPath();
  ctx.moveTo(CENTER - 34, 319);
  ctx.lineTo(CENTER + 34, 319);
  ctx.stroke();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const character of Array.from(paragraph)) {
      if (line && ctx.measureText(line + character).width > maxWidth) {
        lines.push(line);
        line = character;
      } else line += character;
    }
    lines.push(line);
  }
  return lines;
}

function paintFront(ctx: CanvasRenderingContext2D, theme: ArtTheme, options: CheckinArtworkOptions) {
  centeredText(ctx, "Q7 / 07", 188, `500 14px ${SANS}`, rgba(theme.ink, .52));
  const mood = options.mood.trim() || "此刻平静";
  const moodSize = Array.from(mood).length > 14 ? 32 : 38;
  ctx.font = `400 ${moodSize}px ${SANS}`;
  const moodLines = wrapText(ctx, mood, 390);
  moodLines.forEach((line, index) => centeredText(ctx, line, 363 + index * 38, `500 ${moodSize}px ${SANS}`, rgba(theme.ink, .88)));
  let quote = (options.quote.trim() || "把一点微光，留给明天的自己。").replaceAll("\r", "");
  quote = quote.replace(/\n\s*\n/g, "\n");
  if (quote.split("\n").length > 7) quote = quote.replace(/\s+/g, " ");
  const quoteTop = moodLines.length > 1 ? 448 : 412;
  const quoteBottom = 705;
  let fontSize = Array.from(quote).length <= 10 ? 82 : 68;
  let lines: string[] = [];
  while (fontSize >= 28) {
    ctx.font = `550 ${fontSize}px ${SERIF}`;
    lines = wrapText(ctx, quote, 490);
    if (lines.length * fontSize * 1.35 <= quoteBottom - quoteTop) break;
    fontSize -= 1;
  }
  const lineHeight = fontSize * 1.35;
  const firstBaseline = (quoteTop + quoteBottom - (lines.length - 1) * lineHeight) / 2 + fontSize * .32;
  lines.forEach((line, index) => centeredText(ctx, line, firstBaseline + index * lineHeight, `550 ${fontSize}px ${SERIF}`, theme.ink));
  const footerY = Math.max(724, Math.min(780, firstBaseline + (lines.length - 1) * lineHeight + 62));
  ctx.strokeStyle = rgba(theme.ink, .19);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(486, footerY - 15);
  ctx.lineTo(538, footerY - 15);
  ctx.stroke();
  centeredText(ctx, options.date.replaceAll("-", "."), footerY + 8, `400 17px ${SANS}`, rgba(theme.ink, .62));
  if (options.preview) centeredText(ctx, "演示牌 · 非真实记录", footerY + 36, `400 16px ${SANS}`, rgba(theme.ink, .64));
  centeredText(ctx, "KEEP A THOUGHT · KEEP A STAR.", 868, `400 13px ${SANS}`, rgba(theme.ink, .48));
}

function dayCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function paintBack(ctx: CanvasRenderingContext2D, theme: ArtTheme, options: CheckinArtworkOptions) {
  centeredText(ctx, "Q7 · PRIVATE ORBIT", 322, `500 13px ${SANS}`, rgba(theme.ink, .5));
  centeredText(ctx, "与自己相遇", 381, `400 25px ${SERIF}`, rgba(theme.ink, .8));
  const total = String(dayCount(options.totalDays)).padStart(2, "0");
  let fontSize = 127;
  ctx.font = `300 ${fontSize}px ${SANS}`;
  while (fontSize > 26 && ctx.measureText(total).width > 345) {
    fontSize -= 2;
    ctx.font = `300 ${fontSize}px ${SANS}`;
  }
  centeredText(ctx, total, 534, `300 ${fontSize}px ${SANS}`, theme.ink);
  centeredText(ctx, "累计打卡 · 天", 576, `400 22px ${SANS}`, rgba(theme.ink, .72));
  ctx.strokeStyle = rgba(theme.ink, .2);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CENTER - 36, 601);
  ctx.lineTo(CENTER + 36, 601);
  ctx.stroke();
  const streak = `连续相遇 ${dayCount(options.currentStreak)} 天`;
  let streakFont = 24;
  ctx.font = `400 ${streakFont}px ${SANS}`;
  while (streakFont > 12 && ctx.measureText(streak).width > 360) {
    streakFont -= 1;
    ctx.font = `400 ${streakFont}px ${SANS}`;
  }
  centeredText(ctx, streak, 637, `400 ${streakFont}px ${SANS}`, rgba(theme.ink, .82));
  centeredText(ctx, options.date.replaceAll("-", "."), 677, `400 17px ${SANS}`, rgba(theme.ink, .62));
  if (options.preview) centeredText(ctx, "演示牌 · 非真实记录", 708, `400 16px ${SANS}`, rgba(theme.ink, .64));
}

/** Rectangular, softly rounded PNGs shared by the physical badge and DOM fallback. */
export function createCheckinArtwork(options: CheckinArtworkOptions): { frontImage: string; backImage: string } {
  if (typeof document === "undefined") throw new Error("星空牌需要在浏览器中生成。");
  const rawTheme = Number.isFinite(options.theme) ? Math.floor(options.theme) : 0;
  const theme = starMaterial(rawTheme);
  const seed = seedFor(`${rawTheme}:${options.date}`);
  const render = (reverse: boolean) => {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH * ART_SCALE;
    canvas.height = HEIGHT * ART_SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前浏览器无法绘制星空牌，请刷新后重试。");
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.scale(SCALE_X * ART_SCALE, ART_SCALE);
    cardPath(ctx);
    ctx.clip();
    paintBase(ctx, theme, seed, reverse);
    paintBrand(ctx, theme);
    if (reverse) paintBack(ctx, theme, options);
    else paintFront(ctx, theme, options);
    ctx.restore();
    return canvas.toDataURL("image/png");
  };
  return { frontImage: render(false), backImage: render(true) };
}
