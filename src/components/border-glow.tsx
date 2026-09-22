"use client";

/**
 * Adapted from React Bits BorderGlow by David Haz.
 * https://github.com/DavidHDev/react-bits/tree/main/src/ts-default/Components/BorderGlow
 *
 * MIT + Commons Clause License Condition v1.0
 *
 * Copyright (c) 2026 David Haz
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * ## Commons Clause Restriction
 *
 * You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**
 *
 * ## No Warranty
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import styles from "./border-glow.module.css";

export interface BorderGlowProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  edgeSensitivity?: number;
  glowColor?: string;
  backgroundColor?: string;
  /** Opacity of the dark surface only; text, borders and children stay opaque. */
  backgroundOpacity?: number;
  borderRadius?: number;
  glowRadius?: number;
  glowIntensity?: number;
  coneSpread?: number;
  /** A single introductory sweep, with no continuing idle animation. */
  animated?: boolean;
  colors?: string[];
  fillOpacity?: number;
}

const DEFAULT_COLORS = ["#c084fc", "#f472b6", "#38bdf8"];
const GRADIENT_POSITIONS = ["80% 55%", "69% 34%", "8% 6%", "41% 38%", "86% 85%", "82% 18%", "51% 4%"];
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1];

function bound(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function buildGlowVars(glowColor: string, intensity: number) {
  const values = glowColor.match(/-?\d*\.?\d+/g)?.map(Number);
  const [h, s, l] = values?.length === 3 ? values : [40, 80, 80];
  const base = `${h}deg ${bound(s, 0, 100, 80)}% ${bound(l, 0, 100, 80)}%`;
  const result: Record<string, string> = {};
  for (const opacity of [100, 60, 50, 40, 30, 20, 10]) {
    result[`--glow-color${opacity === 100 ? "" : `-${opacity}`}`] =
      `hsl(${base} / ${Math.min(opacity * intensity, 100)}%)`;
  }
  return result;
}

export default function BorderGlow({
  children,
  className = "",
  style,
  edgeSensitivity = 30,
  glowColor = "40 80 80",
  backgroundColor = "#120F17",
  backgroundOpacity = 0.2,
  borderRadius = 28,
  glowRadius = 40,
  glowIntensity = 1,
  coneSpread = 25,
  animated = false,
  colors = DEFAULT_COLORS,
  fillOpacity = 0.15,
}: BorderGlowProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const sweepFrame = useRef<number | null>(null);
  const reduceMotion = useRef(false);

  function cancelSweep() {
    if (sweepFrame.current !== null) cancelAnimationFrame(sweepFrame.current);
    sweepFrame.current = null;
    cardRef.current?.removeAttribute("data-sweeping");
  }

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      reduceMotion.current = media.matches;
      if (media.matches) {
        cancelSweep();
        cardRef.current?.style.setProperty("--edge-proximity", "0");
      }
    };
    updatePreference();
    media.addEventListener("change", updatePreference);

    const card = cardRef.current;
    if (animated && !media.matches && card) {
      const start = performance.now();
      card.dataset.sweeping = "true";
      const tick = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / 3600, 1);
        const edge = Math.min(elapsed / 500, 1, (3600 - elapsed) / 900);
        card.style.setProperty("--cursor-angle", `${110 + 355 * progress}deg`);
        card.style.setProperty("--edge-proximity", `${Math.max(0, edge) * 100}`);
        if (progress < 1) sweepFrame.current = requestAnimationFrame(tick);
        else cancelSweep();
      };
      sweepFrame.current = requestAnimationFrame(tick);
    }
    return () => {
      media.removeEventListener("change", updatePreference);
      cancelSweep();
    };
  }, [animated]);

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" || reduceMotion.current) return;
    const card = cardRef.current;
    if (!card) return;
    cancelSweep();
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    const edge = Math.min(1, Math.max(Math.abs(dx) / (rect.width / 2), Math.abs(dy) / (rect.height / 2)));
    const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 450) % 360;
    card.style.setProperty("--edge-proximity", (edge * 100).toFixed(3));
    card.style.setProperty("--cursor-angle", `${angle.toFixed(3)}deg`);
  }

  function resetPointer() {
    cancelSweep();
    cardRef.current?.style.setProperty("--edge-proximity", "0");
  }

  const suppliedColors = colors.filter((color) => color.trim());
  const palette = suppliedColors.length ? suppliedColors : DEFAULT_COLORS;
  const mesh = GRADIENT_POSITIONS.map((position, index) =>
    `radial-gradient(at ${position}, ${palette[Math.min(COLOR_MAP[index], palette.length - 1)]} 0px, transparent 50%)`,
  ).concat(`linear-gradient(${palette[0]} 0 100%)`).join(", ");

  return (
    <div
      ref={cardRef}
      className={`${styles.card} ${className}`.trim()}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
      onPointerCancel={resetPointer}
      style={{
        "--card-bg": backgroundColor,
        "--surface-opacity": bound(backgroundOpacity, 0, 1, 0.2),
        "--edge-sensitivity": bound(edgeSensitivity, 0, 79, 30),
        "--border-radius": `${bound(borderRadius, 0, 200, 28)}px`,
        "--glow-padding": `${bound(glowRadius, 0, 120, 40)}px`,
        "--cone-spread": bound(coneSpread, 0, 35, 25),
        "--fill-opacity": bound(fillOpacity, 0, 1, 0.15),
        "--mesh-gradient": mesh,
        ...buildGlowVars(glowColor, bound(glowIntensity, 0, 3, 1)),
        ...style,
      } as CSSProperties}
    >
      <span className={styles.surface} aria-hidden="true" />
      <span className={styles.rim} aria-hidden="true" />
      <span className={styles.mesh} aria-hidden="true" />
      <span className={styles.fill} aria-hidden="true" />
      <span className={styles.edgeLight} aria-hidden="true" />
      <div className={styles.inner}>{children}</div>
    </div>
  );
}
