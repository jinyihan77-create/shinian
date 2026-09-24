"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { EchoNote } from "@/lib/types";
import { paintingForNote } from "@/lib/art-flashcards";
import styles from "./desktop-scroll-memory.module.css";

const clamp = (value: number, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
const smoothstep = (start: number, end: number, value: number) => {
  const progress = clamp((value - start) / (end - start || 0.000001));
  return progress * progress * (3 - 2 * progress);
};

export function DesktopScrollMemory({ note, onOpen }: { note: EchoNote; onOpen: () => void }) {
  const root = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const veil = useRef<HTMLSpanElement>(null);
  const opening = useRef<HTMLDivElement>(null);
  const memory = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLSpanElement>(null);
  const [actionVisible, setActionVisible] = useState(false);
  const painting = paintingForNote(note.id);
  const excerpt = note.reflectionText.trim() || note.userText.trim() || note.sourceExcerpt.trim() || "这条念头还在等你补上一句自己的理解。";

  const applyProgress = useCallback((progress: number) => {
    const eased = smoothstep(0, 1, progress);
    if (frame.current) {
      const width = 44 + 56 * eased;
      const height = 56 + 44 * eased;
      frame.current.style.clipPath = `inset(${(100 - height) / 2}% ${(100 - width) / 2}% ${(100 - height) / 2}% ${(100 - width) / 2}% round ${24 * (1 - eased)}px)`;
    }
    if (image.current) image.current.style.transform = `scale(${1.24 - .24 * eased})`;
    if (veil.current) veil.current.style.opacity = String(.58 + .32 * eased);
    if (opening.current) {
      const fade = smoothstep(.28, .68, progress);
      opening.current.style.opacity = String(1 - fade);
      opening.current.style.transform = `translate3d(0, ${-26 * fade}px, 0) scale(${1 + .04 * fade})`;
    }
    if (hint.current) {
      const fade = smoothstep(0, .16, progress);
      hint.current.style.opacity = String(1 - fade);
      hint.current.style.transform = `translate3d(0, ${8 * fade}px, 0)`;
    }
    if (memory.current) {
      const reveal = smoothstep(.66, .96, progress);
      memory.current.style.opacity = String(reveal);
      memory.current.style.transform = `translate3d(0, ${20 * (1 - reveal)}px, 0)`;
    }
    setActionVisible(progress > .82);
  }, []);

  useEffect(() => {
    if (!root.current) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) { applyProgress(1); return; }
    const containerCandidate = root.current.closest<HTMLElement>(".main-wrap");
    const containerStyle = containerCandidate ? window.getComputedStyle(containerCandidate) : null;
    const containerCanScroll = Boolean(
      containerCandidate &&
      containerStyle &&
      ["auto", "scroll", "overlay"].includes(containerStyle.overflowY) &&
      containerCandidate.scrollHeight > containerCandidate.clientHeight + 1,
    );
    const scrollContainer = containerCanScroll ? containerCandidate : null;
    const scrollTarget = scrollContainer ?? window;
    const viewportHeight = () => scrollContainer?.clientHeight ?? window.innerHeight;
    let frameId = 0;
    let current = 0;
    let target = 0;
    const read = () => {
      const bounds = root.current!.getBoundingClientRect();
      const viewportTop = scrollContainer?.getBoundingClientRect().top ?? 0;
      const distance = Math.max(1, root.current!.offsetHeight - viewportHeight());
      return clamp((viewportTop - bounds.top) / distance);
    };
    const tick = () => {
      current += (target - current) * .12;
      if (Math.abs(target - current) < .0005) current = target;
      applyProgress(current);
      frameId = current === target ? 0 : requestAnimationFrame(tick);
    };
    const onScroll = () => {
      target = read();
      if (!frameId) frameId = requestAnimationFrame(tick);
    };
    const onResize = () => { target = current = read(); applyProgress(current); };
    onResize();
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      scrollTarget.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [applyProgress]);

  return <section ref={root} className={styles.root} aria-label="从过去浮现的一条念头">
    <div className={styles.stage}>
      <div ref={frame} className={styles.frame}>
        <img ref={image} className={styles.image} src={`/artworks/${painting.id}-2400.webp`} alt={`${painting.title}，${painting.artist}`} draggable={false} />
        <span ref={veil} className={styles.veil} aria-hidden="true" />
        <div ref={opening} className={styles.opening} aria-hidden="true"><span>PAST ECHO · 07</span><strong>有些念头，会在后来重新发光。</strong></div>
        <div ref={memory} className={styles.memory}><span className={styles.memoryLabel}>过去的七七，留给现在</span><h2>{note.title}</h2><p>{excerpt}</p></div>
        <button className={styles.open} data-visible={actionVisible} tabIndex={actionVisible ? 0 : -1} onClick={onOpen}>打开这条记录<ArrowUpRight size={16} /></button>
      </div>
      <span ref={hint} className={styles.hint} aria-hidden="true">SCROLL · LET IT RETURN</span>
    </div>
  </section>;
}
