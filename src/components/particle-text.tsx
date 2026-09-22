"use client";

import { useEffect, useRef } from "react";
import styles from "./particle-text.module.css";

// Adapted from the React Bits ParticleText source supplied by the user.
// Keep real heading text, sample Chinese glyphs at their rendered size, and
// render only during the brief gather/pointer interaction. No extra dependency.
interface Particle {
  x: number; y: number; startX: number; startY: number;
  targetX: number; targetY: number; seed: number; alpha: number; color: string;
}

interface ParticleTextProps {
  text: string;
  highlightColor?: string;
  scatter?: number;
  gatherDuration?: number;
}

const motionQuery = "(min-width: 761px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export default function ParticleText({ text, highlightColor = "#ae80b4", scatter = 21, gatherDuration = 950 }: ParticleTextProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const media = matchMedia(motionQuery);
    let disposed = false;
    let visible = true;
    let frame = 0;
    let resizeFrame = 0;
    let buildId = 0;
    let width = 0;
    let height = 0;
    let previousSize = "";
    let startedAt = 0;
    let activeUntil = 0;
    let lastHover = -Infinity;
    let particles: Particle[] = [];
    const pointer = { x: 0, y: 0, active: false };

    const stop = () => {
      cancelAnimationFrame(frame); frame = 0;
      pointer.active = false;
      host.removeAttribute("data-forming");
    };
    const fallback = () => {
      stop(); host.removeAttribute("data-ready"); previousSize = "";
    };
    const canAnimate = () => !disposed && media.matches && visible && !document.hidden;

    const draw = (now: number) => {
      frame = 0;
      if (!canAnimate()) { stop(); return; }
      context.clearRect(0, 0, width, height);
      let settled = now >= activeUntil;
      for (const particle of particles) {
        const progress = clamp((now - startedAt - particle.seed * 140) / gatherDuration);
        const eased = 1 - Math.pow(1 - progress, 3);
        let x = particle.startX + (particle.targetX - particle.startX) * eased;
        let y = particle.startY + (particle.targetY - particle.startY) * eased;
        if (pointer.active) {
          const dx = x - pointer.x; const dy = y - pointer.y;
          const distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < 48) {
            const force = Math.pow(1 - distance / 48, 2) * 7;
            x += dx / distance * force; y += dy / distance * force;
          }
        }
        particle.x += (x - particle.x) * 0.28;
        particle.y += (y - particle.y) * 0.28;
        if (progress < 1 || Math.abs(x - particle.x) + Math.abs(y - particle.y) > 0.08) settled = false;
        context.globalAlpha = particle.alpha * (0.25 + progress * 0.75);
        context.fillStyle = particle.color;
        context.fillRect(particle.x - 0.82, particle.y - 0.82, 1.64, 1.64);
      }
      context.globalAlpha = 1;
      if (!settled) frame = requestAnimationFrame(draw);
      else host.removeAttribute("data-forming");
    };
    const wake = () => {
      if (!frame && particles.length && canAnimate()) frame = requestAnimationFrame(draw);
    };
    const gather = () => {
      if (!canAnimate() || !particles.length) return;
      startedAt = performance.now(); activeUntil = startedAt + gatherDuration + 400;
      for (const particle of particles) {
        const angle = particle.seed * Math.PI * 2;
        const distance = scatter * (0.25 + particle.seed * 0.75);
        particle.startX = particle.targetX + Math.cos(angle) * distance;
        particle.startY = particle.targetY + Math.sin(angle) * distance;
        particle.x = particle.startX; particle.y = particle.startY;
      }
      host.dataset.forming = "true";
      wake();
    };

    const sample = async () => {
      const currentBuild = ++buildId;
      if (!media.matches || disposed) { fallback(); return; }
      try {
        if (document.fonts) await document.fonts.ready;
        if (disposed || currentBuild !== buildId || !media.matches) return;
        const box = host.getBoundingClientRect();
        const computed = getComputedStyle(host);
        width = Math.ceil(box.width); height = Math.ceil(box.height);
        if (!width || !height) { fallback(); return; }
        const sizeKey = `${width}:${height}:${computed.fontSize}:${computed.fontFamily}:${computed.color}`;
        if (sizeKey === previousSize && particles.length) { wake(); return; }
        previousSize = sizeKey;
        stop();
        const pixelRatio = Math.min(devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio);
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        const offscreen = document.createElement("canvas");
        offscreen.width = width; offscreen.height = height;
        const sampler = offscreen.getContext("2d", { willReadFrequently: true });
        if (!sampler) { fallback(); return; }
        sampler.font = `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
        sampler.letterSpacing = computed.letterSpacing === "normal" ? "0px" : computed.letterSpacing;
        sampler.fillStyle = "#fff";
        const metrics = sampler.measureText(text);
        const fontSize = parseFloat(computed.fontSize);
        const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
        const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
        sampler.fillText(text, 0, (height + ascent - descent) / 2);
        const pixels = sampler.getImageData(0, 0, width, height).data;
        const next: Particle[] = [];
        for (let y = 0; y < height; y += 2) {
          for (let x = 0; x < width; x += 2) {
            const alpha = pixels[(y * width + x) * 4 + 3] / 255;
            if (alpha <= 0.18) continue;
            const seed = ((next.length * 9301 + 49297) % 233280) / 233280;
            next.push({ x, y, startX: x, startY: y, targetX: x, targetY: y, seed, alpha,
              color: seed > 0.8 ? highlightColor : computed.color });
          }
        }
        if (!next.length) { fallback(); return; }
        // A short Chinese heading remains dense enough to read without
        // leaving an unbounded particle loop for unexpectedly large text.
        const stride = Math.max(1, Math.ceil(next.length / 2400));
        particles = next.filter((_, index) => index % stride === 0);
        host.dataset.ready = "true";
        if (canAnimate()) gather();
        else host.removeAttribute("data-ready");
      } catch { fallback(); }
    };
    const queueSample = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; void sample(); });
    };
    const move = (event: PointerEvent) => {
      if (!canAnimate() || event.pointerType === "touch") return;
      const box = host.getBoundingClientRect();
      pointer.x = event.clientX - box.left; pointer.y = event.clientY - box.top;
      pointer.active = true; activeUntil = Math.max(activeUntil, performance.now() + 240); wake();
    };
    const enter = (event: PointerEvent) => {
      if (!canAnimate() || event.pointerType === "touch") return;
      if (performance.now() - lastHover > 1700) { lastHover = performance.now(); gather(); }
      move(event);
    };
    const leave = () => { pointer.active = false; activeUntil = Math.max(activeUntil, performance.now() + 300); wake(); };
    const updateVisibility = () => {
      if (!canAnimate()) stop();
      else { previousSize = ""; queueSample(); }
    };
    const motionChanged = () => {
      ++buildId;
      if (!media.matches) fallback(); else { previousSize = ""; queueSample(); }
    };
    const resize = new ResizeObserver(queueSample);
    resize.observe(host);
    const observer = new IntersectionObserver(([entry]) => {
      const nextVisible = entry.isIntersecting;
      if (nextVisible !== visible) { visible = nextVisible; updateVisibility(); }
    });
    observer.observe(host);
    media.addEventListener("change", motionChanged);
    document.addEventListener("visibilitychange", updateVisibility);
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    void sample();
    return () => {
      disposed = true; ++buildId; stop();
      cancelAnimationFrame(resizeFrame);
      resize.disconnect(); observer.disconnect();
      media.removeEventListener("change", motionChanged);
      document.removeEventListener("visibilitychange", updateVisibility);
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
    };
  }, [text, highlightColor, scatter, gatherDuration]);

  return <span ref={hostRef} className={styles.root}>
    <span className={styles.text}>{text}</span>
    <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
  </span>;
}
