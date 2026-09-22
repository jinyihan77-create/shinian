"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { gsap } from "gsap";
import "./depth-carousel.css";

export type DepthCarouselItem = { image?: string; alt?: string };

type Props = {
  items: DepthCarouselItem[];
  renderCard?: (item: DepthCarouselItem, index: number, active: boolean) => ReactNode;
  cardWidth?: number;
  cardHeight?: number;
  radius?: number;
  depth?: number;
  spread?: number;
  tilt?: number;
  visibleCards?: number;
  autoplay?: boolean;
  autoplayDelay?: number;
  onChange?: (index: number) => void;
  className?: string;
};

type DragState = { startX: number; startPosition: number; lastX: number; lastTime: number; velocity: number; moved: boolean; pointerId: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function DepthCarousel({
  items,
  renderCard,
  cardWidth = 276,
  cardHeight = 352,
  radius = 24,
  depth = 210,
  spread = 82,
  tilt = 17,
  visibleCards = 3,
  autoplay = true,
  autoplayDelay = 4600,
  onChange,
  className = "",
}: Props) {
  const data = useMemo(() => items.filter(Boolean), [items]);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const positionRef = useRef(0);
  const activeRef = useRef(0);
  const scaleRef = useRef(1);
  const dragRef = useRef<DragState | null>(null);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const [active, setActive] = useState(0);

  const normalized = useCallback((index: number) => {
    if (!data.length) return 0;
    return ((index % data.length) + data.length) % data.length;
  }, [data.length]);

  const layout = useCallback((position: number) => {
    const count = data.length;
    if (!count) return;
    const scale = scaleRef.current;
    for (let index = 0; index < count; index += 1) {
      const card = cardRefs.current[index];
      if (!card) continue;
      let distance = index - position;
      if (count > 1) {
        distance = ((distance % count) + count) % count;
        if (distance > count / 2) distance -= count;
      }
      const behind = Math.max(0, distance);
      const visible = Math.abs(distance) <= visibleCards + 0.5;
      const opacity = visible ? (distance < 0 ? Math.max(0, 1 + distance) : 1) : 0;
      const translateX = spread * distance;
      const translateZ = -depth * distance;
      const rotateY = tilt * clamp(distance, -1, 1);
      const blur = Math.min(5, behind * 1.45);
      const brightness = Math.max(.32, 1 - behind * .14);
      card.style.transform = `translate(-50%, -50%) scale(${scale}) translateX(${translateX.toFixed(2)}px) translateZ(${translateZ.toFixed(2)}px) rotateY(${rotateY.toFixed(2)}deg)`;
      card.style.opacity = opacity.toFixed(3);
      card.style.filter = `brightness(${brightness.toFixed(2)}) blur(${blur.toFixed(2)}px)`;
      card.style.zIndex = String(2000 - Math.round(distance * 20));
      card.style.pointerEvents = visible && opacity > .05 ? "auto" : "none";
    }
  }, [data.length, depth, spread, tilt, visibleCards]);

  const notify = useCallback((index: number) => {
    const next = normalized(index);
    if (next === activeRef.current) return;
    activeRef.current = next;
    setActive(next);
    onChange?.(next);
  }, [normalized, onChange]);

  const goTo = useCallback((index: number, animate = true) => {
    const count = data.length;
    if (!count) return;
    const target = normalized(index);
    let delta = target - positionRef.current;
    if (count > 1) {
      delta = ((delta % count) + count) % count;
      if (delta > count / 2) delta -= count;
    }
    tweenRef.current?.kill();
    const proxy = { position: positionRef.current };
    tweenRef.current = gsap.to(proxy, {
      position: positionRef.current + delta,
      duration: animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? .72 : 0,
      ease: "power3.out",
      onUpdate: () => { positionRef.current = proxy.position; layout(proxy.position); },
      onComplete: () => { positionRef.current = normalized(Math.round(proxy.position)); layout(positionRef.current); },
    });
    notify(target);
  }, [data.length, layout, normalized, notify]);

  const moveBy = useCallback((step: number) => goTo(activeRef.current + step), [goTo]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      scaleRef.current = clamp(width / (cardWidth + spread * 2 + 86), .48, 1);
      layout(positionRef.current);
    });
    observer.observe(root);
    layout(positionRef.current);
    return () => observer.disconnect();
  }, [cardWidth, layout, spread]);

  useEffect(() => {
    if (!autoplay || data.length < 2) return;
    const timer = window.setInterval(() => moveBy(1), Math.max(autoplayDelay, 1800));
    return () => window.clearInterval(timer);
  }, [autoplay, autoplayDelay, data.length, moveBy]);

  useEffect(() => () => { tweenRef.current?.kill(); }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (data.length < 2) return;
    tweenRef.current?.kill();
    dragRef.current = { startX: event.clientX, startPosition: positionRef.current, lastX: event.clientX, lastTime: performance.now(), velocity: 0, moved: false, pointerId: event.pointerId };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(delta) > 5) {
      drag.moved = true;
      rootRef.current?.setPointerCapture(drag.pointerId);
    }
    if (!drag.moved) return;
    const now = performance.now();
    drag.velocity = (event.clientX - drag.lastX) / Math.max(now - drag.lastTime, 1);
    drag.lastX = event.clientX;
    drag.lastTime = now;
    positionRef.current = drag.startPosition - delta / Math.max(cardWidth * .58 * scaleRef.current, 46);
    layout(positionRef.current);
  };
  const onPointerEnd = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.moved) goTo(Math.round(positionRef.current - (drag.velocity * 160) / Math.max(cardWidth * .58 * scaleRef.current, 46)));
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); moveBy(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); moveBy(1); }
  };

  if (!data.length) return null;
  return <div ref={rootRef} className={`depth-carousel ${className}`.trim()} role="region" aria-label="闪卡橱窗" tabIndex={0} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onKeyDown={onKeyDown}>
    <div className="depth-carousel__stage">
      {data.map((item, index) => <div key={`${item.image || "card"}-${index}`} ref={element => { cardRefs.current[index] = element; }} className={`depth-carousel__card${active === index ? " is-active" : ""}`} style={{ width: cardWidth, height: cardHeight, borderRadius: radius }} onClick={() => !dragRef.current?.moved && goTo(index)} aria-hidden={active !== index}>
        {renderCard ? renderCard(item, index, active === index) : item.image ? <img src={item.image} alt={item.alt || ""} draggable={false} /> : null}
      </div>)}
    </div>
    {data.length > 1 && <>
      <button className="depth-carousel__arrow depth-carousel__arrow--prev" type="button" aria-label="上一张闪卡" onClick={() => moveBy(-1)}>‹</button>
      <button className="depth-carousel__arrow depth-carousel__arrow--next" type="button" aria-label="下一张闪卡" onClick={() => moveBy(1)}>›</button>
      <div className="depth-carousel__dots" role="tablist" aria-label="闪卡位置">{data.map((_, index) => <button key={index} type="button" role="tab" aria-selected={active === index} aria-label={`查看第 ${index + 1} 张闪卡`} className={active === index ? "is-active" : ""} onClick={() => goTo(index)} />)}</div>
    </>}
  </div>;
}
