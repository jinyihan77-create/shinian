"use client";

import { useId } from "react";
import { SEVEN_STAR_POINTS, starMaterial, starPath } from "@/lib/star-materials";
import styles from "./seven-star-card.module.css";

export type SevenStarCardProps = {
  theme: number;
  mood: string;
  quote: string;
  date: string;
  totalDays: number;
  currentStreak: number;
  sourceCount: number;
  flipped?: boolean;
  preview?: boolean;
  syncing?: boolean;
};

const STAR_PATH = starPath(SEVEN_STAR_POINTS, 50, 47);

function shortDate(value: string) {
  return value ? value.replaceAll("-", ".") : "----.--.--";
}

function safeCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function SevenStarCard({ theme, mood, quote, date, totalDays, currentStreak, sourceCount, flipped = false, preview = false, syncing = false }: SevenStarCardProps) {
  const id = useId().replace(/:/g, "");
  const material = starMaterial(theme);
  const glow = `rgb(${material.glow})`;
  const secondary = `rgb(${material.secondary})`;
  const count = safeCount(totalDays);
  const streak = safeCount(currentStreak);
  const cleanQuote = quote.trim();
  return <article className={`${styles.card} ${flipped ? styles.flipped : ""}`} data-material={material.kind} aria-label={flipped ? "今日七芒星笺背面" : "今日七芒星笺正面"}>
    <div className={styles.glow} style={{ background: `radial-gradient(circle, ${glow}55, transparent 64%)` }} aria-hidden="true" />
    <svg className={styles.star} viewBox="0 0 100 100" role="presentation" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={material.accent} stopOpacity=".94" />
          <stop offset=".36" stopColor={material.base} stopOpacity={material.opacity} />
          <stop offset=".7" stopColor={secondary} stopOpacity=".84" />
          <stop offset="1" stopColor={glow} stopOpacity=".82" />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fffaff" stopOpacity=".96" />
          <stop offset=".48" stopColor={material.accent} stopOpacity=".5" />
          <stop offset="1" stopColor="#fffaff" stopOpacity=".88" />
        </linearGradient>
        <radialGradient id={`${id}-center`} cx="32%" cy="25%" r="78%">
          <stop stopColor="#ffffff" stopOpacity=".33" />
          <stop offset=".45" stopColor={material.accent} stopOpacity=".08" />
          <stop offset="1" stopColor="#171222" stopOpacity=".2" />
        </radialGradient>
        <clipPath id={`${id}-clip`}><path d={STAR_PATH} /></clipPath>
      </defs>
      <path d={STAR_PATH} fill="#08060f66" transform="translate(1 2)" />
      <path d={STAR_PATH} fill={`url(#${id}-body)`} stroke={`url(#${id}-edge)`} strokeWidth=".72" strokeLinejoin="round" />
      <path d={STAR_PATH} fill="none" stroke={glow} strokeOpacity=".7" strokeWidth=".34" transform="translate(0 .5) scale(.985) translate(.75 .75)" />
      <g clipPath={`url(#${id}-clip)`}>
        <rect width="100" height="100" fill={`url(#${id}-center)`} />
        <path d="M-10 71C23 84 38 18 112 37" fill="none" stroke="#ffffff" strokeOpacity=".17" strokeWidth="7" />
        <path d="M-10 78C26 90 47 34 112 53" fill="none" stroke={material.accent} strokeOpacity=".2" strokeWidth="2" />
        <g fill="#fffaff">
          {[{ x: 22, y: 32, r: .7 }, { x: 68, y: 24, r: .45 }, { x: 74, y: 61, r: .6 }, { x: 38, y: 70, r: .38 }, { x: 52, y: 48, r: .3 }, { x: 82, y: 44, r: .28 }].map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={point.r} opacity={index % 2 ? .55 : .85} />)}
        </g>
        <path d="M31 55L45 42L58 49L70 38" fill="none" stroke="#fffaff" strokeOpacity=".28" strokeWidth=".35" />
      </g>
    </svg>
    <div className={styles.content}>
      {!flipped ? <>
        <header className={styles.cardHeader}><span className={styles.signature}>Q7</span><span className={styles.date}>{shortDate(date)}</span></header>
        <div className={styles.frontCopy}>
          <span className={styles.label}>{mood.trim() || "无字星"}</span>
          {cleanQuote ? <p>{cleanQuote}</p> : <p className={styles.emptyCopy}>今天先留一颗安静的星。</p>}
        </div>
        <footer className={styles.cardFooter}><span>来自今天 {sourceCount} 条记录</span><span>{preview ? "演示牌" : syncing ? "等待同步" : "一念入星河"}</span></footer>
      </> : <>
        <header className={styles.cardHeader}><span className={styles.signature}>Q7 · ORBIT</span><span className={styles.date}>七日星轨</span></header>
        <div className={styles.backCopy}>
          <strong>{String(count).padStart(2, "0")}</strong><span>累计留下的星星</span>
          <div className={styles.orbit} aria-label={`最近七天连续 ${streak} 天`}>
            {Array.from({ length: 7 }, (_, index) => <i key={index} data-active={index >= 7 - Math.min(streak, 7)} />)}
          </div>
          <small>连续相遇 {streak} 天 · {shortDate(date)}</small>
        </div>
        <footer className={styles.cardFooter}><span>每一次回看，都是重新相遇</span><span>{preview ? "演示牌" : "私人星笺"}</span></footer>
      </>}
    </div>
    <span className={styles.sheen} aria-hidden="true" />
  </article>;
}

export default SevenStarCard;
