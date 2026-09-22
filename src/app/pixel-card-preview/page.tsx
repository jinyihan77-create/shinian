import type { Metadata } from "next";
import { Sparkles, ArrowUpRight } from "lucide-react";
import PixelCard from "@/components/pixel-card";
import styles from "./preview.module.css";

export const metadata: Metadata = { title: "拾念 · 雾玫瑰像素卡片预览" };

export default function PixelCardPreview() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a href="/" className={styles.brand}>拾念<span>SHINIAN</span></a>
        <span className={styles.previewLabel}>卡片配色预览 · 示例内容</span>
      </header>
      <section className={styles.stage} aria-labelledby="preview-heading">
        <p className={styles.eyebrow}>一闪，便有回响</p>
        <h1 id="preview-heading">给念头一点<span>柔和的光。</span></h1>
        <p className={styles.intro}>雾玫瑰粉、灰紫与珠光粉白，让细碎的微光慢慢浮现。</p>
        <PixelCard variant="pink" aria-label="雾玫瑰像素卡片，悬停或聚焦查看效果" className={styles.previewCard}>
          <div className={styles.cardBody}>
            <div className={styles.cardTop}><Sparkles size={24} strokeWidth={1.3} /><span>灵感片段 · 示例</span></div>
            <div className={styles.thought}>
              <p>那些一闪而过的，</p>
              <h2>也值得被好好记住。</h2>
              <p className={styles.description}>也许是一句话，一段声音，<br />或是此刻，只属于你的理解。</p>
            </div>
            <div className={styles.cardBottom}><span>留给下一次想起的自己</span><ArrowUpRight size={22} strokeWidth={1.2} aria-hidden="true" /></div>
          </div>
        </PixelCard>
        <p className={styles.hint}>猜猜，轻触会落下什么光？</p>
        <div className={styles.palette} aria-label="卡片配色">
          <span><i style={{ background: "#c996b0" }} />雾玫瑰粉</span>
          <span><i style={{ background: "#b99cb9" }} />烟紫粉</span>
          <span><i style={{ background: "#e3c8d5" }} />珠光粉白</span>
        </div>
      </section>
    </main>
  );
}
