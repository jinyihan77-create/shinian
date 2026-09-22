"use client";

/**
 * Pixel reveal adapted from React Bits PixelCard by David Haz.
 * https://github.com/DavidHDev/react-bits/tree/main/src/ts-default/Components/PixelCard
 * MIT + Commons Clause License Condition v1.0
 * Copyright (c) 2026 David Haz
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, and distribute the Software as part of an
 * application, website, or product, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * You may use this Software, including for any commercial purpose, so long as
 * you do not sell, sublicense, or redistribute the components themselves—whether
 * alone, in a bundle, or as a ported version.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import styles from "./pixel-card.module.css";

const PALETTES = {
  default: "#d6cbdc,#b8a7c6,#e4dce8",
  blue: "#a4b9cf,#c2cdd9,#909fb8",
  yellow: "#c5b28e,#ddd1b8,#ad9879",
  pink: "#c996b0,#b99cb9,#e3c8d5",
};

export interface PixelCardProps {
  variant?: keyof typeof PALETTES;
  colors?: string;
  gap?: number;
  speed?: number;
  noFocus?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  "aria-label"?: string;
}

type Pixel = { x: number; y: number; color: string; size: number; max: number; phase: number; delay: number };

/** Soft rose pixels over a translucent surface. Children may be positioned absolutely. */
export default function PixelCard({
  variant = "pink", colors, gap = 7, speed = 28, noFocus = false,
  className = "", style, children, "aria-label": label,
}: PixelCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const palette = colors || PALETTES[variant];

  useEffect(() => {
    const card = containerRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!card || !canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const spacing = Number.isFinite(gap) ? Math.max(3, Math.min(gap, 40)) : 5;
    const motionSpeed = Number.isFinite(speed) ? Math.max(0, Math.min(speed, 100)) : 28;
    const swatches = palette.split(",").map(color => color.trim()).filter(color => CSS.supports("color", color));
    if (!swatches.length) swatches.push(...PALETTES.pink.split(","));
    let pixels: Pixel[] = [];
    let width = 0, height = 0, frame = 0, previous = 0, elapsed = 0;
    let hovered = false, focused = false, touched = false, active = false;
    let touchTimer: ReturnType<typeof setTimeout> | undefined;

    const stop = () => { cancelAnimationFrame(frame); frame = 0; previous = 0; };
    const draw = (time: number) => {
      frame = 0;
      if (document.hidden) return;
      const delta = previous ? Math.min((time - previous) / 16.67, 3) : 1;
      previous = time;
      elapsed += delta;
      const still = reduced.matches || motionSpeed === 0;
      ctx.clearRect(0, 0, width, height);
      let visible = false;
      for (const pixel of pixels) {
        if (still) pixel.size = active ? pixel.max : 0;
        else if (active && elapsed > pixel.delay) {
          const target = pixel.max * (0.72 + Math.sin(elapsed * motionSpeed * 0.001 + pixel.phase) * 0.28);
          pixel.size += (target - pixel.size) * Math.min(1, 0.16 * delta);
        } else if (!active) pixel.size = Math.max(0, pixel.size - 0.13 * delta);
        if (pixel.size < 0.02) continue;
        visible = true;
        ctx.fillStyle = pixel.color;
        ctx.fillRect(pixel.x - pixel.size / 2, pixel.y - pixel.size / 2, pixel.size, pixel.size);
      }
      if (!still && (active || visible)) frame = requestAnimationFrame(draw);
    };
    const start = () => { if (!frame && !document.hidden) frame = requestAnimationFrame(draw); };
    const sync = () => {
      const next = hovered || focused || touched;
      if (next && !active) elapsed = 0;
      active = next;
      card.dataset.active = String(active);
      start();
    };
    const resize = () => {
      width = card.clientWidth;
      height = card.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pixels = [];
      for (let x = spacing / 2; x < width; x += spacing) {
        for (let y = spacing / 2; y < height; y += spacing) {
          pixels.push({ x, y, color: swatches[Math.floor(Math.random() * swatches.length)],
            size: 0, max: 0.32 + Math.random() * 0.78, phase: Math.random() * Math.PI * 2,
            delay: Math.hypot(x - width / 2, y - height / 2) / 11 });
        }
      }
      elapsed = 0;
      start();
    };
    const enter = (event: PointerEvent) => { if (event.pointerType !== "touch") { hovered = true; sync(); } };
    const leave = () => { hovered = false; sync(); };
    const focusIn = () => { if (!noFocus) { focused = true; sync(); } };
    const focusOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) { focused = false; sync(); }
    };
    const touch = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      clearTimeout(touchTimer);
      touched = true; sync();
      touchTimer = setTimeout(() => { touched = false; sync(); }, 1000);
    };
    const preference = () => { stop(); start(); };
    const visibility = () => { if (document.hidden) stop(); else start(); };
    const observer = new ResizeObserver(resize);
    observer.observe(card);
    resize();
    card.addEventListener("pointerenter", enter);
    card.addEventListener("pointerleave", leave);
    card.addEventListener("pointerdown", touch);
    card.addEventListener("focusin", focusIn);
    card.addEventListener("focusout", focusOut);
    reduced.addEventListener("change", preference);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stop(); clearTimeout(touchTimer); observer.disconnect();
      card.removeEventListener("pointerenter", enter);
      card.removeEventListener("pointerleave", leave);
      card.removeEventListener("pointerdown", touch);
      card.removeEventListener("focusin", focusIn);
      card.removeEventListener("focusout", focusOut);
      reduced.removeEventListener("change", preference);
      document.removeEventListener("visibilitychange", visibility);
      delete card.dataset.active;
    };
  }, [palette, gap, speed, noFocus]);

  return (
    <div ref={containerRef} className={`${styles.card} ${className}`} style={style}
      tabIndex={noFocus ? undefined : 0} aria-label={label}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
