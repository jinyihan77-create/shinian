"use client";

import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { ShinianOrb } from "./shinian-orb";
import styles from "./orb-preview.module.css";

export function OrbPreview() {
  const [paused, setPaused] = useState(false);
  return <main className={styles.page}>
    <ShinianOrb paused={paused} className={styles.scene} />
    <div className={styles.veil} aria-hidden="true" />
    <header className={styles.header}>
      <a className={styles.brand} href="/"><strong>拾念</strong><span>SHINIAN</span></a>
      <button type="button" className={styles.pause} onClick={() => setPaused(value => !value)} aria-label={paused ? "播放光球动效" : "暂停光球动效"} aria-pressed={paused}>
        {paused ? <Play size={15} /> : <Pause size={15} />}<span>{paused ? "继续流动" : "暂停流动"}</span>
      </button>
    </header>
    <section className={styles.hero} aria-labelledby="orb-title">
      <div className={styles.copy}>
        <p className={styles.eyebrow}>一念，正在成形</p>
        <h1 id="orb-title">让思绪，拥有<span>自己的光。</span></h1>
        <p className={styles.intro}>雾玫瑰在烟紫里缓慢流动，珠光白勾勒边缘，月蓝只留下一点冷静的回声。</p>
      </div>
      <div className={styles.palette} aria-label="当前配色">
        <span><i style={{ background: "#e880aa", color: "#e880aa" }} />雾玫瑰</span>
        <span><i style={{ background: "#7b579f", color: "#7b579f" }} />烟紫</span>
        <span><i style={{ background: "#f7e8f2", color: "#f7e8f2" }} />珠光白</span>
        <span><i style={{ background: "#82b7ca", color: "#82b7ca" }} />月蓝</span>
      </div>
    </section>
  </main>;
}
