"use client";

import { Environment, Edges, Lightformer, Sparkles } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { STAR_POINTS, starMaterial } from "@/lib/star-materials";
import styles from "./star-curtain.module.css";

export type CrystalStarLayout = { left: number; top: number; size: number; depth: number };
export type CrystalStarMotion = {
  x: number;
  y: number;
  angle: number;
  yaw: number;
  scale: number;
  opacity: number;
};

type Props = {
  theme: number;
  stars: readonly CrystalStarLayout[];
  motion: MutableRefObject<CrystalStarMotion[]>;
  stage: MutableRefObject<HTMLDivElement | null>;
  hovered: number | null;
  selected: number | null;
  paused: boolean;
};

function starShape() {
  const shape = new THREE.Shape();
  STAR_POINTS.forEach((point, index) => {
    const x = point.x;
    const y = -point.y;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  return shape;
}

function CrystalStar({ index, theme, layout, motion, stage, hovered, selected }: {
  index: number;
  theme: number;
  layout: CrystalStarLayout;
  motion: MutableRefObject<CrystalStarMotion[]>;
  stage: MutableRefObject<HTMLDivElement | null>;
  hovered: boolean;
  selected: number | null;
}) {
  const group = useRef<THREE.Group>(null);
  const crystal = useRef<THREE.MeshPhysicalMaterial>(null);
  const { viewport } = useThree();
  const finish = starMaterial(theme + index);
  const geometry = useMemo(() => {
    const next = new THREE.ExtrudeGeometry(starShape(), {
      depth: .28,
      bevelEnabled: true,
      bevelSegments: 5,
      bevelSize: .075,
      bevelThickness: .075,
      curveSegments: 2,
      steps: 1,
    });
    next.center();
    next.computeVertexNormals();
    return next;
  }, []);
  const facetGeometry = useMemo(() => {
    return STAR_POINTS.map((point, pointIndex) => {
      const next = STAR_POINTS[(pointIndex + 1) % STAR_POINTS.length];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute([
        0, 0, .221,
        point.x * .92, -point.y * .92, .221,
        next.x * .92, -next.y * .92, .221,
      ], 3));
      geometry.computeVertexNormals();
      return geometry;
    });
  }, []);
  const baseColor = new THREE.Color(finish.base);
  const accent = new THREE.Color(finish.accent);

  useFrame(({ clock }) => {
    const node = group.current;
    const stageNode = stage.current;
    if (!node || !stageNode) return;
    const state = motion.current[index];
    const stageWidth = Math.max(1, stageNode.clientWidth);
    const stageHeight = Math.max(1, stageNode.clientHeight);
    const x = (layout.left / 100 - .5) * viewport.width + state.x / stageWidth * viewport.width;
    const y = viewport.height / 2 - (layout.top + layout.size / 2 + state.y) / stageHeight * viewport.height;
    const radius = layout.size / stageHeight * viewport.height / 2;
    const hoverScale = hovered ? 1.065 : 1;
    node.position.set(x, y, index === 3 ? .35 : layout.depth * .08);
    node.rotation.set(-.08 + Math.sin(clock.elapsedTime * .35 + index) * .025, THREE.MathUtils.degToRad(state.yaw), THREE.MathUtils.degToRad(-state.angle));
    node.scale.setScalar(radius * state.scale * hoverScale);
    node.visible = state.opacity > .035 && (selected === null || selected === index);
    if (crystal.current) {
      crystal.current.emissiveIntensity = (hovered ? .21 : .08) + Math.sin(clock.elapsedTime * .7 + index * 1.3) * .025;
    }
  });

  return <group ref={group}>
    <mesh geometry={geometry} renderOrder={2}>
      <meshPhysicalMaterial
        ref={crystal}
        color={baseColor}
        emissive={accent}
        emissiveIntensity={.08}
        roughness={Math.min(.3, finish.roughness * .62)}
        metalness={.03}
        transmission={.96}
        thickness={.82}
        ior={1.48}
        attenuationColor={baseColor}
        attenuationDistance={2.8}
        clearcoat={1}
        clearcoatRoughness={.08}
        envMapIntensity={1.7}
        specularIntensity={1}
        specularColor="#fff7fc"
        transparent
        opacity={Math.min(.86, finish.opacity)}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped
      />
      <Edges threshold={16} color={finish.accent} scale={1.005} />
    </mesh>

    <mesh geometry={geometry} scale={[.79, .79, .56]} position={[0, 0, -.01]} renderOrder={1}>
      <meshPhysicalMaterial color={finish.accent} emissive={finish.base} emissiveIntensity={.12} roughness={.18} transparent opacity={.085} depthWrite={false} />
    </mesh>

    <group>
      {facetGeometry.map((facet, facetIndex) => <mesh key={facetIndex} geometry={facet} renderOrder={3}>
        <meshPhysicalMaterial
          color={facetIndex % 3 === 0 ? finish.accent : facetIndex % 3 === 1 ? finish.base : `rgb(${finish.secondary})`}
          roughness={.16}
          metalness={.04}
          transparent
          opacity={facetIndex % 2 === 0 ? .115 : .07}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>)}
    </group>

    {finish.halo && <group rotation={[1.22, .18, -.34]} scale={[1.26, .54, 1]}>
      <mesh>
        <torusGeometry args={[1.04, .014, 8, 96]} />
        <meshBasicMaterial color={finish.accent} transparent opacity={.82} toneMapped={false} />
      </mesh>
      <mesh scale={1.04}>
        <torusGeometry args={[1.04, .038, 8, 96]} />
        <meshBasicMaterial color={finish.base} transparent opacity={.12} toneMapped={false} />
      </mesh>
    </group>}

    <Sparkles count={index === 3 ? 15 : 8} scale={[1.35, 1.35, .4]} size={index === 3 ? 2.1 : 1.35} speed={.18} opacity={.58} color={finish.accent} noise={.8} />
    <pointLight color={finish.accent} intensity={hovered ? 1.25 : .48} distance={3.2} decay={2.2} position={[0, 0, 1.1]} />
  </group>;
}

function CrystalScene(props: Omit<Props, "paused">) {
  return <>
    <ambientLight intensity={.62} color="#e7d7f5" />
    <directionalLight position={[-4, 6, 8]} intensity={2.1} color="#fff1fa" />
    <directionalLight position={[5, -3, 5]} intensity={1.25} color="#a7dcf0" />
    <pointLight position={[0, 1, 5]} intensity={14} distance={16} color="#f2c3dc" />
    {props.stars.map((layout, index) => <CrystalStar key={index} index={index} theme={props.theme} layout={layout} motion={props.motion} stage={props.stage} hovered={props.hovered === index} selected={props.selected} />)}
    <Environment resolution={64} frames={1}>
      <Lightformer intensity={2.2} color="#fff3fa" position={[0, 5, 5]} scale={[7, 2, 1]} />
      <Lightformer intensity={1.5} color="#aee5f0" position={[-5, 0, 2]} rotation={[0, Math.PI / 2, 0]} scale={[4, 6, 1]} />
      <Lightformer intensity={1.7} color="#f2b6d8" position={[5, -1, 1]} rotation={[0, -Math.PI / 2, 0]} scale={[3, 5, 1]} />
    </Environment>
  </>;
}

export function StarCrystalField({ paused, ...props }: Props) {
  return <Canvas
    className={styles.crystalCanvas}
    orthographic
    frameloop={paused ? "demand" : "always"}
    camera={{ position: [0, 0, 10], zoom: 100, near: .1, far: 100 }}
    dpr={[1, 1.6]}
    gl={{ alpha: true, antialias: true, powerPreference: "high-performance", stencil: false }}
    resize={{ debounce: { scroll: 0, resize: 80 } }}
  >
    <CrystalScene {...props} />
  </Canvas>;
}
