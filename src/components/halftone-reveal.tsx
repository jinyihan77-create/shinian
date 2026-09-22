"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Renderer, Program, Triangle, Texture } from "ogl";
import { vertex, fragment } from "./halftone-shaders";
import "./halftone-reveal.css";

// React Bits HalftoneReveal, adapted for TypeScript, demand rendering, touch,
// reduced motion, and a static fallback. See public/licenses/react-bits.txt.
interface HalftoneRevealProps {
  src?: string;
  inkColor?: string;
  paperColor?: string;
  mode?: "mono" | "duotone" | "color";
  dotSize?: number;
  dotDensity?: number;
  angle?: number;
  shape?: "circle" | "square" | "diamond" | "line";
  contrast?: number;
  invert?: boolean;
  revealRadius?: number;
  edge?: number;
  follow?: number;
  idleReveal?: number;
  trigger?: "hover" | "always" | "off";
  borderRadius?: string;
  className?: string;
  style?: CSSProperties;
  revealAll?: boolean;
  label?: string;
}
const modes = { mono: 0, duotone: 1, color: 2 };
const shapes = { circle: 0, square: 1, diamond: 2, line: 3 };
const triggers = { off: 0, hover: 1, always: 2 };
const rgb = (hex: string) => {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return match ? match.slice(1).map(value => parseInt(value, 16) / 255) : [0, 0, 0];
};

