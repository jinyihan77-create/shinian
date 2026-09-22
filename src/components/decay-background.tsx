"use client";

// Original artwork and interaction implementation, inspired by the velocity-driven
// SVG displacement in React Bits DecayCard: https://reactbits.dev/components/decay-card

import { useEffect, useId, useRef, type CSSProperties } from "react";
import styles from "./decay-background.module.css";

export interface DecayBackgroundProps {
  colors?: string[];
  seed?: number;
  paused?: boolean;
  className?: string;
}

const DEFAULT_COLORS = ["#c084fc", "#f472b6", "#38bdf8"];

export default function DecayBackground({
  colors = DEFAULT_COLORS,
  seed = 1,
  paused = false,
  className = "",
}: DecayBackgroundProps) {
  const generatedId = useId();
  const id = `decay-${generatedId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const surfaceRef = useRef<HTMLSpanElement>(null);
  const displacementRef = useRef<SVGFEDisplacementMapElement>(null);
  const spotlightRef = useRef<SVGRadialGradientElement>(null);
  const distortedRef = useRef<SVGGElement>(null);
  const validColors = colors.filter((color) => color.trim());
  const palette = validColors.length ? validColors : DEFAULT_COLORS;
  const colorA = palette[0];
  const colorB = palette[1 % palette.length];
  const colorC = palette[2 % palette.length];
  const noiseSeed = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) % 1000 + 1 : 1;

  useEffect(() => {
    const surface = surfaceRef.current;
    const parent = surface?.parentElement;
    const displacement = displacementRef.current;
    const spotlight = spotlightRef.current;
    const distorted = distortedRef.current;
    if (!surface || !parent || !displacement || !spotlight || !distorted) return;

    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = !document.hidden;
    let inView = typeof IntersectionObserver === "undefined";
    let running = false;
    let frame: number | null = null;
    let previousFrame = 0;
    let energy = 0;
    let targetEnergy = 0;
    let dragX = 0;
    let dragY = 0;
    let targetX = 0;
    let targetY = 0;
    let previousPointer: { x: number; y: number; time: number } | null = null;
    let filterEnabled = false;

    function clearInteraction() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      previousFrame = 0;
      previousPointer = null;
      energy = targetEnergy = dragX = dragY = targetX = targetY = 0;
      surface!.style.setProperty("--drag-x", "0px");
      surface!.style.setProperty("--drag-y", "0px");
      surface!.style.setProperty("--decay-opacity", "0");
      displacement!.setAttribute("scale", "0");
      distorted!.removeAttribute("filter");
      filterEnabled = false;
    }

    function syncActivity() {
      running = !paused && visible && inView && !preference.matches;
      surface!.dataset.motion = running ? "running" : "paused";
      if (!running) clearInteraction();
    }

    function tick(now: number) {
      frame = null;
      if (!running) return;
      const elapsed = previousFrame ? Math.min(now - previousFrame, 48) : 16;
      previousFrame = now;
      const smoothing = 1 - Math.exp(-elapsed / 90);
      const dragSmoothing = 1 - Math.exp(-elapsed / 125);
      energy += (targetEnergy - energy) * smoothing;
      targetEnergy *= Math.exp(-elapsed / 130);
      dragX += (targetX - dragX) * dragSmoothing;
      dragY += (targetY - dragY) * dragSmoothing;

      const active = energy > 0.15;
      if (active && !filterEnabled) {
        distorted!.setAttribute("filter", `url(#${id}-displacement)`);
        filterEnabled = true;
      } else if (!active && filterEnabled) {
        distorted!.removeAttribute("filter");
        filterEnabled = false;
      }
      displacement!.setAttribute("scale", active ? energy.toFixed(2) : "0");
      surface!.style.setProperty("--decay-opacity", active ? Math.min(0.75, energy / 70).toFixed(3) : "0");
      surface!.style.setProperty("--drag-x", `${dragX.toFixed(2)}px`);
      surface!.style.setProperty("--drag-y", `${dragY.toFixed(2)}px`);

      const settled = energy < 0.15 && targetEnergy < 0.15 &&
        Math.abs(targetX - dragX) < 0.02 && Math.abs(targetY - dragY) < 0.02;
      if (!settled) frame = requestAnimationFrame(tick);
      else previousFrame = 0;
    }

    function requestTick() {
      if (running && frame === null) frame = requestAnimationFrame(tick);
    }

    function onPointerMove(event: PointerEvent) {
      if (!running || event.pointerType === "touch") return;
      const rect = parent!.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const now = performance.now();
      const localX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const localY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      spotlight!.setAttribute("cx", `${localX * 1000}`);
      spotlight!.setAttribute("cy", `${localY * 650}`);
      targetX = (localX - 0.5) * 14;
      targetY = (localY - 0.5) * 10;
      if (previousPointer) {
        const distance = Math.hypot(event.clientX - previousPointer.x, event.clientY - previousPointer.y);
        const speed = distance / Math.max(12, now - previousPointer.time);
        targetEnergy = Math.max(targetEnergy, Math.min(105, speed * 55));
      }
      previousPointer = { x: event.clientX, y: event.clientY, time: now };
      requestTick();
    }

    function onPointerLeave() {
      previousPointer = null;
      targetEnergy = targetX = targetY = 0;
      requestTick();
    }

    function onVisibility() {
      visible = !document.hidden;
      syncActivity();
    }

    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      inView = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0);
      syncActivity();
    }, { threshold: 0 });
    observer?.observe(parent);
    parent.addEventListener("pointermove", onPointerMove, { passive: true });
    parent.addEventListener("pointerleave", onPointerLeave, { passive: true });
    parent.addEventListener("pointercancel", onPointerLeave, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    preference.addEventListener("change", syncActivity);
    syncActivity();

    return () => {
      observer?.disconnect();
      parent.removeEventListener("pointermove", onPointerMove);
      parent.removeEventListener("pointerleave", onPointerLeave);
      parent.removeEventListener("pointercancel", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      preference.removeEventListener("change", syncActivity);
      surface.dataset.motion = "paused";
      clearInteraction();
    };
  }, [id, paused]);

  return (
    <span
      ref={surfaceRef}
      className={`${styles.surface} ${className}`.trim()}
      aria-hidden="true"
      data-motion="paused"
      style={{ "--flow-delay": `${-(noiseSeed % 19)}s` } as CSSProperties}
    >
      <span className={styles.response}>
        <svg className={styles.artwork} viewBox="0 0 1000 650" preserveAspectRatio="none" focusable="false">
          <defs>
            <radialGradient id={`${id}-cloud-a`}>
              <stop stopColor={colorA} stopOpacity="0.72" />
              <stop offset="0.48" stopColor={colorA} stopOpacity="0.3" />
              <stop offset="1" stopColor={colorA} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${id}-cloud-b`}>
              <stop stopColor={colorB} stopOpacity="0.62" />
              <stop offset="0.45" stopColor={colorB} stopOpacity="0.24" />
              <stop offset="1" stopColor={colorB} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${id}-cloud-c`}>
              <stop stopColor={colorC} stopOpacity="0.58" />
              <stop offset="0.5" stopColor={colorC} stopOpacity="0.18" />
              <stop offset="1" stopColor={colorC} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${id}-ribbon`} x1="0" y1="1" x2="1" y2="0">
              <stop stopColor={colorA} stopOpacity="0" />
              <stop offset="0.3" stopColor={colorA} stopOpacity="0.34" />
              <stop offset="0.6" stopColor={colorB} stopOpacity="0.5" />
              <stop offset="0.84" stopColor={colorC} stopOpacity="0.24" />
              <stop offset="1" stopColor={colorC} stopOpacity="0" />
            </linearGradient>
            <radialGradient ref={spotlightRef} id={`${id}-spotlight`} gradientUnits="userSpaceOnUse" cx="500" cy="325" r="310">
              <stop stopColor="white" stopOpacity="0.95" />
              <stop offset="0.45" stopColor="white" stopOpacity="0.68" />
              <stop offset="1" stopColor="white" stopOpacity="0" />
            </radialGradient>
            <mask id={`${id}-local-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="650">
              <rect width="1000" height="650" fill={`url(#${id}-spotlight)`} />
            </mask>
            <filter id={`${id}-displacement`} x="-15%" y="-20%" width="130%" height="140%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.014 0.02" numOctaves="2" seed={noiseSeed} stitchTiles="stitch" result="flow-noise" />
              <feDisplacementMap ref={displacementRef} in="SourceGraphic" in2="flow-noise" scale="0" xChannelSelector="R" yChannelSelector="B" />
            </filter>
            <g id={`${id}-art`}>
              <g className={styles.cloudA}>
                <ellipse cx="160" cy="520" rx="580" ry="390" fill={`url(#${id}-cloud-a)`} />
                <path d="M-140 690 C160 285 390 705 700 310 S1020 70 1200 90 L1130 330 C920 120 920 630 590 545 S105 700 -140 810Z" fill={`url(#${id}-ribbon)`} />
              </g>
              <g className={styles.cloudB}>
                <ellipse cx="890" cy="50" rx="550" ry="450" fill={`url(#${id}-cloud-b)`} />
                <path d="M-90 490 C280 710 260 -80 670 155 S1090 290 1170 -80 L1160 105 C980 480 815 350 645 210 S365 840 -110 610Z" fill={`url(#${id}-ribbon)`} opacity="0.72" />
              </g>
              <g className={styles.cloudC}>
                <ellipse cx="630" cy="620" rx="620" ry="380" fill={`url(#${id}-cloud-c)`} />
              </g>
            </g>
          </defs>
          <use href={`#${id}-art`} />
          <g className={styles.distortion} mask={`url(#${id}-local-mask)`}>
            <g ref={distortedRef}>
              <use href={`#${id}-art`} />
            </g>
          </g>
        </svg>
      </span>
      <span className={styles.readingShade} />
    </span>
  );
}
