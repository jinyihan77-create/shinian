"use client";

import type { CSSProperties } from "react";
import { starMaterial } from "@/lib/star-materials";
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

function shortDate(value: string) {
  return value ? value.replaceAll("-", ".") : "----.--.--";
}

function safeCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function SevenStarCard({ theme, mood, quote, date, totalDays, currentStreak, sourceCount, flipped = false, preview = false, syncing = false }: SevenStarCardProps) {
  const material = starMaterial(theme);
  const glow = `rgb(${material.glow})`;
  const secondary = `rgb(${material.secondary})`;
  const count = safeCount(totalDays);
  const streak = safeCount(currentStreak);
  const cleanQuote = quote.trim();
  const orbitStyle = { "--orbit-accent": material.accent, "--orbit-glow": material.glow, "--orbit-secondary": secondary } as CSSProperties;
  return <article className={`${styles.card} ${flipped ? styles.flipped : ""}`} data-material={material.kind} aria-label={flipped ? "今日星笺背面" : "今日星笺正面"}>
    <div className={styles.glow} style={{ background: `radial-gradient(circle, ${glow}55, transparent 64%)` }} aria-hidden="true" />
    <div className={styles.orbitField} style={orbitStyle} aria-hidden="true">
      <span className={`${styles.orbitRing} ${styles.ringOne}`} />
      <span className={`${styles.orbitRing} ${styles.ringTwo}`} />
      <span className={`${styles.orbitRing} ${styles.ringThree}`} />
      <span className={`${styles.orbitDot} ${styles.dotOne}`} />
      <span className={`${styles.orbitDot} ${styles.dotTwo}`} />
      <span className={`${styles.orbitDot} ${styles.dotThree}`} />
      <span className={styles.orbitGlint} />
    </div>
    <div className={styles.readingPanel} aria-hidden="true" />
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
