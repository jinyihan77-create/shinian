/** Shared finishes: a picked star keeps its material on both faces. */
export const STAR_MATERIALS = [
  { name: "月雾玻璃", kind: "frost", base: "#a9bbdf", glow: "168, 192, 241", secondary: "199, 177, 226", accent: "#dceaff", ink: "#283854", roughness: .48, metalness: .08, opacity: .91, halo: false },
  { name: "蔷薇水晶", kind: "crystal", base: "#dcaecb", glow: "243, 174, 213", secondary: "170, 192, 239", accent: "#ffe0f0", ink: "#583349", roughness: .12, metalness: .18, opacity: .83, halo: false },
  { name: "贝母流光", kind: "pearl", base: "#dae3d5", glow: "209, 241, 225", secondary: "220, 189, 236", accent: "#f4fae9", ink: "#344f54", roughness: .29, metalness: .24, opacity: .98, halo: false },
  { name: "土星光环", kind: "orbit", base: "#c5b3e8", glow: "209, 188, 249", secondary: "236, 200, 151", accent: "#f2e2ff", ink: "#493b65", roughness: .21, metalness: .22, opacity: .94, halo: true },
  { name: "冰海琉璃", kind: "ice", base: "#91cdd7", glow: "152, 230, 237", secondary: "175, 182, 240", accent: "#d6fbff", ink: "#234c61", roughness: .09, metalness: .16, opacity: .82, halo: false },
  { name: "香槟星砂", kind: "sand", base: "#e4cda7", glow: "255, 223, 167", secondary: "226, 178, 201", accent: "#fff0d4", ink: "#634c36", roughness: .35, metalness: .27, opacity: .97, halo: false },
  { name: "极光薄纱", kind: "aurora", base: "#b7badf", glow: "174, 228, 219", secondary: "226, 169, 224", accent: "#e9e0ff", ink: "#3c4166", roughness: .2, metalness: .12, opacity: .86, halo: true },
] as const;

export function starMaterial(theme: number) {
  const index = Number.isFinite(theme) ? Math.floor(theme) : 0;
  return STAR_MATERIALS[((index % STAR_MATERIALS.length) + STAR_MATERIALS.length) % STAR_MATERIALS.length];
}

/** Broad five-point silhouette leaves a useful central writing area. */
export const STAR_POINTS = Array.from({ length: 10 }, (_, index) => {
  const angle = -Math.PI / 2 + index * Math.PI / 5;
  const radius = index % 2 ? .54 : 1;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
});
export const STAR_CLIP = `polygon(${STAR_POINTS.map(p => `${50 + p.x * 47}% ${50 + p.y * 47}%`).join(",")})`;

/** The seven-point silhouette used by the final daily star note. */
export const SEVEN_STAR_POINTS = Array.from({ length: 14 }, (_, index) => {
  const angle = -Math.PI / 2 + index * Math.PI / 7;
  const radius = index % 2 ? .48 : 1;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
});

export function starPath(points: readonly { x: number; y: number }[], center = 50, scale = 46) {
  return `${points.map((point, index) => `${index ? "L" : "M"}${center + point.x * scale} ${center + point.y * scale}`).join(" ")}Z`;
}
