"use client";

import { useEffect, useRef, useState } from "react";
import type { Program, Renderer, Triangle } from "ogl";
import { shinianOrbFragment, shinianOrbVertex } from "./shinian-orb-shaders";
import styles from "./shinian-orb.module.css";

export function ShinianOrb({ paused = false, className = "" }: { paused?: boolean; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "fallback">("loading");

  useEffect(() => {
    const container = host.current;
    if (!container) return;

    let disposed = false;
    let renderer: Renderer | undefined;
    let program: Program | undefined;
    let geometry: Triangle | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let intersectionObserver: IntersectionObserver | undefined;
    let frame = 0;
    let visible = true;
    let startTime = performance.now();
    const removers: Array<() => void> = [];
    const pointer = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
    const fail = () => { if (!disposed) { stop(); setState("fallback"); } };

    void import("ogl").then(({ Renderer, Program, Triangle, Mesh }) => {
      if (disposed) return;
      const compactDevice = navigator.hardwareConcurrency <= 4 || window.innerWidth < 760;
      renderer = new Renderer({
        webgl: 2,
        dpr: Math.min(window.devicePixelRatio || 1, compactDevice ? 1.1 : 1.55),
        alpha: false,
        antialias: false,
        depth: false,
        preserveDrawingBuffer: true,
        powerPreference: compactDevice ? "low-power" : "high-performance",
      });
      if (!renderer.isWebgl2) { fail(); return; }

      const activeRenderer = renderer;
      const gl = activeRenderer.gl;
      gl.canvas.setAttribute("aria-hidden", "true");
      const uniforms = {
        uResolution: { value: [1, 1] },
        uPointer: { value: [0.5, 0.5] },
        uTime: { value: 0 },
      };
      program = new Program(gl, { vertex: shinianOrbVertex, fragment: shinianOrbFragment, uniforms, depthTest: false, depthWrite: false });
      if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) { fail(); return; }
      geometry = new Triangle(gl);
      const mesh = new Mesh(gl, { geometry, program });

      const resize = () => {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (!width || !height) return;
        activeRenderer.setSize(width, height);
        uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height];
        draw(performance.now());
      };

      const schedule = () => {
        if (!frame && visible && !document.hidden && !disposed && !paused && !reducedMotion.matches) frame = requestAnimationFrame(draw);
      };

      function draw(now: number) {
        stop();
        if (disposed || !visible || document.hidden) return;
        pointer.x += (pointer.targetX - pointer.x) * 0.055;
        pointer.y += (pointer.targetY - pointer.y) * 0.055;
        uniforms.uPointer.value = [pointer.x, pointer.y];
        uniforms.uTime.value = reducedMotion.matches ? 0 : (now - startTime) / 1000;
        try { activeRenderer.render({ scene: mesh }); }
        catch { fail(); return; }
        schedule();
      }

      const move = (event: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        pointer.targetX = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        pointer.targetY = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
        if (event.pointerType !== "mouse") { pointer.x = pointer.targetX; pointer.y = pointer.targetY; }
        if (paused || reducedMotion.matches) draw(performance.now());
      };
      const resetPointer = () => { pointer.targetX = 0.5; pointer.targetY = 0.5; };
      const visibility = () => { if (document.hidden) stop(); else { startTime = performance.now() - uniforms.uTime.value * 1000; draw(performance.now()); } };
      const motionChange = () => { startTime = performance.now(); draw(performance.now()); };
      const contextLost = (event: Event) => { event.preventDefault(); fail(); };

      container.appendChild(gl.canvas);
      container.addEventListener("pointermove", move, { passive: true });
      container.addEventListener("pointerdown", move, { passive: true });
      container.addEventListener("pointerleave", resetPointer);
      document.addEventListener("visibilitychange", visibility);
      reducedMotion.addEventListener("change", motionChange);
      gl.canvas.addEventListener("webglcontextlost", contextLost);
      removers.push(
        () => container.removeEventListener("pointermove", move),
        () => container.removeEventListener("pointerdown", move),
        () => container.removeEventListener("pointerleave", resetPointer),
        () => document.removeEventListener("visibilitychange", visibility),
        () => reducedMotion.removeEventListener("change", motionChange),
        () => gl.canvas.removeEventListener("webglcontextlost", contextLost),
      );
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      intersectionObserver = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) draw(performance.now()); else stop();
      });
      intersectionObserver.observe(container);
      setState("ready");
      resize();
    }).catch(fail);

    return () => {
      disposed = true;
      stop();
      removers.forEach(remove => remove());
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      const gl = renderer?.gl;
      geometry?.remove();
      program?.remove();
      if (gl) { gl.canvas.remove(); gl.getExtension("WEBGL_lose_context")?.loseContext(); }
    };
  }, [paused]);

  return <div ref={host} className={`${styles.root} ${className}`} data-state={state} aria-hidden="true"><span className={styles.fallback} /></div>;
}
