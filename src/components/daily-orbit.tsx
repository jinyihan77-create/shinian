"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ArrowDownToLine, Rotate3D } from "lucide-react";
import { starMaterial } from "@/lib/star-materials";
import { OrbitPlanet3D, type PlanetThought } from "./orbit-planet-3d";
import styles from "./daily-orbit.module.css";

const EMPTY_THOUGHTS: readonly PlanetThought[] = [];

export type DailyOrbitProps = {
  theme: number;
  keywords: readonly string[];
  thoughts?: readonly PlanetThought[];
  onClaim: () => void;
  paused?: boolean;
  reduceMotion?: boolean;
};

const PULL_DISTANCE = 74;
const CLAIM_DELAY = 680;

export function DailyOrbit({ theme, keywords, thoughts = EMPTY_THOUGHTS, onClaim, paused = false, reduceMotion = false }: DailyOrbitProps) {
  const material = starMaterial(theme);
  const gesture = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickUntil = useRef(0);
  const claimedRef = useRef(false);
  const [pulling, setPulling] = useState(false);
  const [ready, setReady] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [selectedThought, setSelectedThought] = useState<number | null>(null);
  const focusedThought = selectedThought === null ? null : thoughts[selectedThought] ?? null;
  const palette = {
    "--orbit-accent": material.accent,
    "--orbit-glow": material.glow,
    "--orbit-secondary": material.secondary,
  } as CSSProperties;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (selectedThought !== null && selectedThought >= thoughts.length) setSelectedThought(null);
  }, [selectedThought, thoughts.length]);

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
    else { setPulling(false); setReady(false); }
  }

  return <section className={styles.orbit} style={palette} data-pulling={pulling} data-ready={ready} data-claimed={claimed} data-paused={paused || reduceMotion} aria-label="抵达今日星球">
    <div className={styles.sky} aria-hidden="true"><span /><span /><span /></div>
    <header className={styles.heading}>
      <span>Q7 · YOUR LITTLE ORBIT</span>
      <h2>今天的念头，住在这颗星球上。</h2>
      <p>{thoughts.length ? `转一转，看看今天留下的 ${thoughts.length} 处微光。` : "今天还没有新的记录，先让它安静地转一会儿。"}</p>
    </header>
    <div className={styles.space}>
      <div className={styles.aries} aria-label="白羊座私人坐标">
        <span>ARIES · 私人坐标</span>
        <svg viewBox="0 0 280 160" aria-hidden="true">
          <path d="M27 118L73 91L111 102L152 63L202 47L244 66" />
          {[[27,118],[73,91],[111,102],[152,63],[202,47],[244,66]].map(([cx,cy], index) => <g key={index}><circle cx={cx} cy={cy} r={index === 3 ? 3.8 : 2.2} /><circle className={styles.starAura} cx={cx} cy={cy} r={index === 3 ? 11 : 6} /></g>)}
        </svg>
      </div>
      <OrbitPlanet3D theme={theme} thoughts={thoughts} selectedThought={selectedThought} onSelectThought={setSelectedThought} paused={paused} reduceMotion={reduceMotion} />
      <div className={styles.keywordList} aria-label={keywords.length ? "今天的关键词" : "今天暂无关键词"}>{keywords.map(word => <span key={word}>{word}</span>)}</div>
      {focusedThought ? <article className={styles.thoughtFocus} aria-live="polite">
        <span>{focusedThought.source || "今日念头"}</span>
        <strong>{focusedThought.title}</strong>
        <p>{focusedThought.excerpt}</p>
        <button type="button" onClick={() => setSelectedThought(null)}>回到星球</button>
      </article> : <div className={styles.planetHint}><Rotate3D size={15} /><span>{thoughts.length ? "拖动星球 · 轻触发光地标" : "拖动星球，等下一处念头落下来"}</span></div>}
    </div>
    <footer className={styles.guide}>
      <button type="button" className={styles.claim} aria-label="把今日星核带到身边" disabled={paused || claimed}
        onPointerDown={event => {
          if (event.button !== 0 || gesture.current || paused || claimedRef.current) return;
          gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
          setPulling(true);
        }}
        onPointerMove={event => {
          const active = gesture.current;
          if (!active || active.pointerId !== event.pointerId) return;
          const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY);
          if (distance > 7) active.moved = true;
          setReady(event.clientY - active.startY >= PULL_DISTANCE);
        }}
        onPointerUp={event => release(event)} onPointerCancel={event => release(event, true)}
        onLostPointerCapture={event => release(event, true)}
        onClick={() => { if (performance.now() >= suppressClickUntil.current) claim(); }}>
        <ArrowDownToLine size={15} />{claimed ? "正在整理今晚的回响" : ready ? "松开手，把今天带回来" : pulling ? "再向下一点" : "收好今晚的回响"}
      </button>
      <small>{claimed ? "念头正在汇成今晚的小结" : "回顾完以后，再把今天收好"}</small>
    </footer>
  </section>;
}

export default DailyOrbit;
