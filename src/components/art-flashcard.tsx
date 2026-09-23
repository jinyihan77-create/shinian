"use client";

import { useId, useState, type CSSProperties } from "react";
import { ArrowUpRight, Bookmark, Check, LoaderCircle, RotateCw } from "lucide-react";
import { paintingForNote, reflectionThoughts } from "@/lib/art-flashcards";
import FlipCard from "./flip-card";
import HalftoneReveal from "./halftone-reveal";
import styles from "./art-flashcard.module.css";

interface Props {
  noteId: string;
  title: string;
  text: string;
  favorite?: boolean;
  onFavorite?: () => void;
  pending?: boolean;
  blockedReason?: string;
  preview?: boolean;
  onOpen?: () => void;
}

export function ArtFlashcard({ noteId, title, text, favorite = false, onFavorite, pending = false, blockedReason, preview = false, onOpen }: Props) {
  const [flipped, setFlipped] = useState(false);
  const [imageError, setImageError] = useState(false);
  const descriptionId = useId();
  const painting = paintingForNote(noteId);
  const thoughts = reflectionThoughts(text);
  const complete = thoughts.length >= 3;
  const missing = Math.max(0, 3 - thoughts.length);
  const prompts = ["我理解了什么", "它为什么触动我", "我想怎样试一试"];
  const cardThoughts = Array.from({ length: Math.max(3, thoughts.length) }, (_, index) => thoughts[index] || "");
  const reason = blockedReason || (!favorite && !complete ? `再写 ${missing} 句，半色调画面就会显影成完整闪卡。` : "");
  const paletteStyle = {
    "--flashcard-paper": painting.palette.paper,
    "--flashcard-ink": painting.palette.ink,
    "--flashcard-accent": painting.palette.accent,
    "--flashcard-glow": painting.palette.glow,
    "--flashcard-sheen": painting.palette.sheen,
    "--flashcard-shade": painting.palette.shade,
    "--flashcard-deep": painting.palette.deep,
    "--flashcard-border": painting.palette.border,
  } as CSSProperties;

  return <article className={styles.artifact} style={paletteStyle} aria-label={`${complete ? "油画闪卡" : "正在显影的闪卡"}：${title}`}>
    <div className={styles.overline}><span>拾念 · 油画闪卡</span><span>{complete ? preview ? "演示" : "私人珍藏" : `正在显影 ${thoughts.length}/3`}</span></div>
    <FlipCard
      width={340} height={440} radius={22} flipped={flipped} onFlipChange={setFlipped}
      axis="y" flipOnClick={complete} draggable={complete} tilt tiltMax={12} glare glareOpacity={0.22}
      hoverScale={1.03} perspective={1100} stiffness={170} damping={20}
      className={styles.card} background="#24252b"
      ariaLabel={flipped ? `翻回油画正面：${title}` : `翻看我的理解：${title}`}
      ariaDescribedBy={flipped ? descriptionId : undefined}
      front={<div className={`${styles.front} ${!complete ? styles.frontIncomplete : ""}`}>
        {/* Local public-domain museum scan, intentionally preserving its painterly texture. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {complete && !imageError && <img
          src={`/artworks/${painting.id}-4k.jpg`}
          srcSet={`/artworks/${painting.id}-1600.webp 1600w, /artworks/${painting.id}-2400.webp 2400w, /artworks/${painting.id}-4k.jpg 3840w`}
          sizes="560px"
          loading="lazy" decoding="async"
          alt={`${painting.artist}《${painting.title}》，${painting.year}，布面油画`}
          onError={() => setImageError(true)} draggable={false}
        />}
        {!complete && <HalftoneReveal
          src={`/artworks/${painting.id}-1600.webp`}
          mode="duotone"
          inkColor={painting.palette.ink}
          paperColor={painting.palette.paper}
          dotSize={0.68}
          dotDensity={92}
          angle={24}
          shape="circle"
          contrast={1.08}
          revealRadius={0.3}
          edge={0.68}
          follow={0.11}
          idleReveal={0}
          borderRadius="22px"
          className={styles.halftoneArt}
          label={`${painting.artist}《${painting.title}》的${painting.palette.name}半色调画面，移动指针或轻触可局部显露原画`}
        />}
        {complete && imageError && <span className={styles.imageError}>画作暂时未能加载<br />仍可翻面查看自己的理解</span>}
        <span className={styles.frontShade} />
        <span className={styles.edition}>{complete ? "A THOUGHT TO KEEP" : "THOUGHTS IN PROCESS"}<span>SHINIAN COLLECTION</span></span>
        {!complete && <span className={styles.developing}><b>{thoughts.length}</b><span>/ 3 句话</span></span>}
        <div className={styles.caption}><span className={styles.rule} /><h3>{complete ? painting.title : "这张卡，正在显影"}</h3><p>{complete ? `${painting.artist} · ${painting.year}` : "轻触或移动，让原画先透出一点"}</p><span className={styles.frontHint}><RotateCw size={13} />{complete ? "翻面，遇见自己的想法" : "翻面，看看还缺哪一句"}</span></div>
      </div>}
      back={<div className={styles.back}>
        <div className={styles.backHeading}><span>IN MY OWN WORDS</span><span>拾念</span></div>
        <h3>留给未来的自己</h3>
        <p className={styles.noteTitle}>{title}</p>
        <div className={styles.thoughts}>
          {cardThoughts.map((thought, index) => thought
            ? <div key={index} className={styles.thought}><span>{String(index + 1).padStart(2, "0")}</span><p>{thought}</p></div>
            : <div key={index} className={`${styles.thought} ${styles.placeholder}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{prompts[index]}<small>等你写下自己的话</small></p></div>)}
        </div>
        <div className={styles.backFooter}><span>{preview ? "演示内容 · 未保存到账号" : "我的理解 · 自己写下"}</span><span>↻</span></div>
      </div>}
    />
    <p className="sr-only" id={descriptionId}>{text.trim() || "还没有写下自己的理解。"}</p>
    <div className={styles.controls}>
      <button type="button" className={styles.flip} onClick={() => setFlipped(value => !value)}><RotateCw size={14} />{flipped ? complete ? "看油画" : "看显影" : complete ? "翻看三句话" : "还差哪一句"}</button>
      {onFavorite && <button type="button" className={styles.favorite} aria-pressed={favorite} disabled={pending || Boolean(reason)} onClick={onFavorite}>
        {pending ? <LoaderCircle className="spin" size={15} /> : favorite ? <Check size={15} /> : <Bookmark size={15} />}
        {pending ? "正在保存…" : favorite ? preview ? "演示已收藏" : "已收藏" : preview ? "试试收藏" : "收藏闪卡"}
      </button>}
      {onOpen && <button type="button" className={styles.favorite} onClick={onOpen}>打开原笔记<ArrowUpRight size={14} /></button>}
    </div>
    {onFavorite && <p className={styles.hint} role="status">{reason || (preview ? "仅本次预览有效，刷新后清空。" : favorite ? "已放入回声屿的「闪卡」，再次点击可取消。" : "保存成一张小卡片，留待以后重温。")}</p>}
    <a className={styles.fullResolution} href={`/artworks/${painting.id}-4k.jpg`} target="_blank" rel="noopener noreferrer" aria-label={`查看《${painting.title}》的 4K 高清画作`}>查看 4K 画作<ArrowUpRight size={12} /></a>
    <a className={styles.credit} href={painting.source} target="_blank" rel="noopener noreferrer">画作出处 · 大都会艺术博物馆<ArrowUpRight size={11} /></a>
  </article>;
}
