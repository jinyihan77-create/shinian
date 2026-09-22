"use client";

// Adapted from React Bits Lanyard. See /licenses/react-bits-lanyard.txt.
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, extend, useFrame, useThree, type ThreeElement, type ThreeEvent } from "@react-three/fiber";
import { Environment, Lightformer, useTexture } from "@react-three/drei";
import { BallCollider, CuboidCollider, Physics, RigidBody, useRopeJoint, useSphericalJoint, type RapierRigidBody, type RigidBodyProps } from "@react-three/rapier";
import { MeshLineGeometry, MeshLineMaterial } from "meshline";
import * as THREE from "three";
import { starMaterial } from "@/lib/star-materials";
import styles from "./lanyard-checkin.module.css";

extend({ MeshLineGeometry, MeshLineMaterial });

declare module "@react-three/fiber" {
  interface ThreeElements {
    meshLineGeometry: ThreeElement<typeof MeshLineGeometry>;
    meshLineMaterial: ThreeElement<typeof MeshLineMaterial>;
  }
}

export interface LanyardCheckinProps {
  frontImage: string;
  backImage: string;
  theme?: number;
  flipped?: boolean;
  paused?: boolean;
  onUnavailable?: (reason?: string) => void;
  onReady?: () => void;
  className?: string;
}

class LanyardErrorBoundary extends Component<{ children: ReactNode; onUnavailable?: (reason?: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) {
    const detail = error.message.replace(/data:image\/[^\s)]+/g, "[card texture]").slice(0, 240);
    this.props.onUnavailable?.(`吊牌渲染失败：${detail}`);
  }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Local assets only. A DOM fallback belongs to the parent so the same card data remains readable. */
export default function LanyardCheckin({ frontImage, backImage, theme = 0, flipped = false, paused = false, onUnavailable, onReady, className = "" }: LanyardCheckinProps) {
  const [compact, setCompact] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;
  const reportUnavailable = useCallback((reason = "当前设备暂时无法显示立体吊牌。") => {
    console.warn(`[拾念吊牌] ${reason}`);
    unavailable.current?.(reason);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const change = () => setCompact(query.matches);
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    const element = wrapper.current;
    const lost = (event: Event) => { event.preventDefault(); reportUnavailable("浏览器释放了吊牌的 WebGL 绘图上下文。"); };
    element?.addEventListener("webglcontextlost", lost, true);
    return () => element?.removeEventListener("webglcontextlost", lost, true);
  }, [reportUnavailable]);

  return <div ref={wrapper} className={`${styles.scene} ${className}`} style={{ cursor: paused ? "default" : dragging ? "grabbing" : hovered ? "grab" : "default" }} aria-label="可拖动的星空打卡吊牌；也可使用翻面按钮查看背面">
    <LanyardErrorBoundary onUnavailable={reportUnavailable}>
      <Canvas
        camera={{ position: [0, 0, compact ? 11.3 : 11.6], fov: 22 }}
        dpr={[1, compact ? 1.25 : 1.5]}
        frameloop={paused ? "demand" : "always"}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        fallback={<span>立体吊牌暂时无法显示，可使用下方翻面按钮。</span>}
        onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05; }}
      >
        <ambientLight intensity={1.5} />
        <directionalLight position={[2, 5, 8]} intensity={2.1} color="#f5efff" />
        <directionalLight position={[-3, -2, -3]} intensity={1.2} color="#b2daff" />
        <Suspense fallback={null}>
          <Physics gravity={[0, -40, 0]} timeStep={1 / 60} paused={paused}>
            <Band frontImage={frontImage} backImage={backImage} theme={theme} flipped={flipped} paused={paused} compact={compact} onHover={setHovered} onDragging={setDragging} onReady={onReady} />
          </Physics>
          <Environment resolution={64} frames={1}>
            <Lightformer intensity={2} color="#e5d9ff" position={[-4, 4, 5]} rotation={[0, 0, Math.PI / 5]} scale={[6, 2, 1]} />
            <Lightformer intensity={1.4} color="#bedced" position={[4, -1, 3]} rotation={[0, 0, -Math.PI / 3]} scale={[4, 0.8, 1]} />
          </Environment>
        </Suspense>
      </Canvas>
    </LanyardErrorBoundary>
  </div>;
}

type BandProps = Pick<LanyardCheckinProps, "frontImage" | "backImage" | "onReady"> & {
  theme: number;
  compact: boolean; flipped: boolean; paused: boolean;
  onHover: (value: boolean) => void; onDragging: (value: boolean) => void;
};

const CARD_WIDTH = 2.46;
const CARD_HEIGHT = 3.28;
const CARD_RADIUS = 0.14;
const CARD_DEPTH = 0.075;
const FACE_Z = 0.064;
const ATTACHMENT_Y = CARD_HEIGHT / 2 + 0.12;