export default function HalftoneReveal({
  src = "/images/echo-dreamscape.svg", inkColor = "#76516f", paperColor = "#f3dfeb",
  mode = "mono", dotSize = 0.88, dotDensity = 65, angle = 28, shape = "circle",
  contrast = 1.1, invert = false, revealRadius = 0.33, edge = 0.35, follow = 0.2,
  idleReveal = 0, trigger = "hover", borderRadius = "18px", className = "", style,
  revealAll = false, label = "粉紫色山谷与月亮，移动指针或轻触可显露彩色画面",
}: HalftoneRevealProps) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "fallback">("loading");
  const [imageFailed, setImageFailed] = useState(false);
  const settings = useRef({ inkColor, paperColor, mode, dotSize, dotDensity, angle, shape, contrast, invert,
    revealRadius, edge, follow, idleReveal, trigger, revealAll });
  const refresh = useRef<(() => void) | null>(null);

  useEffect(() => {
    settings.current = { inkColor, paperColor, mode, dotSize, dotDensity, angle, shape, contrast, invert,
      revealRadius, edge, follow, idleReveal, trigger, revealAll };
    refresh.current?.();
  }, [inkColor, paperColor, mode, dotSize, dotDensity, angle, shape, contrast, invert,
    revealRadius, edge, follow, idleReveal, trigger, revealAll]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    setState("loading"); setImageFailed(false);
    let disposed = false;
    let failed = false;
    let loaded = false;
    let visible = false;
    let frame = 0;
    let lastFrame = 0;
    let renderer: Renderer | undefined;
    let program: Program | undefined;
    let geometry: Triangle | undefined;
    let texture: Texture | undefined;
    let observer: IntersectionObserver | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let image: HTMLImageElement | undefined;
    const removers: Array<() => void> = [];
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mouse = { x: 0.5, y: 0.5, sx: 0.5, sy: 0.5, active: 0, target: 0 };
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
    const fallback = () => { if (!disposed) { failed = true; stop(); setState("fallback"); } };

    // The module and GPU setup are client-only. A real local image is visible
    // while loading, and stays available if WebGL2 or the image cannot load.
    void import("ogl").then(({ Renderer, Texture, Program, Triangle, Mesh }) => {
      if (disposed) return;
      renderer = new Renderer({ webgl: 2, dpr: Math.min(window.devicePixelRatio || 1, 1.5),
        alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
      if (!renderer.isWebgl2) { fallback(); return; }
      const activeRenderer = renderer;
      const gl = renderer.gl;
      gl.canvas.setAttribute("aria-hidden", "true");
      texture = new Texture(gl, { generateMipmaps: false, minFilter: gl.LINEAR, magFilter: gl.LINEAR });
      const activeTexture = texture;
      const options = settings.current;
      const uniforms = {
        tMap: { value: texture }, iResolution: { value: [1, 1] }, uImageSize: { value: [1, 1] },
        uMouse: { value: [0.5, 0.5] }, uActivity: { value: 0 }, uDotSize: { value: options.dotSize },
        uDensity: { value: options.dotDensity }, uAngle: { value: options.angle }, uShape: { value: shapes[options.shape] },
        uInk: { value: rgb(options.inkColor) }, uPaper: { value: rgb(options.paperColor) },
        uMode: { value: modes[options.mode] }, uContrast: { value: options.contrast }, uInvert: { value: options.invert ? 1 : 0 },
        uRevealRadius: { value: options.revealRadius }, uEdge: { value: options.edge },
        uIdleReveal: { value: options.idleReveal }, uTrigger: { value: triggers[options.trigger] },
      };
      program = new Program(gl, { vertex, fragment, uniforms, depthTest: false, depthWrite: false });
      if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) { fallback(); return; }
      geometry = new Triangle(gl);
      const mesh = new Mesh(gl, { geometry, program });

      function schedule() {
        if (!frame && !disposed && !failed && loaded && visible && !document.hidden && !settings.current.revealAll) {
          frame = requestAnimationFrame(draw);
        }
      }
      function draw(now: number) {
        frame = 0;
        if (disposed || failed || !loaded || !visible || document.hidden || settings.current.revealAll) return;
        const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000)); lastFrame = now;
        const reduced = preference.matches;
        const a = 1 - Math.exp(-dt / Math.max(0.001, settings.current.follow));
        mouse.sx += (mouse.x - mouse.sx) * a;
        mouse.sy += (mouse.y - mouse.sy) * a;
        mouse.active = reduced ? 0 : mouse.active + (mouse.target - mouse.active) * (1 - Math.exp(-dt / 0.16));
        uniforms.uMouse.value = [mouse.sx, mouse.sy];
        uniforms.uActivity.value = mouse.active;
        uniforms.uTrigger.value = reduced ? 0 : triggers[settings.current.trigger];
        try { activeRenderer.render({ scene: mesh }); }
        catch { fallback(); return; }
        if (!reduced && (Math.abs(mouse.x - mouse.sx) + Math.abs(mouse.y - mouse.sy) > 0.001
          || Math.abs(mouse.active - mouse.target) > 0.001)) schedule();
      }
      const syncOptions = () => {
        const next = settings.current;
        uniforms.uDotSize.value = Math.max(0.1, next.dotSize);
        uniforms.uDensity.value = Math.max(4, next.dotDensity);
        uniforms.uAngle.value = next.angle; uniforms.uShape.value = shapes[next.shape];
        uniforms.uInk.value = rgb(next.inkColor); uniforms.uPaper.value = rgb(next.paperColor);
        uniforms.uMode.value = modes[next.mode]; uniforms.uContrast.value = next.contrast;
        uniforms.uInvert.value = next.invert ? 1 : 0; uniforms.uRevealRadius.value = next.revealRadius;
        uniforms.uEdge.value = next.edge; uniforms.uIdleReveal.value = next.idleReveal;
        if (next.revealAll) stop(); else schedule();
      };
      refresh.current = syncOptions;
      const resize = () => {
        const width = container.clientWidth; const height = container.clientHeight;
        if (!width || !height) { stop(); return; }
        activeRenderer.setSize(width, height);
        uniforms.iResolution.value = [gl.canvas.width, gl.canvas.height]; schedule();
      };
      const move = (event: PointerEvent) => {
        if (preference.matches || settings.current.revealAll) return;
        const rect = container.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        mouse.x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        mouse.y = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
        mouse.target = 1;
        if (event.type === "pointerdown" && event.pointerType !== "mouse") {
          mouse.sx = mouse.x; mouse.sy = mouse.y; mouse.active = 1;
        }
        schedule();
      };
      const leave = () => { mouse.target = 0; schedule(); };
      const release = (event: PointerEvent) => { if (event.pointerType !== "mouse") leave(); };
      const visibility = () => { if (document.hidden) { mouse.target = 0; stop(); } else schedule(); };
      const motionChange = () => { mouse.target = 0; mouse.active = 0; schedule(); };
      const contextLost = (event: Event) => { event.preventDefault(); fallback(); };
      for (const name of ["pointerenter", "pointermove", "pointerdown"] as const) {
        container.addEventListener(name, move, { passive: true });
        removers.push(() => container.removeEventListener(name, move));
      }
      container.addEventListener("pointerleave", leave);
      container.addEventListener("pointercancel", leave);
      container.addEventListener("pointerup", release);
      gl.canvas.addEventListener("webglcontextlost", contextLost);
      document.addEventListener("visibilitychange", visibility);
      preference.addEventListener("change", motionChange);
      removers.push(() => container.removeEventListener("pointerleave", leave), () => container.removeEventListener("pointercancel", leave),
        () => container.removeEventListener("pointerup", release), () => gl.canvas.removeEventListener("webglcontextlost", contextLost),
        () => document.removeEventListener("visibilitychange", visibility), () => preference.removeEventListener("change", motionChange));
      container.appendChild(gl.canvas);
      resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container);
      observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) { resize(); schedule(); } else stop(); });
      observer.observe(container);
      image = new Image(); image.crossOrigin = "anonymous";
      image.onload = () => {
        if (disposed || failed || !image) return;
        activeTexture.image = image;
        uniforms.uImageSize.value = [image.naturalWidth, image.naturalHeight];
        loaded = true; setState("ready"); resize(); schedule();
      };
      image.onerror = fallback;
      image.src = src;
      if (image.complete && image.naturalWidth) image.onload(new Event("load"));
    }).catch(fallback);

    return () => {
      disposed = true; stop(); refresh.current = null;
      if (image) { image.onload = null; image.onerror = null; }
      observer?.disconnect(); resizeObserver?.disconnect(); removers.forEach(remove => remove());
      if (renderer) {
        const gl = renderer.gl;
        geometry?.remove(); program?.remove();
        if (texture) gl.deleteTexture(texture.texture);
        gl.canvas.remove(); gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    };
  }, [src]);

  return <div ref={host} className={`halftone-reveal ${className}`} style={{ borderRadius, backgroundColor: paperColor, ...style }}
    role="img" aria-label={label} data-render-state={state} data-original={revealAll}>
    {!imageFailed && <img className="halftone-fallback" src={src} alt="" aria-hidden="true" onError={() => { setImageFailed(true); setState("fallback"); }} />}
    {(state === "fallback" || imageFailed) && <span className="halftone-fallback-note">{imageFailed ? "画面暂时无法加载" : "此设备显示静态画面"}</span>}
  </div>;
}
