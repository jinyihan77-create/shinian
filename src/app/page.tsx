import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import PixelCard from "@/components/pixel-card";
import styles from "./entry.module.css";

export const metadata: Metadata = {
  title: "拾念 · 给念头一点柔和的光",
  description: "拾起一闪而过的念头，留给以后再遇见。",
};

export default function Home() {
  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="拾念首页"><span className={styles.mark}><Sparkles size={18} strokeWidth={1.4} /></span><span>拾念</span><small>SHINIAN</small></Link>
      <span className={styles.headerNote}>私人灵感空间</span>
    </header>
    <section className={styles.stage} aria-labelledby="entry-title">
      <p className={styles.eyebrow}>一闪，便有回响</p>
      <h1 id="entry-title">给念头一点<span>柔和的光。</span></h1>
      <p className={styles.intro}>把听过的、想过的，留成以后还能找回来的自己。</p>
      <Link href="/workspace" className={styles.cardLink} aria-label="进入拾念灵感空间">
        <PixelCard variant="pink" noFocus gap={6} speed={25} className={styles.card} aria-label="进入拾念">
          <div className={styles.cardBody}>
            <div className={styles.cardTop}><span className={styles.cardKicker}>SHINIAN / 01</span><Sparkles size={22} strokeWidth={1.2} aria-hidden="true" /></div>
            <div className={styles.thought}>
              <p>那些一闪而过的，</p>
              <h2>也值得被好好记住。</h2>
              <p className={styles.description}>一句话，一段声音，<br />或是此刻，只属于你的理解。</p>
            </div>
            <div className={styles.cardBottom}><span>轻触卡片，进入你的灵感空间</span><ArrowUpRight size={21} strokeWidth={1.2} aria-hidden="true" /></div>
          </div>
        </PixelCard>
      </Link>
      <p className={styles.hint}>猜猜，轻触会落下什么光？</p>
    </section>
    <footer className={styles.footer}><span>记录 · 理解 · 再遇见</span><Link href="/design-preview#capture">先看看界面预览<ArrowUpRight size={12} /></Link></footer>
  </main>;
}