/** Both faces use the same rounded-rectangle artwork coordinates as the DOM fallback. */
function makeCardGeometry() {
  const shape = new THREE.Shape();
  const halfWidth = CARD_WIDTH / 2;
  const halfHeight = CARD_HEIGHT / 2;
  const radius = CARD_RADIUS;
  shape.moveTo(-halfWidth + radius, -halfHeight);
  shape.lineTo(halfWidth - radius, -halfHeight);
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + radius);
  shape.lineTo(halfWidth, halfHeight - radius);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - radius, halfHeight);
  shape.lineTo(-halfWidth + radius, halfHeight);
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - radius);
  shape.lineTo(-halfWidth, -halfHeight + radius);
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + radius, -halfHeight);
  shape.closePath();
  const face = new THREE.ShapeGeometry(shape);
  const positions = face.getAttribute("position");
  const uv = face.getAttribute("uv");
  for (let i = 0; i < positions.count; i++) {
    uv.setXY(i, 0.5 + positions.getX(i) / CARD_WIDTH, 0.5 + positions.getY(i) / CARD_HEIGHT);
  }
  uv.needsUpdate = true;
  const shell = new THREE.ExtrudeGeometry(shape, { depth: CARD_DEPTH, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.016, bevelThickness: 0.023, curveSegments: 4 });
  shell.translate(0, 0, -CARD_DEPTH / 2);
  const outlinePoints = shape.getPoints(12).map(point => new THREE.Vector3(point.x, point.y, 0));
  const outlineCurve = new THREE.CatmullRomCurve3(outlinePoints, true, "catmullrom", 0.035);
  const rim = new THREE.TubeGeometry(outlineCurve, 120, 0.009, 5, true);
  const glow = new THREE.TubeGeometry(outlineCurve, 120, 0.03, 5, true);
  return { face, shell, rim, glow };
}

function makeGlintTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const haze = ctx.createRadialGradient(64, 64, 0, 64, 64, 58);
  haze.addColorStop(0, "rgba(255,255,255,0.78)");
  haze.addColorStop(0.16, "rgba(239,244,255,0.24)");
  haze.addColorStop(0.65, "rgba(221,232,255,0.035)");
  haze.addColorStop(1, "rgba(221,232,255,0)");
  ctx.fillStyle = haze; ctx.fillRect(0, 0, 128, 128);
  const ray = ctx.createRadialGradient(64, 64, 0, 64, 64, 56);
  ray.addColorStop(0, "rgba(255,255,255,1)");
  ray.addColorStop(0.23, "rgba(255,255,255,0.6)");
  ray.addColorStop(1, "rgba(240,244,255,0)");
  ctx.fillStyle = ray;
  ctx.beginPath();
  ctx.moveTo(64, 5); ctx.quadraticCurveTo(68, 58, 119, 64);
  ctx.quadraticCurveTo(68, 69, 64, 123); ctx.quadraticCurveTo(60, 70, 9, 64);
  ctx.quadraticCurveTo(60, 58, 64, 5); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function CardGlints({ color, paused, active }: { color: string; paused: boolean; active: boolean }) {
  const sprites = useRef<Array<THREE.Sprite | null>>([]);
  const texture = useMemo(makeGlintTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(({ clock }) => {
    if (paused) return;
    sprites.current.forEach((sprite, i) => {
      if (!sprite) return;
      const shimmer = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.15 + i * 2.47);
      const scale = (i % 5 === 1 ? 0.32 : 0.22) * (0.88 + shimmer * 0.24);
      sprite.scale.setScalar(scale);
      (sprite.material as THREE.SpriteMaterial).opacity = (0.24 + shimmer * 0.25) * (active ? 1.25 : 1);
    });
  });
  const points = [[-0.87, 1.18], [0.78, 1.05], [0.93, -0.94], [-0.85, -1.12], [0.06, 0.34]] as const;
  return <>{[-1, 1].flatMap((side, sideIndex) => points.map(([x, y], i) => <sprite key={`${side}-${i}`} ref={node => { sprites.current[sideIndex * points.length + i] = node; }} position={[x, y, side * 0.08]} scale={0.24}>
    <spriteMaterial map={texture} color={color} transparent opacity={0.5} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
  </sprite>))}</>;
}

