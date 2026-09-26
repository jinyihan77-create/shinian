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
    vPosition = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A restrained procedural surface keeps the planet tactile without turning it
// into a noisy, over-lit illustration.
const PLANET_FRAGMENT_SHADER = `
  varying vec3 vNormal;
  varying vec3 vPosition;
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

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 lightDirection = normalize(vec3(-0.44, 0.56, 0.82));
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float surfaceNoise = noise3(vPosition * 1.85);
    float detailNoise = noise3(vPosition * 4.2 + vec3(4.0, 1.0, 7.0));
    float contour = smoothstep(0.43, 0.66, surfaceNoise);
    float contourEdge = smoothstep(0.43, 0.5, surfaceNoise) * (1.0 - smoothstep(0.58, 0.66, surfaceNoise));
    float latitude = sin(vPosition.y * 9.0 + surfaceNoise * 0.8) * 0.5 + 0.5;
    float pearlSheen = pow(max(dot(reflect(-lightDirection, normal), vec3(-0.08, 0.12, 0.98)), 0.0), 18.0);
    float rim = pow(1.0 - max(dot(normal, vec3(0.0, 0.0, 1.0)), 0.0), 2.8);
    vec3 surface = mix(baseColor * 0.82, secondaryColor * 0.94, contour * 0.46 + latitude * 0.08);
    surface += secondaryColor * (detailNoise - 0.5) * 0.055;
    vec3 color = surface * (0.62 + diffuse * 0.42);
    color += accentColor * contourEdge * 0.035;
    color += glowColor * (pearlSheen * 0.11 + rim * 0.018);
    gl_FragColor = vec4(color, 0.97);
  }
`;

