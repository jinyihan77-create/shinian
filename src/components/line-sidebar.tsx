"use client";

// Proximity interaction adapted from React Bits LineSidebar.
// https://github.com/DavidHDev/react-bits/tree/main/src/ts-default/Components/LineSidebar
// The upstream license is included in line-sidebar.LICENSE.txt.
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import styles from "./line-sidebar.module.css";

export interface LineSidebarProps {
  items: string[];
  accentColor?: string;
  textColor?: string;
  markerColor?: string;
  showIndex?: boolean;
  showMarker?: boolean;
  proximityRadius?: number;
  maxShift?: number;
  falloff?: "linear" | "smooth" | "sharp";
  markerLength?: number;
  markerGap?: number;
  tickScale?: number;
  scaleTick?: boolean;
  itemGap?: number;
  fontSize?: number;
  smoothing?: number;
  defaultActive?: number | null;
  /** Controlled by the actual page, including cancelled navigation. */
  activeIndex?: number | null;
  onItemClick?: (index: number, label: string) => void;
  className?: string;
}

export default function LineSidebar({
  items, accentColor = "#A855F7", textColor = "#c4c4c4", markerColor = "#6c6c6c",
  showIndex = true, showMarker = true, proximityRadius = 100, maxShift = 30,
  falloff = "smooth", markerLength = 60, markerGap = 0, tickScale = 0.5,
  scaleTick = true, itemGap = 20, fontSize = 1.1, smoothing = 100,
  defaultActive = 0, activeIndex, onItemClick, className = "",
}: LineSidebarProps) {
  const [localActive, setLocalActive] = useState<number | null>(defaultActive);
  const selected = activeIndex === undefined ? localActive : activeIndex;
  const listRef = useRef<HTMLUListElement>(null);
  const itemsRef = useRef<(HTMLLIElement | null)[]>([]);
  const values = useRef<number[]>([]);
  const targets = useRef<number[]>([]);
  const frame = useRef<number | null>(null);
  const selection = useRef(selected);
  const focused = useRef<number | null>(null);
  const reduced = useRef(false);
  const settleTime = useRef(smoothing);
  const lastFrame = useRef(0);
  selection.current = selected;
  settleTime.current = smoothing;

  function cancel() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }
  function render(now: number) {
    const dt = Math.min(50, Math.max(1, now - lastFrame.current));
    lastFrame.current = now;
    const factor = reduced.current ? 1 : 1 - Math.exp(-dt / Math.max(1, settleTime.current));
    let moving = false;
    itemsRef.current.forEach((item, index) => {
      if (!item) return;
      const target = Math.max(targets.current[index] || 0, selection.current === index || focused.current === index ? 1 : 0);
      const current = values.current[index] || 0;
      const next = current + (target - current) * factor;
      const settled = Math.abs(target - next) < 0.0015;
      values.current[index] = settled ? target : next;
      item.style.setProperty("--effect", String(values.current[index]));
      if (!settled) moving = true;
    });
    frame.current = moving && !document.hidden ? requestAnimationFrame(render) : null;
  }
  function start() {
    if (document.hidden || frame.current !== null) return;
    lastFrame.current = performance.now();
    frame.current = requestAnimationFrame(render);
  }
  function reset() { targets.current = []; start(); }
  function move(event: PointerEvent<HTMLUListElement>) {
    if (event.pointerType === "touch" || reduced.current) return;
    itemsRef.current.forEach((item, index) => {
      if (!item) return;
      const rect = item.getBoundingClientRect();
      const distance = Math.abs(event.clientY - rect.top - rect.height / 2);
      const p = Math.max(0, 1 - distance / Math.max(1, proximityRadius));
      targets.current[index] = falloff === "sharp" ? p ** 3 : falloff === "linear" ? p : p * p * (3 - 2 * p);
    });
    start();
  }

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { reduced.current = media.matches; targets.current = []; cancel(); start(); };
    const visibility = () => { cancel(); targets.current = []; if (!document.hidden) start(); };
    sync();
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", visibility);
    return () => { cancel(); media.removeEventListener("change", sync); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => { start(); }, [selected, items.length]);

  return <nav aria-label="刻度导航" className={`${styles.sidebar} ${showMarker ? styles.withMarkers : ""} ${scaleTick ? styles.scaledTicks : ""} ${className}`} style={{
    "--accent-color": accentColor, "--text-color": textColor, "--marker-color": markerColor,
    "--marker-length": `${markerLength}px`, "--marker-gap": `${markerGap}px`, "--tick-scale": tickScale,
    "--max-shift": `${maxShift}px`, "--item-gap": `${itemGap}px`, "--font-size": `${fontSize}rem`,
  } as CSSProperties}>
    <ul ref={listRef} className={styles.list} onPointerMove={move} onPointerLeave={reset} onPointerCancel={reset}>
      {items.map((label, index) => <li key={`${index}-${label}`} ref={el => { itemsRef.current[index] = el; }} className={styles.item}>
        <button type="button" className={styles.button} aria-current={selected === index ? "page" : undefined}
          onFocus={() => { focused.current = index; start(); }} onBlur={() => { focused.current = null; start(); }}
          onClick={() => { if (activeIndex === undefined) setLocalActive(index); onItemClick?.(index, label); }}>
          {showMarker && <span className={styles.marker} aria-hidden="true" />}
          <span className={styles.label}>{showIndex && <span className={styles.index} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>}<span>{label}</span></span>
        </button>
      </li>)}
    </ul>
  </nav>;
}
