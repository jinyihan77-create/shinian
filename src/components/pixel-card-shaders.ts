// Bayer/noise/ripple functions adapted from React Bits PixelBlast (David Haz),
// inspired by zavalit/bayer-dithering-webgl-demo. See public/licenses/react-bits.txt.
// Liquid displacement and the alternating pearl glitter pass are local additions.
export const vertex = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

export const fragment = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uDpr;
uniform float uTime;
uniform float uBlend;
uniform float uPixelSize;
uniform vec3 uColor;
uniform vec2 uPointer;
uniform float uPointerStrength;
uniform vec3 uClicks[6];
out vec4 fragColor;

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return hash(dot(p, vec2(127.1, 311.7))); }
float bayer2(vec2 p) { p = floor(p); return fract(p.x / 2.0 + p.y * p.y * 0.75); }
float bayer4(vec2 p) { return bayer2(p * 0.5) * 0.25 + bayer2(p); }
float bayer8(vec2 p) { return bayer4(p * 0.5) * 0.25 + bayer2(p); }
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n = dot(i, vec3(1.0, 57.0, 113.0));
  return mix(mix(mix(hash(n), hash(n + 1.0), f.x),
                 mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y),
             mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
                 mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y), f.z) * 2.0 - 1.0;
}
float field(vec2 uv, float t) {
  vec3 p = vec3(uv * 3.0, t);
  float sum = 1.0, frequency = 1.0;
  for (int i = 0; i < 5; i++) { sum += noise3(p * frequency); frequency *= 1.25; }
  return sum * 0.5 + 0.5;
}

void main() {
  vec2 size = uResolution / uDpr;
  vec2 screen = gl_FragCoord.xy / uDpr;
  vec2 norm = screen / size;
  vec2 pointerDelta = (screen - uPointer * size) / size.y;
  float influence = exp(-dot(pointerDelta, pointerDelta) / 0.12) * uPointerStrength;
  // A soft, local liquid bend; it never displaces the foreground text.
  vec2 liquid = vec2(sin(pointerDelta.y * 9.0 + uTime * 5.0),
                     cos(pointerDelta.x * 8.0 + uTime * 5.0)) * influence * 0.12;
  vec2 coord = screen - size * 0.5 + liquid * size.y;
  float pixelSize = uPixelSize;
  vec2 pixelId = floor(coord / pixelSize);
  vec2 pixelUV = fract(coord / pixelSize);
  vec2 cellCoord = floor(coord / (8.0 * pixelSize)) * (8.0 * pixelSize);
  vec2 uv = cellCoord / size.y;
  float feed = field(uv, uTime * 0.05) * 0.5 - 0.65 + (1.2 - 0.5) * 0.3;
  float rippleGlow = 0.0;
  for (int i = 0; i < 6; i++) {
    if (uClicks[i].z < 0.0) continue;
    float t = max(uTime - uClicks[i].z, 0.0);
    float r = length(uv - (uClicks[i].xy * size - size * 0.5) / size.y);
    float ring = exp(-pow((r - 0.4 * t) / 0.12, 2.0));
    float wave = ring * exp(-t) * exp(-10.0 * r) * 1.5;
    feed = max(feed, wave);
    rippleGlow = max(rippleGlow, wave);
  }
  float coverage = step(0.5, feed + bayer8(coord / pixelSize) - 0.5);
  coverage *= 1.0 + (hash2(pixelId) - 0.5) * 0.5;
  float distanceToDot = length(pixelUV - 0.5) - sqrt(coverage) * 0.25;
  float aa = max(fwidth(distanceToDot), 0.01);
  float pixels = coverage * (1.0 - smoothstep(-aa, aa, distanceToDot)) * 0.62;

  // Randomly positioned micro-grains, rather than another regular pixel grid.
  vec2 grainCoord = (screen + liquid * size.y * 0.2) / 4.2;
  vec2 grainCell = floor(grainCoord);
  float seed = hash2(grainCell);
  vec2 center = vec2(hash2(grainCell + 23.0), hash2(grainCell + 91.0)) * 0.7 + 0.15;
  float distanceToGrain = length(fract(grainCoord) - center) * 4.2;
  float pulse = pow(0.5 + 0.5 * sin(uTime * (0.7 + seed) + seed * 65.0), 7.0);
  float radius = mix(0.2, 0.58, seed);
  float grain = exp(-pow(distanceToGrain / radius, 2.0));
  float glitter = grain * (0.07 + pulse * 0.64 + rippleGlow * 0.18);
  glitter *= smoothstep(0.15, 0.4, seed);
  vec3 pearl = mix(vec3(0.81, 0.68, 0.80), vec3(0.92, 0.88, 0.98), seed);

  float edge = min(min(norm.x, norm.y), min(1.0 - norm.x, 1.0 - norm.y));
  float fade = smoothstep(0.0, 0.25, edge);
  float alpha = mix(pixels, glitter, uBlend) * fade;
  fragColor = vec4(mix(uColor, pearl, uBlend), alpha);
}
`;