function Band({ frontImage, backImage, theme, flipped, paused, compact, onHover, onDragging, onReady }: BandProps) {
  const band = useRef<THREE.Mesh<MeshLineGeometry, MeshLineMaterial>>(null!);
  const fixed = useRef<RapierRigidBody>(null!);
  const j1 = useRef<RapierRigidBody>(null!);
  const j2 = useRef<RapierRigidBody>(null!);
  const j3 = useRef<RapierRigidBody>(null!);
  const card = useRef<RapierRigidBody>(null!);
  const face = useRef<THREE.Group>(null!);
  const dragOrigin = useRef<THREE.Vector3 | null>(null);
  const [dragged, setDragged] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { invalidate, size, gl } = useThree();
  const finish = starMaterial(theme);
  const geometry = useMemo(makeCardGeometry, []);
  const [frontTexture, backTexture] = useTexture([frontImage, backImage]);
  const textureCleanup = useRef(new Map<string, number>());
  const cache = useMemo(() => ({ vector: new THREE.Vector3(), direction: new THREE.Vector3(), angular: new THREE.Vector3(), rotation: new THREE.Quaternion(), smoothedA: new THREE.Vector3(-0.1, 3.2, 0), smoothedB: new THREE.Vector3(0.1, 2.2, 0), curve: new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]) }), []);
  const bodyOptions: RigidBodyProps = { canSleep: true, colliders: false, angularDamping: 4, linearDamping: 4 };

  useEffect(() => () => { Object.values(geometry).forEach(value => value.dispose()); }, [geometry]);
  useEffect(() => {
    [frontTexture, backTexture].forEach(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true;
    });
  }, [frontTexture, backTexture, gl]);
  useEffect(() => {
    const resourceKey = `${frontTexture.uuid}:${backTexture.uuid}`;
    const pending = textureCleanup.current;
    const previous = pending.get(resourceKey);
    if (previous !== undefined) { clearTimeout(previous); pending.delete(resourceKey); }
    return () => {
      // Briefly defer release so development StrictMode's cleanup/setup cycle
      // keeps its active textures. Replaced data URLs leave Drei's global cache.
      const timer = window.setTimeout(() => {
        useTexture.clear([frontImage, backImage]);
        frontTexture.dispose();
        if (backTexture !== frontTexture) backTexture.dispose();
        pending.delete(resourceKey);
      }, 0);
      pending.set(resourceKey, timer);
    };
  }, [frontImage, backImage, frontTexture, backTexture]);
  useEffect(() => { invalidate(); }, [flipped, paused, theme, frontTexture, backTexture, invalidate]);
  useEffect(() => { onReady?.(); }, [onReady]);
  useEffect(() => { if (paused) { dragOrigin.current = null; setDragged(false); onDragging(false); } }, [paused, onDragging]);

  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], 1]);
  useSphericalJoint(j3, card, [[0, 0, 0], [0, ATTACHMENT_Y, 0]]);

  const release = (event?: ThreeEvent<PointerEvent>) => {
    event?.stopPropagation();
    const target = event?.target as Element | undefined;
    if (event && target?.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
    dragOrigin.current = null; setDragged(false); onDragging(false);
  };

  useEffect(() => {
    // A release outside the canvas must not leave a kinematic body attached to the pointer.
    const reset = () => { dragOrigin.current = null; setDragged(false); onDragging(false); };
    window.addEventListener("pointerup", reset); window.addEventListener("pointercancel", reset); window.addEventListener("blur", reset);
    return () => { window.removeEventListener("pointerup", reset); window.removeEventListener("pointercancel", reset); window.removeEventListener("blur", reset); };
  }, [onDragging]);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.04);
    if (!fixed.current || !card.current || !band.current) return;
    if (dragOrigin.current && !paused) {
      cache.vector.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera);
      cache.direction.copy(cache.vector).sub(state.camera.position).normalize();
      cache.vector.add(cache.direction.multiplyScalar(state.camera.position.length()));
      [fixed, j1, j2, j3, card].forEach(ref => ref.current.wakeUp());
      card.current.setNextKinematicTranslation({ x: THREE.MathUtils.clamp(cache.vector.x - dragOrigin.current.x, -3.2, 3.2), y: THREE.MathUtils.clamp(cache.vector.y - dragOrigin.current.y, -2.3, 3.5), z: 0 });
    }
    cache.smoothedA.lerp(j1.current.translation(), Math.min(1, delta * 35));
    cache.smoothedB.lerp(j2.current.translation(), Math.min(1, delta * 35));
    cache.curve.curveType = "chordal";
    cache.curve.points[0].copy(j3.current.translation());
    cache.curve.points[1].copy(cache.smoothedB);
    cache.curve.points[2].copy(cache.smoothedA);
    cache.curve.points[3].copy(fixed.current.translation());
    band.current.geometry.setPoints(cache.curve.getPoints(compact ? 18 : 28));
    if (!paused) {
      cache.angular.copy(card.current.angvel());
      cache.rotation.copy(card.current.rotation());
      card.current.setAngvel({ x: cache.angular.x, y: cache.angular.y - cache.rotation.y * 0.25, z: cache.angular.z }, true);
    }
    if (face.current) {
      const target = flipped ? Math.PI : 0;
      face.current.rotation.y = THREE.MathUtils.damp(face.current.rotation.y, target, 9, delta);
      if (paused && Math.abs(target - face.current.rotation.y) > 0.001) invalidate();
    }
  });

  return <>
    <group position={[0, 4.78, 0]}>
      <RigidBody ref={fixed} {...bodyOptions} type="fixed" />
      <RigidBody ref={j1} {...bodyOptions} position={[-0.1, -1, 0]}><BallCollider args={[0.1]} /></RigidBody>
      <RigidBody ref={j2} {...bodyOptions} position={[0.1, -2, 0]}><BallCollider args={[0.1]} /></RigidBody>
      <RigidBody ref={j3} {...bodyOptions} position={[0, -3, 0]}><BallCollider args={[0.1]} /></RigidBody>
      <RigidBody ref={card} {...bodyOptions} position={[0, -3 - ATTACHMENT_Y, 0]} rotation={[0, 0, -0.04]} type={dragged ? "kinematicPosition" : "dynamic"}>
        <CuboidCollider args={[CARD_WIDTH / 2, CARD_HEIGHT / 2, 0.055]} />
        <group ref={face}
          onPointerOver={() => { onHover(true); setHovered(true); }} onPointerOut={() => { onHover(false); setHovered(false); }} onPointerUp={release} onPointerCancel={release}
          onPointerDown={(event: ThreeEvent<PointerEvent>) => {
            if (paused) return;
            event.stopPropagation();
            (event.target as Element).setPointerCapture(event.pointerId);
            dragOrigin.current = new THREE.Vector3().copy(event.point).sub(cache.vector.copy(card.current.translation()));
            setDragged(true); onDragging(true);
          }}>
          <mesh geometry={geometry.shell}>
            <meshPhysicalMaterial attach="material-0" color={finish.base} roughness={finish.roughness} metalness={finish.metalness} clearcoat={1} clearcoatRoughness={0.16} transparent opacity={finish.kind === "frost" ? 0.24 : 0.1} depthWrite={false} emissive={finish.accent} emissiveIntensity={0.06} iridescence={finish.kind === "pearl" || finish.kind === "aurora" ? 0.72 : 0.14} iridescenceIOR={1.3} />
            <meshPhysicalMaterial attach="material-1" color={finish.accent} roughness={finish.roughness * 0.7} metalness={Math.min(0.5, finish.metalness + 0.15)} clearcoat={1} clearcoatRoughness={0.12} transparent opacity={0.84} depthWrite={false} emissive={finish.accent} emissiveIntensity={0.1} />
          </mesh>
          <mesh geometry={geometry.face} position={[0, 0, FACE_Z]}>
            <meshBasicMaterial map={frontTexture} transparent toneMapped={false} />
          </mesh>
          <mesh geometry={geometry.face} position={[0, 0, -FACE_Z]} rotation={[0, Math.PI, 0]}>
            <meshBasicMaterial map={backTexture} transparent toneMapped={false} />
          </mesh>
          {[-1, 1].map(side => <group key={side} position={[0, 0, side * (FACE_Z + 0.002)]}>
            <mesh geometry={geometry.rim}><meshBasicMaterial color={finish.accent} transparent opacity={hovered || dragged ? 0.82 : 0.66} depthWrite={false} toneMapped={false} /></mesh>
            <mesh geometry={geometry.glow}><meshBasicMaterial color={finish.accent} transparent opacity={hovered || dragged ? 0.13 : 0.065} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
          </group>)}
          <mesh position={[0, CARD_HEIGHT / 2 + 0.034, 0]}>
            <torusGeometry args={[0.072, 0.013, 8, 24]} />
            <meshStandardMaterial color={finish.accent} metalness={0.78} roughness={0.23} />
          </mesh>
          {finish.halo && <group position={[0, -0.72, FACE_Z + 0.012]} rotation={[0.42, 0.1, -0.28]} scale={[1.06, 0.34, 1]}>
            <mesh><torusGeometry args={[0.78, 0.012, 8, 96]} /><meshStandardMaterial color="#d5bd9a" emissive="#e8c898" emissiveIntensity={0.16} roughness={0.27} metalness={0.68} /></mesh>
            <mesh><torusGeometry args={[0.84, 0.004, 5, 96]} /><meshBasicMaterial color={finish.accent} transparent opacity={0.33} depthWrite={false} toneMapped={false} /></mesh>
          </group>}
          <CardGlints color={finish.accent} paused={paused} active={hovered || dragged} />
        </group>
      </RigidBody>
    </group>
    <mesh ref={band} frustumCulled={false}>
      <meshLineGeometry />
      <meshLineMaterial args={[{ resolution: new THREE.Vector2(size.width, size.height) }]} color={finish.accent} depthTest={true} transparent opacity={0.55} resolution={[size.width, size.height]} lineWidth={0.035} />
    </mesh>
  </>;
}
