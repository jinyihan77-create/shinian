export const shinianOrbVertex = `#version 300 es
in vec2 position;
out vec2 vUv;

void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const shinianOrbFragment = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uTime;

in vec2 vUv;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0)), f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.54;
  mat3 turn = mat3(
    0.00, 0.80, 0.60,
   -0.80, 0.36,-0.48,
   -0.60,-0.48, 0.64
  );
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise3(p);
    p = turn * p * 2.03 + vec3(7.1, 3.4, 5.7);
    amplitude *= 0.49;
  }
  return value;
}

vec3 palette(float t) {
  vec3 rose = vec3(0.91, 0.50, 0.68);
  vec3 violet = vec3(0.48, 0.34, 0.66);
  vec3 pearl = vec3(0.99, 0.91, 0.97);
  vec3 moon = vec3(0.49, 0.71, 0.80);
  vec3 color = mix(violet, rose, smoothstep(0.08, 0.72, t));
  color = mix(color, pearl, smoothstep(0.70, 1.0, t) * 0.42);
  return mix(color, moon, smoothstep(0.88, 1.0, t) * 0.24);
}

void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * 2.0;
  p.x *= uResolution.x / max(uResolution.y, 1.0);

  vec2 pointer = (uPointer - 0.5) * 2.0;
  vec2 center = vec2(pointer.x * 0.055, pointer.y * 0.04 - 0.015);
  vec2 q = p - center;
  float radiusFromCenter = length(q);
  float angle = atan(q.y, q.x);

  float slowTime = uTime * 0.12;
  float edgeFlow = fbm(vec3(cos(angle) * 1.8, sin(angle) * 1.8, slowTime));
  float fineFlow = fbm(vec3(q * 4.1, slowTime * 1.7 + 4.0));
  float orbRadius = 0.50 + (edgeFlow - 0.50) * 0.095 + (fineFlow - 0.5) * 0.025;
  float body = smoothstep(orbRadius + 0.022, orbRadius - 0.018, radiusFromCenter);

  float normalizedRadius = radiusFromCenter / max(orbRadius, 0.001);
  float z = sqrt(max(0.0, 1.0 - normalizedRadius * normalizedRadius));
  vec3 normal = normalize(vec3(q / max(orbRadius, 0.001), z));
  vec3 lightDirection = normalize(vec3(-0.38 + pointer.x * 0.28, 0.52 + pointer.y * 0.17, 0.84));
  float diffuse = max(dot(normal, lightDirection), 0.0);
  float opposite = max(dot(normal, normalize(vec3(0.66, -0.32, 0.68))), 0.0);
  float rim = pow(1.0 - z, 2.25);
  float specular = pow(max(dot(reflect(-lightDirection, normal), vec3(0.0, 0.0, 1.0)), 0.0), 26.0);

  float innerA = fbm(vec3(q * 2.25 + vec2(slowTime * 0.18, -slowTime * 0.11), slowTime));
  float innerB = fbm(vec3(q.yx * 3.9 + vec2(-slowTime * 0.2, slowTime * 0.15), slowTime + 8.0));
  float inner = clamp(innerA * 0.69 + innerB * 0.31, 0.0, 1.0);
  vec3 orb = palette(inner);
  orb *= 0.38 + diffuse * 0.72 + opposite * 0.20;
  orb += vec3(1.0, 0.78, 0.91) * rim * (0.22 + edgeFlow * 0.43);
  orb += vec3(1.0, 0.93, 0.98) * specular * 0.78;
  orb += vec3(0.47, 0.72, 0.84) * opposite * 0.12;

  float haloDistance = abs(radiusFromCenter - orbRadius);
  float halo = exp(-haloDistance * 20.0) * (1.0 - body * 0.38);
  float outerSmoke = fbm(vec3(q * 1.42, slowTime * 0.8 + 14.0));
  float smokeMask = smoothstep(0.88, 0.18, radiusFromCenter) * (1.0 - body * 0.76);
  float smoke = smoothstep(0.52, 0.88, outerSmoke) * smokeMask;

  vec3 background = vec3(0.052, 0.036, 0.070);
  background += vec3(0.19, 0.08, 0.16) * exp(-length(p - vec2(-0.7, 0.32)) * 2.6) * 0.24;
  background += vec3(0.10, 0.13, 0.21) * exp(-length(p - vec2(0.72, -0.28)) * 2.9) * 0.23;

  vec2 starCell = floor((p + 2.0) * 64.0);
  float starSeed = hash21(starCell);
  float star = step(0.9925, starSeed) * pow(max(0.0, sin(uTime * (0.45 + starSeed) + starSeed * 23.0)), 8.0);
  star *= smoothstep(1.35, 0.5, radiusFromCenter);

  vec3 color = background;
  color += vec3(0.83, 0.44, 0.66) * smoke * 0.20;
  color += vec3(0.91, 0.67, 0.84) * halo * 0.26;
  color = mix(color, orb, body * 0.94);
  color += vec3(1.0, 0.91, 0.97) * star * 0.62;

  float vignette = smoothstep(1.55, 0.44, length(p * vec2(0.72, 0.92)));
  color *= 0.68 + vignette * 0.32;
  color = pow(max(color, 0.0), vec3(0.93));
  fragColor = vec4(color, 1.0);
}
`;
