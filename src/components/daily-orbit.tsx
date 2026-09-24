"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { starMaterial } from "@/lib/star-materials";
import { OrbitPlanet3D } from "./orbit-planet-3d";
import styles from "./daily-orbit.module.css";

export type DailyOrbitProps = {
  theme: number;
  keywords: readonly string[];
  onClaim: () => void;
  paused?: boolean;
  reduceMotion?: boolean;
};

const PULL_DISTANCE = 74;
const CLAIM_DELAY = 680;
const EMPTY_ORBIT = ["今天", "此刻", "留白"];

export function DailyOrbit({ theme, keywords, onClaim, paused = false, reduceMotion = false }: DailyOrbitProps) {
  const material = starMaterial(theme);
  const root = useRef<HTMLElement>(null);
  const gesture = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickUntil = useRef(0);
  const claimedRef = useRef(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pulling, setPulling] = useState(false);
  const [ready, setReady] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const orbitWords = keywords.length ? keywords.slice(0, 6) : EMPTY_ORBIT;
  const palette = {
    "--orbit-accent": material.accent,
    "--orbit-glow": material.glow,
    "--orbit-secondary": material.secondary,
    "--core-x": `${offset.x}px`,
    "--core-y": `${offset.y}px`,
  } as CSSProperties;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function claim() {
    if (claimedRef.current || paused) return;
    claimedRef.current = true;
    setClaimed(true);
    setPulling(false);
    setReady(false);
    if (reduceMotion) onClaim();
    else timer.current = setTimeout(onClaim, CLAIM_DELAY);
  }

  function release(event: PointerEvent<HTMLButtonElement>, canceled = false) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const deltaY = event.clientY - active.startY;
    const distance = Math.hypot(event.clientX - active.startX, deltaY);
    gesture.current = null;
    suppressClickUntil.current = performance.now() + 420;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!canceled && (deltaY >= PULL_DISTANCE || (!active.moved && distance < 8))) claim();
    else { setOffset({ x: 0, y: 0 }); setPulling(false); setReady(false); }
  }

  return <section ref={root} className={styles.orbit} style={palette} data-pulling={pulling} data-ready={ready} data-claimed={claimed} data-paused={paused || reduceMotion} aria-label="抵达今日星球">
    <div className={styles.sky} aria-hidden="true"><span /><span /><span /></div>
    <header className={styles.heading}>
      <span>Q7 · YOUR ORBIT TONIGHT</span>
      <h2>抵达今天的星球。</h2>
      <p>{keywords.length ? "沿途的念头，已经围成今晚的轨道。" : "今天还没有记录，这颗安静的星核也属于你。"}</p>
    </header>
    <div className={styles.space}>
      <div className={styles.aries} aria-label="白羊座私人坐标">
        <span>ARIES · 私人坐标</span>
        <svg viewBox="0 0 280 160" aria-hidden="true">
          <path d="M27 118L73 91L111 102L152 63L202 47L244 66" />
          {[[27,118],[73,91],[111,102],[152,63],[202,47],[244,66]].map(([cx,cy], index) => <g key={index}><circle cx={cx} cy={cy} r={index === 3 ? 3.8 : 2.2} /><circle className={styles.starAura} cx={cx} cy={cy} r={index === 3 ? 11 : 6} /></g>)}
        </svg>
      </div>
      <OrbitPlanet3D theme={theme} paused={paused} reduceMotion={reduceMotion} />
      <div className={styles.words} aria-label={keywords.length ? "今天的关键词" : "今天暂无关键词"}>{orbitWords.map((word, index) => <span key={`${word}-${index}`} style={{ "--word-index": index } as CSSProperties}>{word}</span>)}</div>
      <button type="button" className={styles.core} aria-label="把今日星核带到身边" disabled={paused || claimed} onPointerDown={event => {
        if (event.button !== 0 || gesture.current || paused || claimedRef.current) return;
        gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
        setPulling(true);
      }} onPointerMove={event => {
        const active = gesture.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const x = Math.max(-72, Math.min(72, event.clientX - active.startX));
        const y = Math.max(-12, Math.min(142, event.clientY - active.startY));
        if (Math.hypot(x, y) > 7) active.moved = true;
        setOffset({ x, y });
        setReady(y >= PULL_DISTANCE);
      }} onPointerUp={event => release(event)} onPointerCancel={event => release(event, true)} onLostPointerCapture={event => release(event, true)} onClick={() => { if (performance.now() >= suppressClickUntil.current) claim(); }}>
        <span className={styles.coreHalo} />
        <svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="daily-core-face" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fffafd" stopOpacity=".92" /><stop offset=".28" stopColor={material.accent} stopOpacity=".74" /><stop offset=".7" stopColor={`rgb(${material.secondary})`} stopOpacity=".66" /><stop offset="1" stopColor={`rgb(${material.glow})`} stopOpacity=".78" /></linearGradient></defs><path d="M60 8L92 22L111 56L91 96L55 113L17 91L8 51L29 18Z" fill="url(#daily-core-face)" /><path d="M60 8L54 57L8 51M54 57L91 96M54 57L111 56M54 57L17 91M54 57L29 18" /><path className={styles.coreSheen} d="M30 17L58 10L84 98L61 111Z" /></svg>
      </button>
    </div>
    <footer className={styles.guide}><span aria-hidden="true">↓</span><strong>{claimed ? "今日回响正在展开" : ready ? "松开手，把今天带回来" : pulling ? "再靠近一点" : "向下轻轻一带，收下今日星核"}</strong><small>{claimed ? "关键词与星轨正在收拢" : "也可以轻触星核"}</small></footer>
  </section>;
}

export default DailyOrbit;
