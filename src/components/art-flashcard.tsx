"use client";

import { useId, useState } from "react";
import { ArrowUpRight, Bookmark, Check, LoaderCircle, RotateCw } from "lucide-react";
import { paintingForNote, reflectionThoughts } from "@/lib/art-flashcards";
import FlipCard from "./flip-card";
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
  const reason = blockedReason || (!text.trim() && !favorite ? "先写下自己的理解，再把它收藏起来。" : "");

  return <article className={styles.artifact} aria-label={`油画闪卡：${title}`}>
    <div className={styles.overline}><span>拾念 · 油画闪卡</span><span>{preview ? "演示" : "私人珍藏"}</span></div>
    <FlipCard
      width={340} height={440} radius={22} flipped={flipped} onFlipChange={setFlipped}
      axis="y" flipOnClick draggable tilt tiltMax={12} glare glareOpacity={0.22}
      hoverScale={1.03} perspective={1100} stiffness={170} damping={20}
      className={styles.card} background="#24252b"
      ariaLabel={flipped ? `翻回油画正面：${title}` : `翻看我的理解：${title}`}
      ariaDescribedBy={flipped ? descriptionId : undefined}
      front={<div className={styles.front}>
        {/* Local public-domain museum scan, intentionally preserving its painterly texture. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {!imageError && <img
          src={`/artworks/${painting.id}-4k.jpg`}
          srcSet={`/artworks/${painting.id}-1600.webp 1600w, /artworks/${painting.id}-2400.webp 2400w, /artworks/${painting.id}-4k.jpg 3840w`}
          sizes="560px"
          loading="lazy" decoding="async"
          alt={`${painting.artist}《${painting.title}》，${painting.year}，布面油画`}
          onError={() => setImageError(true)} draggable={false}
        />}
        {imageError && <span className={styles.imageError}>画作暂时未能加载<br />仍可翻面查看自己的理解</span>}
        <span className={styles.frontShade} />
        <span className={styles.edition}>A THOUGHT TO KEEP<span>SHINIAN COLLECTION</span></span>
        <div className={styles.caption}><span className={styles.rule} /><h3>{painting.title}</h3><p>{painting.artist} · {painting.year}</p><span className={styles.frontHint}><RotateCw size={13} />翻面，遇见自己的想法</span></div>
      </div>}
      back={<div className={styles.back}>
        <div className={styles.backHeading}><span>IN MY OWN WORDS</span><span>拾念</span></div>
        <h3>留给未来的自己</h3>
        <p className={styles.noteTitle}>{title}</p>
        <div className={styles.thoughts}>
          {thoughts.length ? thoughts.map((thought, index) => <div key={index} className={styles.thought}><span>{String(index + 1).padStart(2, "0")}</span><p>{thought}</p></div>)
            : ["我理解了什么", "它为什么触动我", "我想怎样试一试"].map((prompt, index) => <div key={prompt} className={`${styles.thought} ${styles.placeholder}`}><span>0{index + 1}</span><p>{prompt}<small>等你写下自己的话</small></p></div>)}
        </div>
        <div className={styles.backFooter}><span>{preview ? "演示内容 · 未保存到账号" : "我的理解 · 自己写下"}</span><span>↻</span></div>
      </div>}
    />
    <p className="sr-only" id={descriptionId}>{text.trim() || "还没有写下自己的理解。"}</p>
    <div className={styles.controls}>
      <button type="button" className={styles.flip} onClick={() => setFlipped(value => !value)}><RotateCw size={14} />{flipped ? "看油画" : "翻看三句话"}</button>
      {onFavorite && <button type="button" className={styles.favorite} aria-pressed={favorite} disabled={pending || Boolean(reason)} onClick={onFavorite}>
        {pending ? <LoaderCircle className="spin" size={15} /> : favorite ? <Check size={15} /> : <Bookmark size={15} />}
        {pending ? "正在保存…" : favorite ? preview ? "演示已收藏" : "已收藏" : preview ? "试试收藏" : "收藏闪卡"}
      </button>}
      {onOpen && <button type="button" className={styles.favorite} onClick={onOpen}>打开原笔记<ArrowUpRight size={14} /></button>}
    </div>
    {onFavorite && <p className={styles.hint} role="status">{reason || (preview ? "仅本次预览有效，刷新后清空。" : favorite ? "已放入星图的「闪卡收藏」，再次点击可取消。" : "保存成一张小卡片，留待以后重温。")}</p>}
    <a className={styles.fullResolution} href={`/artworks/${painting.id}-4k.jpg`} target="_blank" rel="noopener noreferrer" aria-label={`查看《${painting.title}》的 4K 高清画作`}>查看 4K 画作<ArrowUpRight size={12} /></a>
    <a className={styles.credit} href={painting.source} target="_blank" rel="noopener noreferrer">画作出处 · 大都会艺术博物馆<ArrowUpRight size={11} /></a>
  </article>;
}