const ATMOSPHERE_FRAGMENT_SHADER = `
  varying vec3 vNormal;
  uniform vec3 glowColor;
  void main() {
    float rim = pow(1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0), 2.8);
    gl_FragColor = vec4(glowColor, rim * 0.045);
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
  gradient.addColorStop(0, "rgba(255,252,241,.72)");
  gradient.addColorStop(.14, "rgba(232,225,207,.44)");
  gradient.addColorStop(.42, "rgba(169,187,223,.12)");
  gradient.addColorStop(1, "rgba(169,187,223,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createOrbitalStars(theme: number, accentColor: THREE.Color, secondaryColor: THREE.Color) {
  const count = 78;
  const random = seededRandom(theme * 7919 + 411);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const warm = new THREE.Color("#e5ddce");
  const cool = new THREE.Color("#b2c2d9");
  for (let index = 0; index < count; index += 1) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const radius = 2.3 + random() * 0.28;
    const sinPhi = Math.sin(phi);
    positions[index * 3] = radius * sinPhi * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi) * 0.86;
    positions[index * 3 + 2] = radius * sinPhi * Math.sin(theta);
    const color = random() > .58 ? cool.clone().lerp(secondaryColor, .34) : warm.clone().lerp(accentColor, .24);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: .036, vertexColors: true, transparent: true, opacity: .48, depthWrite: false, blending: THREE.NormalBlending, sizeAttenuation: true });
  return new THREE.Points(geometry, material);
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
    const moonMist = new THREE.Color("#a9bbdf");
    const pearlWhite = new THREE.Color("#f1eee6");
    const mutedSteel = new THREE.Color("#879bb0");
    const quietChampagne = new THREE.Color("#ded8c7");
    const baseColor = new THREE.Color(palette.base).lerp(moonMist, .72).multiplyScalar(.98);
    const accentColor = new THREE.Color(palette.accent).lerp(pearlWhite, .62).multiplyScalar(.8);
    const secondaryColor = new THREE.Color(`rgb(${palette.secondary})`).lerp(mutedSteel, .68).multiplyScalar(.88);
    const glowColor = new THREE.Color(`rgb(${palette.glow})`).lerp(quietChampagne, .82).multiplyScalar(.42);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .82;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    camera.position.set(0, .08, 8.15);

    const planetGroup = new THREE.Group();
    planetGroup.position.y = -.78;
    planetGroup.rotation.set(-.08, 0, -.08);
    scene.add(planetGroup);

    const surfaceUniforms = { baseColor: { value: baseColor }, accentColor: { value: accentColor }, secondaryColor: { value: secondaryColor }, glowColor: { value: glowColor } };
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.18, 128, 96),
      new THREE.ShaderMaterial({ uniforms: surfaceUniforms, vertexShader: PLANET_VERTEX_SHADER, fragmentShader: PLANET_FRAGMENT_SHADER }),
    );
    sphere.renderOrder = 1;
    planetGroup.add(sphere);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.3, 80, 60),
      new THREE.ShaderMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.NormalBlending, uniforms: { glowColor: { value: glowColor } }, vertexShader: PLANET_VERTEX_SHADER, fragmentShader: ATMOSPHERE_FRAGMENT_SHADER }),
    );
    atmosphere.renderOrder = 3;
    planetGroup.add(atmosphere);

    const glowTexture = createGlowTexture();
    const orbitalStars = createOrbitalStars(theme, accentColor, secondaryColor);
    orbitalStars.renderOrder = 5;
    planetGroup.add(orbitalStars);

    const rings = new THREE.Group();
    rings.rotation.set(1.15, .02, -.2);
    [
      { radius: 2.68, tube: .012, opacity: .11, color: secondaryColor },
      { radius: 2.9, tube: .008, opacity: .08, color: glowColor },
      { radius: 3.12, tube: .014, opacity: .13, color: accentColor },
    ].forEach(lane => {
      const ringLane = new THREE.Mesh(new THREE.TorusGeometry(lane.radius, lane.tube, 8, 256), new THREE.MeshBasicMaterial({ color: lane.color, transparent: true, opacity: lane.opacity, depthWrite: false, blending: THREE.NormalBlending }));
      ringLane.renderOrder = 4;
      rings.add(ringLane);
    });
    if (glowTexture) {
      const random = seededRandom(theme * 3571 + 19);
      const dustPositions = new Float32Array(36 * 3);
      for (let index = 0; index < 36; index += 1) {
        const angle = random() * Math.PI * 2;
        const radius = 2.6 + random() * .72;
        dustPositions[index * 3] = Math.cos(angle) * radius;
        dustPositions[index * 3 + 1] = (random() - .5) * .055;
        dustPositions[index * 3 + 2] = Math.sin(angle) * radius;
      }
      const dustGeometry = new THREE.BufferGeometry();
      dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
      rings.add(new THREE.Points(dustGeometry, new THREE.PointsMaterial({ map: glowTexture, color: accentColor, size: .022, transparent: true, opacity: .22, depthWrite: false, blending: THREE.NormalBlending, sizeAttenuation: true })));
    }
    planetGroup.add(rings);

    const markerGroups: THREE.Group[] = [];
    visibleThoughts.forEach((_, index) => {
      const normal = landmarkPosition(index).normalize();
      const marker = new THREE.Group();
      marker.position.copy(normal.clone().multiplyScalar(2.225));
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      if (glowTexture) {
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: index % 2 ? accentColor : secondaryColor, transparent: true, opacity: .11, depthWrite: false, blending: THREE.NormalBlending }));
        halo.scale.setScalar(.2);
        halo.position.y = .02;
        marker.add(halo);
        const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffffff, transparent: true, opacity: .28, depthWrite: false, blending: THREE.NormalBlending }));
        core.scale.setScalar(.07);
        core.position.y = .02;
        marker.add(core);
      }
      const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(.16, .004, 6, 48), new THREE.MeshBasicMaterial({ color: index % 2 ? accentColor : secondaryColor, transparent: true, opacity: .22, depthWrite: false, blending: THREE.NormalBlending }));
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
    const render = (time = 0) => {
      if (disposed) return;
      if (!paused && !reduceMotion && !dragging && !labelHoldRef.current) { targetYaw += .00062 + velocityY; velocityY *= .94; }
      if (labelHoldRef.current) velocityY *= .72;
      currentYaw += (targetYaw - currentYaw) * .09;
      currentPitch += (targetPitch - currentPitch) * .09;
      planetGroup.rotation.x = currentPitch;
      planetGroup.rotation.y = currentYaw;
      rings.rotation.z = -.2 + Math.sin(time * .00013) * .018;
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
      lastMove = performance.now(); velocityY = 0; canvas.setPointerCapture(event.pointerId); canvas.dataset.dragging = "true";
    };
    const onPointerMove = (event: globalThis.PointerEvent) => {
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
      dragging = false; pointerId = -1;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      delete canvas.dataset.dragging;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      targetYaw += Math.sign(event.deltaY) * Math.min(.28, Math.abs(event.deltaY) * .0014);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerEnd);
    canvas.addEventListener("pointercancel", onPointerEnd);
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
