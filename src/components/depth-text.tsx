"use client";

import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import styles from "./depth-text.module.css";

type DepthTextProps = {
  text: string;
  children?: ReactNode;
  layers?: number;
  depth?: number;
  faceColor?: string;
  depthColor?: string;
  tilt?: number;
  pointerTracking?: boolean;
  smoothing?: number;
  perspective?: number;
  autoOrbit?: boolean;
  orbitSpeed?: number;
  fontSize?: string;
  fontWeight?: CSSProperties["fontWeight"];
  shadow?: boolean;
  className?: string;
  style?: CSSProperties;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const transform = (x: number, y: number) => `rotateX(${x.toFixed(3)}deg) rotateY(${y.toFixed(3)}deg)`;

/** Adapted from the supplied React Bits DepthText, with quieter motion for reading. */
export default function DepthText({
  text, children, layers = 22, depth = 1.15, faceColor = "#493d59", depthColor = "#becaea",
  tilt = 10, pointerTracking = true, smoothing = 0.14, perspective = 900,
  autoOrbit = false, orbitSpeed = 0.35, fontSize = "inherit", fontWeight = 750,
  shadow = true, className = "", style,
}: DepthTextProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const stageRef = useRef<HTMLSpanElement>(null);
  const safeLayers = clamp(Math.round(Number(layers) || 2), 2, 64);
  const safeDepth = clamp(Number(depth) || 0, 0, 12);
  const safeTilt = clamp(Number(tilt) || 0, 0, 12);
  const safeSmoothing = clamp(Number(smoothing) || 0.14, 0.02, 0.35);
  const safePerspective = clamp(Number(perspective) || 900, 300, 2000);
  const safeOrbitSpeed = clamp(Number(orbitSpeed) || 0, 0, 2);
  const base = useMemo(() => ({ x: -safeTilt * 0.42, y: safeTilt * 0.52 }), [safeTilt]);
  const depthLayers = useMemo(() => Array.from({ length: safeLayers }, (_, offset) => {
    const index = safeLayers - offset;
    return {
      index,
      color: `color-mix(in srgb, var(--echo-pink, #ffabe2) ${Math.round((1 - index / safeLayers) * 100)}%, ${depthColor})`,
      transform: `translateZ(${-index * safeDepth}px)`,
    };
  }), [safeLayers, safeDepth, depthColor]);

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(min-width: 761px) and (hover: hover) and (pointer: fine)");
    const current = { ...base };
    const target = { ...base };
    let visible = true;
    let activePointer = false;
    let frame = 0;
    let disposed = false;
    const started = performance.now();
    const canAnimate = () => !disposed && visible && !document.hidden && !reduced.matches && fine.matches;
    const orbiting = () => autoOrbit && safeOrbitSpeed > 0 && safeTilt > 0 && !activePointer;
    const apply = () => { stage.style.transform = transform(current.x, current.y); };
    const tick = (now: number) => {
      frame = 0;
      if (!canAnimate()) return;
      if (orbiting()) {
        const angle = (now - started) / 1000 * safeOrbitSpeed * Math.PI * 2;
        target.x = base.x + Math.sin(angle) * safeTilt * 0.18;
        target.y = base.y + Math.cos(angle * 0.85) * safeTilt * 0.18;
      }
      current.x += (target.x - current.x) * safeSmoothing;
      current.y += (target.y - current.y) * safeSmoothing;
      apply();
      if (orbiting() || Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > 0.005) {
        frame = requestAnimationFrame(tick);
      }
    };
    const start = () => { if (!frame && canAnimate()) frame = requestAnimationFrame(tick); };
    const move = (event: PointerEvent) => {
      if (!pointerTracking || !canAnimate() || event.pointerType === "touch") return;
      const rect = root.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      activePointer = true;
      const x = clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1);
      const y = clamp((event.clientY - rect.top) / rect.height * 2 - 1, -1, 1);
      target.x = base.x - y * safeTilt * 0.5;
      target.y = base.y + x * safeTilt * 0.5;
      start();
    };
    const leave = () => {
      activePointer = false;
      Object.assign(target, base);
      start();
    };
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      activePointer = false;
      Object.assign(current, base);
      Object.assign(target, base);
      apply();
      if (orbiting()) start();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      refresh();
    });
    observer.observe(root);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    reduced.addEventListener("change", refresh);
    fine.addEventListener("change", refresh);
    document.addEventListener("visibilitychange", refresh);
    refresh();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
      reduced.removeEventListener("change", refresh);
      fine.removeEventListener("change", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [autoOrbit, base, pointerTracking, safeOrbitSpeed, safeSmoothing, safeTilt]);

  const rootStyle = {
    ...style,
    "--depth-perspective": `${safePerspective}px`,
    "--depth-size": fontSize,
    "--depth-weight": fontWeight,
    "--depth-face": faceColor,
    "--depth-shadow": shadow ? `0 8px 16px color-mix(in srgb, ${depthColor} 35%, transparent), 0 2px 1px #dbd0ad55` : "none",
  } as CSSProperties;

  return <span ref={rootRef} className={`${styles.root} ${className}`.trim()} style={rootStyle} data-depth-text="">
    <span ref={stageRef} className={styles.stage} style={{ transform: transform(base.x, base.y) }}>
      {depthLayers.map(layer => <span key={layer.index} aria-hidden="true" className={styles.layer} style={{ color: layer.color, transform: layer.transform }}>{text}</span>)}
      <span className={styles.face}>{children ?? text}</span>
    </span>
  </span>;
}
