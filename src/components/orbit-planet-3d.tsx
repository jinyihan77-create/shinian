"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { starMaterial } from "@/lib/star-materials";
import styles from "./daily-orbit.module.css";

export type PlanetThought = {
  id: string;
  title: string;
  excerpt: string;
  source?: string;
};

type OrbitPlanet3DProps = {
  theme: number;
  thoughts: readonly PlanetThought[];
  selectedThought: number | null;
  onSelectThought: (index: number) => void;
  paused?: boolean;
  reduceMotion?: boolean;
};

const LANDMARKS = [
  { latitude: .45, longitude: -.92 },
  { latitude: .15, longitude: -.45 },
  { latitude: -.22, longitude: -.08 },
  { latitude: .36, longitude: .35 },
  { latitude: -.42, longitude: .7 },
  { latitude: .02, longitude: 1.02 },
] as const;

const PLANET_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The surface is procedural so rotation never exposes a texture seam. The same
// noise vocabulary is reused by the cloud shell and the thought particles.
const PLANET_FRAGMENT_SHADER = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  uniform float time;
  uniform vec3 baseColor;
  uniform vec3 accentColor;
  uniform vec3 secondaryColor;
  uniform vec3 glowColor;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
    float x00 = mix(n000, n100, f.x);
    float x10 = mix(n010, n110, f.x);
    float x01 = mix(n001, n101, f.x);
    float x11 = mix(n011, n111, f.x);
    return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
  }

  float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += noise3(p) * amplitude;
      p = p * 2.03 + vec3(7.2, 3.1, 5.4);
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 flowPosition = vPosition * 1.48 + vec3(time * 0.035, -time * 0.018, time * 0.022);
    float flow = fbm(flowPosition);
    float detail = fbm(vPosition * 3.4 - vec3(time * 0.045, time * 0.032, 0.0));
    float cloud = smoothstep(0.34, 0.78, flow + detail * 0.22);
    float band = sin((vPosition.y + flow * 0.18 + time * 0.012) * 8.5) * 0.5 + 0.5;
    float light = max(dot(normal, normalize(vec3(-0.28, 0.5, 1.0))), 0.0);
    float rim = pow(1.0 - max(dot(normal, vec3(0.0, 0.0, 1.0)), 0.0), 2.35);
    vec3 body = mix(baseColor * 0.33, secondaryColor * 0.76, smoothstep(0.18, 0.72, flow));
    body = mix(body, accentColor, cloud * 0.42);
    body += secondaryColor * band * 0.075;
    vec3 color = body * (0.48 + light * 0.72) + glowColor * rim * 0.52;
    gl_FragColor = vec4(color, 0.94 + rim * 0.05);
  }
`;

const CLOUD_VERTEX_SHADER = PLANET_VERTEX_SHADER;
const CLOUD_FRAGMENT_SHADER = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  uniform float time;
  uniform vec3 accentColor;
  uniform vec3 secondaryColor;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), f.x);
    float b = mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x);
    float c = mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x);
    float d = mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
  }

  void main() {
    float cloud = smoothstep(0.55, 0.84, noise3(vPosition * 2.8 + vec3(time * 0.02, -time * 0.015, 0.0)));
    float rim = pow(1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0), 1.8);
    vec3 color = mix(secondaryColor, accentColor, cloud);
    gl_FragColor = vec4(color, cloud * 0.13 + rim * 0.055);
  }
`;

const ATMOSPHERE_FRAGMENT_SHADER = `
  varying vec3 vNormal;
  uniform vec3 glowColor;
  void main() {
    float rim = pow(1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0), 2.45);
    gl_FragColor = vec4(glowColor, rim * 0.34);
  }
`;

const PARTICLE_VERTEX_SHADER = `
  attribute float aSize;
  attribute float aPhase;
  attribute float aTone;
  uniform float time;
  uniform vec3 pointer;
  uniform float pointerStrength;
  varying vec3 vColor;
  void main() {
    vec3 positionOffset = normalize(position) * sin(time * 0.42 + aPhase) * 0.055;
    vec3 nextPosition = position + positionOffset;
    vec3 towardPointer = pointer - nextPosition;
    float distanceToPointer = length(towardPointer);
    float pull = smoothstep(2.35, 0.12, distanceToPointer) * pointerStrength;
    nextPosition += normalize(towardPointer + vec3(0.0001)) * pull * 0.22;
    vec4 mvPosition = modelViewMatrix * vec4(nextPosition, 1.0);
    gl_PointSize = aSize * (310.0 / max(1.0, -mvPosition.z));
    gl_Position = projectionMatrix * mvPosition;
    vec3 rose = vec3(0.91, 0.59, 0.78);
    vec3 lilac = vec3(0.66, 0.62, 0.98);
    vec3 pearl = vec3(0.91, 0.88, 1.0);
    vColor = aTone < 0.5 ? rose : (aTone < 1.5 ? lilac : pearl);
  }
`;

