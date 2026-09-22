"use client";

// Adapted from the React Bits TargetCursor source supplied by the user.
// Keep the decoration separate from input, focus and application behavior.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./target-cursor.css";

interface TargetCursorProps {
  targetSelector?: string;
  spinDuration?: number;
  hideDefaultCursor?: boolean;
  hoverDuration?: number;
  parallaxOn?: boolean;
}

const controls = ".btn, .nav-item, .note-card, .backup-action, .text-button, .tag-filter, .filter-tab, .brand, .cursor-target";
const nativePointer = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [data-native-cursor], .halftone-reveal, :disabled, [aria-disabled='true'], [inert]";
const desktopMotion = "(hover: hover) and (pointer: fine) and (min-width: 761px) and (prefers-reduced-motion: no-preference)";

export function TargetCursor({ targetSelector = controls, spinDuration = 3, hideDefaultCursor = true, hoverDuration = 0.22, parallaxOn = true }: TargetCursorProps) {
  const [enabled, setEnabled] = useState(false);
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = window.matchMedia(desktopMotion);
    const update = () => setEnabled(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!enabled || !cursorRef.current) return;
    let disposed = false;
    let disposeAnimation: (() => void) | undefined;
    const cursor = cursorRef.current;

    // Phone and reduced-motion visitors never need to load the animation engine.
    void import("gsap").then(({ gsap }) => {
      if (disposed) return;
      const brackets = cursor.querySelector<HTMLDivElement>(".target-cursor-brackets")!;
      const corners = Array.from(cursor.querySelectorAll<HTMLSpanElement>(".target-cursor-corner"));
      const dot = cursor.querySelector<HTMLSpanElement>(".target-cursor-dot")!;
      const rest = [[-16, -16], [6, -16], [6, 6], [-16, 6]];
      let target: Element | null = null;
      let visible = false;
      let pointerX = 0;
      let pointerY = 0;
      const moveX = gsap.quickTo(cursor, "x", { duration: 0.09, ease: "power3.out" });
      const moveY = gsap.quickTo(cursor, "y", { duration: 0.09, ease: "power3.out" });
      const cornerMoves = corners.map(corner => ({
        x: gsap.quickTo(corner, "x", { duration: Math.max(0.05, hoverDuration), ease: "power3.out" }),
        y: gsap.quickTo(corner, "y", { duration: Math.max(0.05, hoverDuration), ease: "power3.out" }),
      }));
      const spin = gsap.to(brackets, { rotation: 360, duration: Math.max(0.5, spinDuration), ease: "none", repeat: -1, paused: true });
      corners.forEach((corner, index) => gsap.set(corner, { x: rest[index][0], y: rest[index][1] }));

      function offset() {
        // The portal is a direct body child; compensate if a theme transforms it.
        for (let node = cursor.parentElement; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.transform !== "none" || style.perspective !== "none" || style.filter !== "none" || /transform|perspective|filter/.test(style.willChange) || /paint|layout|strict|content/.test(style.contain)) {
            const rect = node.getBoundingClientRect();
            return { x: rect.left + node.clientLeft, y: rect.top + node.clientTop };
          }
        }
        return { x: 0, y: 0 };
      }

      function lockCorners() {
        if (!target?.isConnected || target.matches(":disabled, [aria-disabled='true']")) { release(); return; }
        const rect = target.getBoundingClientRect();
        const origin = offset();
        const x = Number(gsap.getProperty(cursor, "x")) + origin.x;
        const y = Number(gsap.getProperty(cursor, "y")) + origin.y;
        const positions = [[rect.left - 5, rect.top - 5], [rect.right - 5, rect.top - 5], [rect.right - 5, rect.bottom - 5], [rect.left - 5, rect.bottom - 5]];
        positions.forEach(([cx, cy], index) => {
          if (parallaxOn) { cornerMoves[index].x(cx - x); cornerMoves[index].y(cy - y); }
          else gsap.set(corners[index], { x: cx - x, y: cy - y });
        });
      }

      function release() {
        target = null; cursor.dataset.locked = "false";
        gsap.ticker.remove(lockCorners);
        cornerMoves.forEach((move, index) => { move.x(rest[index][0]); move.y(rest[index][1]); });
        gsap.killTweensOf(brackets, "rotation");
        if (visible) spin.invalidate().restart();
      }

      function hide() {
        visible = false; cursor.dataset.visible = "false";
        delete document.body.dataset.echoTargetCursor;
        release(); spin.pause();
        gsap.set(dot, { scale: 1 });
      }

      function pickTarget(element: Element | null) {
        if (!element || element.closest(nativePointer)) { hide(); return; }
        const next = element.closest(targetSelector);
        if (next === target) return;
        if (!next) { release(); return; }
        target = next; cursor.dataset.locked = "true";
        spin.pause();
        gsap.to(brackets, { rotation: 0, duration: 0.16, ease: "power2.out", overwrite: "auto" });
        gsap.ticker.add(lockCorners);
        lockCorners();
      }

      function move(event: PointerEvent) {
        if (event.pointerType !== "mouse") { hide(); return; }
        const element = event.target instanceof Element ? event.target : null;
        if (!element || element.closest(nativePointer) || document.hidden) { hide(); return; }
        pointerX = event.clientX; pointerY = event.clientY;
        const origin = offset();
        if (!visible) {
          gsap.set(cursor, { x: pointerX - origin.x, y: pointerY - origin.y });
          visible = true; cursor.dataset.visible = "true";
          if (hideDefaultCursor) document.body.dataset.echoTargetCursor = "active";
          spin.restart();
        }
        moveX(pointerX - origin.x); moveY(pointerY - origin.y);
        pickTarget(element);
      }

      function onScroll() {
        if (!visible) return;
        pickTarget(document.elementFromPoint(pointerX, pointerY));
      }
      function leave(event: PointerEvent) { if (!event.relatedTarget) hide(); }
      function keydown(event: KeyboardEvent) { if (event.key === "Tab" || event.key === "Escape") hide(); }
      function press(event: PointerEvent) { if (visible && event.pointerType === "mouse") gsap.to(dot, { scale: 0.6, duration: 0.12, overwrite: true }); }
      function unpress() { gsap.to(dot, { scale: 1, duration: 0.18, overwrite: true }); }

      window.addEventListener("pointermove", move, { passive: true });
      window.addEventListener("pointerout", leave, { passive: true });
      window.addEventListener("pointerdown", press, { passive: true });
      window.addEventListener("pointerup", unpress, { passive: true });
      window.addEventListener("scroll", onScroll, { passive: true, capture: true });
      window.addEventListener("resize", onScroll);
      window.addEventListener("blur", hide);
      window.addEventListener("keydown", keydown);
      document.addEventListener("visibilitychange", hide);
      disposeAnimation = () => {
        hide(); spin.kill();
        gsap.killTweensOf([cursor, brackets, dot, ...corners]);
        moveX.tween.kill(); moveY.tween.kill();
        cornerMoves.forEach(move => { move.x.tween.kill(); move.y.tween.kill(); });
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerout", leave);
        window.removeEventListener("pointerdown", press);
        window.removeEventListener("pointerup", unpress);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onScroll);
        window.removeEventListener("blur", hide);
        window.removeEventListener("keydown", keydown);
        document.removeEventListener("visibilitychange", hide);
      };
    }).catch(() => {
      // Failed optional decoration leaves all native interactions intact.
      delete document.body.dataset.echoTargetCursor;
    });

    return () => { disposed = true; disposeAnimation?.(); };
  }, [enabled, targetSelector, spinDuration, hideDefaultCursor, hoverDuration, parallaxOn]);

  if (!enabled) return null;
  return createPortal(<div ref={cursorRef} className="target-cursor-wrapper" data-visible="false" data-locked="false" aria-hidden="true">
    <span className="target-cursor-dot" />
    <div className="target-cursor-brackets">
      <span className="target-cursor-corner target-cursor-tl" />
      <span className="target-cursor-corner target-cursor-tr" />
      <span className="target-cursor-corner target-cursor-br" />
      <span className="target-cursor-corner target-cursor-bl" />
    </div>
  </div>, document.body);
}
