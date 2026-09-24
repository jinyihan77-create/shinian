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

function seededRandom(seed: number) {
  let value = seed || 1;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function rgba(color: string, alpha: number) {
  const parsed = new THREE.Color().setStyle(color);
  return `rgba(${Math.round(parsed.r * 255)},${Math.round(parsed.g * 255)},${Math.round(parsed.b * 255)},${alpha})`;
}

function textureCanvas(theme: number, base: string, accent: string, secondary: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const random = seededRandom(theme * 7919 + 73);
  const baseColor = new THREE.Color(base);
  const deepColor = baseColor.clone().multiplyScalar(.18);
  const middleColor = baseColor.clone().lerp(new THREE.Color(secondary), .34);
  const wash = context.createLinearGradient(0, 0, 0, canvas.height);
  wash.addColorStop(0, `#${new THREE.Color(accent).lerp(new THREE.Color("#ffffff"), .28).getHexString()}`);
  wash.addColorStop(.26, `#${middleColor.getHexString()}`);
  wash.addColorStop(.68, `#${baseColor.clone().multiplyScalar(.56).getHexString()}`);
  wash.addColorStop(1, `#${deepColor.getHexString()}`);
  context.fillStyle = wash;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.globalCompositeOperation = "screen";
  for (let band = 0; band < 22; band += 1) {
    const y = (band / 22) * canvas.height + (random() - .5) * 26;
    context.beginPath();
    context.moveTo(-80, y);
    for (let x = -80; x <= canvas.width + 80; x += 64) {
      const wave = Math.sin(x * .016 + band * .83) * (12 + random() * 22);
      context.lineTo(x, y + wave);
    }
    context.strokeStyle = band % 3 === 0 ? rgba(accent, .13) : rgba(secondary, .09);
    context.lineWidth = 8 + random() * 28;
    context.lineCap = "round";
    context.stroke();
  }

  context.globalCompositeOperation = "soft-light";
  for (let spot = 0; spot < 48; spot += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const radius = 18 + random() * 90;
    const glow = context.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, random() > .45 ? "rgba(255,247,251,.22)" : rgba(secondary, .16));
    glow.addColorStop(1, "#00000000");
    context.fillStyle = glow;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  return canvas;
}

function cloudCanvas(theme: number, accent: string, secondary: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const random = seededRandom(theme * 3571 + 191);
  context.globalCompositeOperation = "screen";
  for (let index = 0; index < 64; index += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const width = 45 + random() * 170;
    const height = 4 + random() * 16;
    const haze = context.createRadialGradient(x, y, 0, x, y, width);
    haze.addColorStop(0, index % 3 ? rgba(accent, .14) : rgba(secondary, .12));
    haze.addColorStop(1, "#00000000");
    context.save();
    context.translate(x, y);
    context.scale(1, height / width);
    context.fillStyle = haze;
    context.fillRect(-width, -width, width * 2, width * 2);
    context.restore();
  }
  return canvas;
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
    const material = starMaterial(theme);
    const roseGlow = new THREE.Color().setStyle(`rgb(${material.glow})`).lerp(new THREE.Color("#f1c5df"), .38);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    camera.position.set(0, .08, 8.15);

    const planetGroup = new THREE.Group();
    planetGroup.position.y = -.78;
    planetGroup.rotation.set(-.08, 0, -.08);
    scene.add(planetGroup);

    const colorCanvas = textureCanvas(theme, material.base, material.accent, `rgb(${material.secondary})`);
    const cloudLayer = cloudCanvas(theme, material.accent, `rgb(${material.secondary})`);
    const surfaceTexture = colorCanvas ? new THREE.CanvasTexture(colorCanvas) : null;
    const cloudsTexture = cloudLayer ? new THREE.CanvasTexture(cloudLayer) : null;
    for (const texture of [surfaceTexture, cloudsTexture]) {
      if (!texture) continue;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    }

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.18, 128, 96),
      new THREE.MeshPhysicalMaterial({ color: material.base, map: surfaceTexture, bumpMap: surfaceTexture, bumpScale: .012,
        roughness: Math.max(.42, material.roughness), metalness: material.metalness * .22, clearcoat: .16, clearcoatRoughness: .72 }),
    );
    sphere.renderOrder = 1;
    planetGroup.add(sphere);

    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(2.205, 80, 52),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: cloudsTexture, alphaMap: cloudsTexture, transparent: true,
        opacity: .31, depthWrite: false, roughness: .82, blending: THREE.AdditiveBlending }),
    );
    clouds.renderOrder = 2;
    planetGroup.add(clouds);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.28, 64, 48),
      new THREE.ShaderMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { glowColor: { value: roseGlow } },
        vertexShader: "varying vec3 vNormal; void main(){ vNormal=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader: "varying vec3 vNormal; uniform vec3 glowColor; void main(){ float rim=pow(0.72-max(0.0,dot(vNormal,vec3(0.0,0.0,1.0))),2.2); gl_FragColor=vec4(glowColor,rim*0.38); }" }),
    );
    atmosphere.renderOrder = 3;
    planetGroup.add(atmosphere);

    const rings = new THREE.Group();
    rings.rotation.set(1.15, .02, -.2);
    const dustMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setStyle(`rgb(${material.secondary})`).lerp(new THREE.Color(material.accent), .36),
      emissive: roseGlow, emissiveIntensity: .04, roughness: .58, metalness: .08, transparent: true, opacity: .13,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const dustRing = new THREE.Mesh(new THREE.RingGeometry(2.58, 3.34, 256, 8), dustMaterial);
    dustRing.renderOrder = 3;
    rings.add(dustRing);
    [
      { radius: 2.63, tube: .018, opacity: .3 }, { radius: 2.76, tube: .012, opacity: .2 },
      { radius: 2.94, tube: .03, opacity: .52 }, { radius: 3.12, tube: .014, opacity: .26 },
      { radius: 3.3, tube: .01, opacity: .18 },
    ].forEach((lane, index) => {
      const laneMaterial = new THREE.MeshPhysicalMaterial({ color: index === 2 ? material.accent : `rgb(${material.secondary})`,
        emissive: roseGlow, emissiveIntensity: index === 2 ? .08 : .03, roughness: .46, metalness: .1,
        transparent: true, opacity: lane.opacity, depthWrite: false });
      const ringLane = new THREE.Mesh(new THREE.TorusGeometry(lane.radius, lane.tube, 12, 256), laneMaterial);
      ringLane.renderOrder = 4;
      rings.add(ringLane);
    });
    planetGroup.add(rings);

    const markerGroups: THREE.Group[] = [];
    visibleThoughts.forEach((_, index) => {
      const normal = landmarkPosition(index).normalize();
      const marker = new THREE.Group();
      marker.position.copy(normal.clone().multiplyScalar(2.22));
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(.018, .028, .22, 8),
        new THREE.MeshPhysicalMaterial({ color: 0xf0d9e7, roughness: .56, metalness: .08 }));
      stem.position.y = .09;
      marker.add(stem);
      const crownGeometry = index % 3 === 0 ? new THREE.IcosahedronGeometry(.12, 1)
        : index % 3 === 1 ? new THREE.OctahedronGeometry(.13, 1) : new THREE.SphereGeometry(.105, 18, 12);
      const crown = new THREE.Mesh(crownGeometry, new THREE.MeshPhysicalMaterial({
        color: index % 2 ? material.accent : `rgb(${material.secondary})`, emissive: roseGlow, emissiveIntensity: .42,
        roughness: .28, metalness: .12, transparent: true, opacity: .94,
      }));
      crown.position.y = .24;
      marker.add(crown);
      const aura = new THREE.Mesh(new THREE.TorusGeometry(.17, .008, 8, 48),
        new THREE.MeshBasicMaterial({ color: roseGlow, transparent: true, opacity: .48, depthWrite: false }));
      aura.position.y = .235;
      aura.rotation.x = Math.PI / 2;
      marker.add(aura);
      markerGroups.push(marker);
      planetGroup.add(marker);
    });

    scene.add(new THREE.HemisphereLight(0xffe8f4, 0x11182a, 1));
    const key = new THREE.DirectionalLight(0xfff2fa, 2.15);
    key.position.set(-4.2, 4.8, 5.5);
    scene.add(key);
    const fill = new THREE.PointLight(new THREE.Color().setStyle(`rgb(${material.secondary})`), 5.8, 15, 2);
    fill.position.set(4.5, -.2, 3.8);
    scene.add(fill);
    const rose = new THREE.PointLight(new THREE.Color(material.accent), 4.1, 12, 2);
    rose.position.set(-4.2, -2.5, 3);
    scene.add(rose);

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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
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
      if (!paused && !reduceMotion && !dragging && !labelHoldRef.current) { targetYaw += .0007 + velocityY; velocityY *= .94; }
      if (labelHoldRef.current) velocityY *= .72;
      currentYaw += (targetYaw - currentYaw) * .09;
      currentPitch += (targetPitch - currentPitch) * .09;
      planetGroup.rotation.x = currentPitch;
      planetGroup.rotation.y = currentYaw;
      clouds.rotation.y = time * .000035 + .18;
      rings.rotation.z = -.2 + Math.sin(time * .00013) * .018;
      markerGroups.forEach((marker, index) => {
        const scale = (selectedRef.current === index ? 1.28 : 1) + Math.sin(time * .003 + index) * .035;
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
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(item => item.dispose());
        }
      });
      surfaceTexture?.dispose(); cloudsTexture?.dispose(); renderer.dispose();
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