const PARTICLE_FRAGMENT_SHADER = `
  varying vec3 vColor;
  void main() {
    float distanceToCenter = length(gl_PointCoord - vec2(0.5));
    float alpha = smoothstep(0.5, 0.04, distanceToCenter);
    float core = smoothstep(0.18, 0.0, distanceToCenter);
    gl_FragColor = vec4(vColor * (0.72 + core * 0.85), alpha * 0.7);
  }
`;

function seededRandom(seed: number) {
  let value = seed || 1;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function landmarkPosition(index: number) {
  const point = LANDMARKS[index % LANDMARKS.length];
  const radius = 2.21;
  const horizontal = Math.cos(point.latitude);
  return new THREE.Vector3(
    radius * horizontal * Math.sin(point.longitude),
    radius * Math.sin(point.latitude),
    radius * horizontal * Math.cos(point.longitude),
  );
}

function createGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(.14, "rgba(255,221,247,.94)");
  gradient.addColorStop(.42, "rgba(220,176,255,.26)");
  gradient.addColorStop(1, "rgba(220,176,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createThoughtParticles(theme: number) {
  const count = 980;
  const random = seededRandom(theme * 7919 + 411);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const tones = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const radius = 2.45 + random() * 0.88;
    const sinPhi = Math.sin(phi);
    positions[index * 3] = radius * sinPhi * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi) * 0.86;
    positions[index * 3 + 2] = radius * sinPhi * Math.sin(theta);
    sizes[index] = 1.2 + random() * 2.45;
    phases[index] = random() * Math.PI * 2;
    tones[index] = random() > .78 ? 2 : random() > .45 ? 1 : 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("aTone", new THREE.BufferAttribute(tones, 1));
  const uniforms = {
    time: { value: 0 },
    pointer: { value: new THREE.Vector3(0, 0, 9) },
    pointerStrength: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: PARTICLE_VERTEX_SHADER,
    fragmentShader: PARTICLE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return { points: new THREE.Points(geometry, material), uniforms };
}

export function OrbitPlanet3D({ theme, thoughts, selectedThought, onSelectThought, paused = false, reduceMotion = false }: OrbitPlanet3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const labelHoldRef = useRef(false);
  const selectedRef = useRef(selectedThought);
  const [ready, setReady] = useState(false);
  const visibleThoughts = useMemo(() => thoughts.slice(0, LANDMARKS.length), [thoughts]);

  useEffect(() => { selectedRef.current = selectedThought; }, [selectedThought]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || navigator.userAgent.toLowerCase().includes("jsdom")) return;
    const palette = starMaterial(theme);
    const baseColor = new THREE.Color(palette.base);
    const accentColor = new THREE.Color(palette.accent);
    const secondaryColor = new THREE.Color(`rgb(${palette.secondary})`);
    const glowColor = new THREE.Color(`rgb(${palette.glow})`).lerp(new THREE.Color("#f1c5df"), .32);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .94;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    camera.position.set(0, .08, 8.15);

    const planetGroup = new THREE.Group();
    planetGroup.position.y = -.78;
    planetGroup.rotation.set(-.08, 0, -.08);
    scene.add(planetGroup);

    const surfaceUniforms = {
      time: { value: 0 },
      baseColor: { value: baseColor },
      accentColor: { value: accentColor },
      secondaryColor: { value: secondaryColor },
      glowColor: { value: glowColor },
    };
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.18, 128, 96),
      new THREE.ShaderMaterial({ uniforms: surfaceUniforms, vertexShader: PLANET_VERTEX_SHADER, fragmentShader: PLANET_FRAGMENT_SHADER }),
    );
    sphere.renderOrder = 1;
    planetGroup.add(sphere);

    const cloudUniforms = { time: { value: 0 }, accentColor: { value: accentColor }, secondaryColor: { value: secondaryColor } };
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(2.205, 96, 64),
      new THREE.ShaderMaterial({ uniforms: cloudUniforms, vertexShader: CLOUD_VERTEX_SHADER, fragmentShader: CLOUD_FRAGMENT_SHADER, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    clouds.renderOrder = 2;
    planetGroup.add(clouds);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.3, 80, 60),
      new THREE.ShaderMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { glowColor: { value: glowColor } }, vertexShader: PLANET_VERTEX_SHADER, fragmentShader: ATMOSPHERE_FRAGMENT_SHADER }),
    );
    atmosphere.renderOrder = 3;
    planetGroup.add(atmosphere);

    const glowTexture = createGlowTexture();
    const thoughtParticles = createThoughtParticles(theme);
    thoughtParticles.points.renderOrder = 5;
    planetGroup.add(thoughtParticles.points);

    const rings = new THREE.Group();
    rings.rotation.set(1.15, .02, -.2);
    [
      { radius: 2.63, tube: .014, opacity: .26, color: secondaryColor },
      { radius: 2.8, tube: .008, opacity: .18, color: glowColor },
      { radius: 2.98, tube: .022, opacity: .42, color: accentColor },
      { radius: 3.17, tube: .009, opacity: .22, color: secondaryColor },
      { radius: 3.32, tube: .006, opacity: .13, color: glowColor },
    ].forEach(lane => {
      const ringLane = new THREE.Mesh(new THREE.TorusGeometry(lane.radius, lane.tube, 10, 256), new THREE.MeshBasicMaterial({ color: lane.color, transparent: true, opacity: lane.opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
      ringLane.renderOrder = 4;
      rings.add(ringLane);
    });
    if (glowTexture) {
      const random = seededRandom(theme * 3571 + 19);
      const dustPositions = new Float32Array(190 * 3);
      for (let index = 0; index < 190; index += 1) {
        const angle = random() * Math.PI * 2;
        const radius = 2.6 + random() * .72;
        dustPositions[index * 3] = Math.cos(angle) * radius;
        dustPositions[index * 3 + 1] = (random() - .5) * .055;
        dustPositions[index * 3 + 2] = Math.sin(angle) * radius;
      }
      const dustGeometry = new THREE.BufferGeometry();
      dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
      rings.add(new THREE.Points(dustGeometry, new THREE.PointsMaterial({ map: glowTexture, color: accentColor, size: .075, transparent: true, opacity: .34, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })));
    }
    planetGroup.add(rings);

    const markerGroups: THREE.Group[] = [];
    visibleThoughts.forEach((_, index) => {
      const normal = landmarkPosition(index).normalize();
      const marker = new THREE.Group();
      marker.position.copy(normal.clone().multiplyScalar(2.225));
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      if (glowTexture) {
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: index % 2 ? accentColor : secondaryColor, transparent: true, opacity: .62, depthWrite: false, blending: THREE.AdditiveBlending }));
        halo.scale.setScalar(.46);
        halo.position.y = .02;
        marker.add(halo);
        const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffffff, transparent: true, opacity: .92, depthWrite: false, blending: THREE.AdditiveBlending }));
        core.scale.setScalar(.14);
        core.position.y = .02;
        marker.add(core);
      }
      const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(.2, .006, 6, 48), new THREE.MeshBasicMaterial({ color: index % 2 ? accentColor : secondaryColor, transparent: true, opacity: .34, depthWrite: false, blending: THREE.AdditiveBlending }));
      orbitRing.rotation.x = Math.PI / 2;
      marker.add(orbitRing);
      markerGroups.push(marker);
      planetGroup.add(marker);
    });

    let frame = 0;
    let disposed = false;
    let dragging = false;
    let pointerId = -1;
    let lastX = 0;
    let lastY = 0;
    let lastMove = 0;
    let velocityY = 0;
    let targetYaw = 0;
    let targetPitch = -.08;
    let currentYaw = 0;
    let currentPitch = -.08;
    let pointerStrengthTarget = 0;
    const pointerTarget = new THREE.Vector3(0, 0, 9);
    const world = new THREE.Vector3();
    const center = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    const outward = new THREE.Vector3();

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 620 ? 1.25 : 1.75));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = width < 620 ? 46 : 38;
      planetGroup.scale.setScalar(width < 620 ? .86 : 1);
      planetGroup.position.y = width < 620 ? -.67 : -.78;
      thoughtParticles.points.geometry.setDrawRange(0, width < 620 ? 560 : 980);
      camera.updateProjectionMatrix();
    };
    const updateLabels = () => {
      planetGroup.getWorldPosition(center);
      markerGroups.forEach((marker, index) => {
        const label = labelRefs.current[index];
        if (!label) return;
        marker.getWorldPosition(world);
        projected.copy(world).project(camera);
        toCamera.copy(camera.position).sub(world).normalize();
        outward.copy(world).sub(center).normalize();
        const visible = outward.dot(toCamera) > .03 && projected.z < 1;
        const x = (projected.x * .5 + .5) * canvas.clientWidth;
        const y = (-projected.y * .5 + .5) * canvas.clientHeight;
        label.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%) scale(${visible ? 1 : .72})`;
        label.style.opacity = visible ? "1" : "0";
        label.style.pointerEvents = visible ? "auto" : "none";
        label.style.zIndex = String(Math.max(1, Math.round((1 - projected.z) * 10)));
      });
    };
    const updatePointer = (event: globalThis.PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
      pointerTarget.set(x * 3.2, y * 2.35, 2.5);
    };
    const render = (time = 0) => {
      if (disposed) return;
      if (!paused && !reduceMotion && !dragging && !labelHoldRef.current) { targetYaw += .00062 + velocityY; velocityY *= .94; }
      if (labelHoldRef.current) velocityY *= .72;
      currentYaw += (targetYaw - currentYaw) * .09;
      currentPitch += (targetPitch - currentPitch) * .09;
      planetGroup.rotation.x = currentPitch;
      planetGroup.rotation.y = currentYaw;
      clouds.rotation.y = time * .000022 + .18;
      rings.rotation.z = -.2 + Math.sin(time * .00013) * .018;
      thoughtParticles.points.rotation.y = time * .000022;
      thoughtParticles.uniforms.time.value = time * .001;
      thoughtParticles.uniforms.pointer.value.lerp(pointerTarget, .09);
      thoughtParticles.uniforms.pointerStrength.value += (pointerStrengthTarget - thoughtParticles.uniforms.pointerStrength.value) * .1;
      surfaceUniforms.time.value = time * .001;
      cloudUniforms.time.value = time * .001;
      markerGroups.forEach((marker, index) => {
        const selected = selectedRef.current === index;
        const scale = (selected ? 1.26 : 1) + Math.sin(time * .0024 + index * 1.4) * .035;
        marker.scale.setScalar(scale);
      });
      renderer.render(scene, camera);
      updateLabels();
      if (!paused && !reduceMotion) frame = requestAnimationFrame(render);
    };
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.button !== 0) return;
      dragging = true; pointerId = event.pointerId; lastX = event.clientX; lastY = event.clientY;
      lastMove = performance.now(); velocityY = 0; pointerStrengthTarget = .78;
      updatePointer(event); canvas.setPointerCapture(event.pointerId); canvas.dataset.dragging = "true";
    };
    const onPointerMove = (event: globalThis.PointerEvent) => {
      updatePointer(event);
      pointerStrengthTarget = .52;
      if (!dragging || event.pointerId !== pointerId) return;
      event.preventDefault();
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      const elapsed = Math.max(8, performance.now() - lastMove);
      targetYaw += dx * .007;
      targetPitch = Math.max(-.62, Math.min(.46, targetPitch + dy * .0045));
      velocityY = (dx / elapsed) * .012;
      lastX = event.clientX; lastY = event.clientY; lastMove = performance.now();
    };
    const onPointerEnd = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      dragging = false; pointerId = -1; pointerStrengthTarget = .24;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      delete canvas.dataset.dragging;
    };
    const onPointerLeave = () => { if (!dragging) pointerStrengthTarget = 0; };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      pointerStrengthTarget = .46;
      targetYaw += Math.sign(event.deltaY) * Math.min(.28, Math.abs(event.deltaY) * .0014);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerEnd);
    canvas.addEventListener("pointercancel", onPointerEnd);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { resize(); if (paused || reduceMotion) render(); });
    observer?.observe(canvas);
    window.addEventListener("resize", resize);
    resize(); render(); setReady(true);

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      scene.traverse(object => {
        const drawable = object as unknown as { geometry?: { dispose: () => void }; material?: THREE.Material | THREE.Material[] };
        drawable.geometry?.dispose();
        if (drawable.material) {
          const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
          materials.forEach(material => material.dispose());
        }
      });
      glowTexture?.dispose();
      renderer.dispose();
    };
  }, [theme, paused, reduceMotion, visibleThoughts]);

  return <div className={styles.planetScene} data-ready={ready} aria-label="可旋转的今日念头星球">
    <div className={styles.planetFallback} aria-hidden="true"><span /><i /></div>
    <canvas ref={canvasRef} className={styles.planetCanvas} aria-hidden="true" />
    <div className={styles.planetLabels} aria-label={visibleThoughts.length ? "今天散落在星球上的念头" : "今天还没有念头地标"}>
      {visibleThoughts.map((thought, index) => <button key={thought.id} ref={node => { labelRefs.current[index] = node; }} type="button"
        className={styles.planetLabel} data-active={selectedThought === index} aria-pressed={selectedThought === index}
        aria-label={`回看念头：${thought.title}`}
        onPointerEnter={() => { labelHoldRef.current = true; }} onPointerLeave={() => { labelHoldRef.current = false; }}
        onPointerDown={() => { labelHoldRef.current = true; }} onFocus={() => { labelHoldRef.current = true; }} onBlur={() => { labelHoldRef.current = false; }}
        onClick={() => onSelectThought(index)}>
        <i aria-hidden="true" /><span>{thought.title}</span>
      </button>)}
    </div>
  </div>;
}

export default OrbitPlanet3D;
