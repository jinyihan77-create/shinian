"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { starMaterial } from "@/lib/star-materials";
import styles from "./daily-orbit.module.css";

type OrbitPlanet3DProps = {
  theme: number;
  paused?: boolean;
  reduceMotion?: boolean;
};

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

  context.globalCompositeOperation = "source-over";
  for (let grain = 0; grain < 1400; grain += 1) {
    const alpha = .018 + random() * .055;
    context.fillStyle = `rgba(255,255,255,${alpha})`;
    const size = .4 + random() * 1.4;
    context.fillRect(random() * canvas.width, random() * canvas.height, size, size);
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

export function OrbitPlanet3D({ theme, paused = false, reduceMotion = false }: OrbitPlanet3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

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
    renderer.toneMappingExposure = 1.08;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    camera.position.set(0, .08, 8.15);

    const planetGroup = new THREE.Group();
    planetGroup.position.y = -.88;
    planetGroup.rotation.z = -.08;
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
      new THREE.MeshPhysicalMaterial({
        color: material.base,
        map: surfaceTexture,
        bumpMap: surfaceTexture,
        bumpScale: .012,
        roughness: Math.max(.38, material.roughness),
        metalness: material.metalness * .28,
        clearcoat: .22,
        clearcoatRoughness: .68,
      }),
    );
    sphere.renderOrder = 1;
    planetGroup.add(sphere);

    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(2.205, 80, 52),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: cloudsTexture,
        alphaMap: cloudsTexture,
        transparent: true,
        opacity: .38,
        depthWrite: false,
        roughness: .78,
        blending: THREE.AdditiveBlending,
      }),
    );
    clouds.renderOrder = 2;
    planetGroup.add(clouds);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.28, 64, 48),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { glowColor: { value: roseGlow } },
        vertexShader: "varying vec3 vNormal; void main(){ vNormal=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader: "varying vec3 vNormal; uniform vec3 glowColor; void main(){ float rim=pow(0.72-max(0.0,dot(vNormal,vec3(0.0,0.0,1.0))),2.2); gl_FragColor=vec4(glowColor,rim*0.42); }",
      }),
    );
    atmosphere.renderOrder = 3;
    planetGroup.add(atmosphere);

    const rings = new THREE.Group();
    rings.rotation.set(1.15, .02, -.2);
    const dustMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setStyle(`rgb(${material.secondary})`).lerp(new THREE.Color(material.accent), .36),
      emissive: roseGlow,
      emissiveIntensity: .04,
      roughness: .58,
      metalness: .08,
      transparent: true,
      opacity: .16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const dustRing = new THREE.Mesh(new THREE.RingGeometry(2.58, 3.34, 256, 8), dustMaterial);
    dustRing.renderOrder = 3;
    rings.add(dustRing);
    const ringLanes = [
      { radius: 2.63, tube: .018, opacity: .36 },
      { radius: 2.76, tube: .012, opacity: .24 },
      { radius: 2.94, tube: .034, opacity: .62 },
      { radius: 3.12, tube: .014, opacity: .3 },
      { radius: 3.3, tube: .01, opacity: .2 },
    ];
    ringLanes.forEach((lane, index) => {
      const laneMaterial = new THREE.MeshPhysicalMaterial({
        color: index === 2 ? material.accent : `rgb(${material.secondary})`,
        emissive: roseGlow,
        emissiveIntensity: index === 2 ? .09 : .035,
        roughness: .42,
        metalness: .12,
        transparent: true,
        opacity: lane.opacity,
        depthWrite: false,
      });
      const ringLane = new THREE.Mesh(new THREE.TorusGeometry(lane.radius, lane.tube, 12, 256), laneMaterial);
      ringLane.renderOrder = 4;
      rings.add(ringLane);
    });
    planetGroup.add(rings);

    scene.add(new THREE.HemisphereLight(0xffe8f4, 0x11182a, 1));
    const key = new THREE.DirectionalLight(0xfff2fa, 2.25);
    key.position.set(-4.2, 4.8, 5.5);
    scene.add(key);
    const fill = new THREE.PointLight(new THREE.Color().setStyle(`rgb(${material.secondary})`), 6.5, 15, 2);
    fill.position.set(4.5, -.2, 3.8);
    scene.add(fill);
    const rose = new THREE.PointLight(new THREE.Color(material.accent), 4.5, 12, 2);
    rose.position.set(-4.2, -2.5, 3);
    scene.add(rose);

    let frame = 0;
    let disposed = false;
    const resize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = width < 620 ? 46 : 38;
      planetGroup.scale.setScalar(width < 620 ? .88 : 1);
      planetGroup.position.y = width < 620 ? -.72 : -.88;
      camera.updateProjectionMatrix();
    };
    const render = (time = 0) => {
      if (disposed) return;
      if (!paused && !reduceMotion) {
        sphere.rotation.y = time * .000035;
        clouds.rotation.y = time * .000052 + .25;
        rings.rotation.z = -.2 + Math.sin(time * .00016) * .025;
        planetGroup.rotation.y = Math.sin(time * .00011) * .025;
      }
      renderer.render(scene, camera);
      if (!paused && !reduceMotion) frame = requestAnimationFrame(render);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { resize(); if (paused || reduceMotion) render(); });
    observer?.observe(canvas);
    window.addEventListener("resize", resize);
    resize();
    render();
    setReady(true);

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(item => item.dispose());
        }
      });
      surfaceTexture?.dispose();
      cloudsTexture?.dispose();
      renderer.dispose();
    };
  }, [theme, paused, reduceMotion]);

  return <div className={styles.planetScene} data-ready={ready} aria-hidden="true">
    <div className={styles.planetFallback}><span /><i /></div>
    <canvas ref={canvasRef} className={styles.planetCanvas} />
  </div>;
}

export default OrbitPlanet3D;
