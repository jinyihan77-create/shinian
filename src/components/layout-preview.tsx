"use client";

import { lazy, Suspense, useEffect, useId, useState } from "react";
import { ArrowDown, ArrowUpRight, BookOpen, Check, Headphones, Leaf, Link2, Pause, Play, Plus, Sparkles, X } from "lucide-react";
import styles from "./layout-preview.module.css";

const AeroShards = lazy(() => import("./aero-shards"));
const notes = [
  { icon: Headphones, type: "播客", title: "听完以后，试着说三句话", text: "听过的内容，用自己的语言再说一次，才慢慢变成自己的理解。", tag: "主动表达" },
  { icon: BookOpen, type: "阅读", title: "把开始的门槛放低一点", text: "允许第一步很小。先写下一句话，想法就有了继续生长的空间。", tag: "行动力" },
  { icon: Leaf, type: "生活", title: "给想法留一点呼吸的时间", text: "散步的时候不急着找答案，让刚刚听到的内容与自己的生活相遇。", tag: "整理思路" },
];

function Artwork() {
  const gradient = useId();
  const [motion, setMotion] = useState(false);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotion("gpu" in navigator && !preference.matches);
    update(); preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  const animate = motion && !failed;
  return <div className={styles.art} data-motion={animate ? paused ? "paused" : "playing" : "still"}>
    <svg className={styles.still} viewBox="0 0 600 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id={gradient}><stop stopColor="#e9daff"/><stop offset=".5" stopColor="#a080c4"/><stop offset="1" stopColor="#483056"/></linearGradient></defs>{Array.from({length:56}, (_, i) => <path key={i} d="M-22 0 12-10 24 3-7 7Z" fill={`url(#${gradient})`} opacity={.35 + i % 5 * .12} transform={`translate(${i * 12 - 20} ${(175 + Math.sin(i / 10) * 55 + Math.sin(i * 2.8) * 27).toFixed(3)}) rotate(${i * 31 % 90 - 45})`} />)}</svg>
    {animate && <Suspense fallback={null}><AeroShards backgroundColor="#19131f" shardColor="#c0a4dc" accentColor="#f0c4ef" placement="full" flow="stream" material="pearl" detail="bold" density={.6} scale={1.45} shardSize={1.5} speed={.28} spin={.22} turbulence={.3} glow={.55} bloom={.3} grain={.01} chromaticAberration={0} interaction="repel" interactionStrength={.25} holdToGather paused={paused} onError={() => setFailed(true)} /></Suspense>}
    <span className={styles.artLabel}>A LITTLE SPARK</span><span className={styles.artCaption}>让思绪，顺着光流动。</span>
    {animate && <button className={styles.pause} type="button" aria-label={paused ? "播放碎片动效" : "暂停碎片动效"} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={15}/> : <Pause size={15}/>}</button>}
    {!animate && <span className={styles.staticLabel}>静态光影</span>}
  </div>;
}

export function LayoutPreview() {
  const [text, setText] = useState("");
  const [source, setSource] = useState(false);
  const [notice, setNotice] = useState("");
  const previewNotice = () => setNotice("这是排版预览，输入没有保存，也没有调用 AI。");
  return <div className={styles.root}>
    <div className={styles.preview}><span>排版预览 · 演示资料 · 输入不保存</span><a href="/workspace">返回正式入口 <ArrowUpRight size={12}/></a></div>
    <header className={styles.header}><a href="#capture" className={styles.brand}><span className={styles.mark}><Sparkles size={22}/></span><span>拾念<small>A SPACE FOR YOUR MIND</small></span></a><nav aria-label="预览导航"><a className={styles.current} href="#capture">记录</a><a href="#collection">星图</a></nav><span className={styles.avatar} aria-label="预览模式">我</span></header>
    <main className={styles.main}>
      <section id="capture" className={styles.capture}>
        <div className={styles.heading}><p className={styles.eyebrow}><span/>YOUR MIND, IN GOOD COMPANY</p><h1>每个想法，<span>都值得有回声。</span></h1><p className={styles.subtitle}>留住一瞬灵感，慢慢变成自己的理解。</p></div>
        <div className={styles.composition}>
          <section className={styles.composer} aria-label="快速记录"><div className={styles.composerTop}><span><Plus size={16}/>捕捉此刻</span><span className={styles.local}><Check size={12}/>不必完整，先留下</span></div>
            <label className={styles.sr} htmlFor="layout-thought">我的想法</label><textarea id="layout-thought" placeholder="刚刚，什么触动了你？" value={text} maxLength={20000} onChange={event => setText(event.target.value)} />
            <div className={styles.toolbar}><button type="button" onClick={() => setSource(!source)} aria-expanded={source} aria-controls="layout-source"><Link2 size={15}/>{source ? "收起来源" : "添加播客或文章来源"}</button><span>{text.length.toLocaleString()} / 20,000</span></div>
            <div id="layout-source" className={styles.source} hidden={!source}><label>来源链接<input type="url" placeholder="粘贴播客或文章链接"/></label><label>原文片段<textarea rows={3} placeholder="粘贴让你有共鸣的那一段（选填）"/></label><p>链接仅作出处；整理内容需要你提供原文。</p></div>
            <footer className={styles.composerFooter}><span>预览输入不会保存</span><div><button type="button" className={styles.secondary} disabled={!text.trim()} onClick={previewNotice}>先保存</button><button type="button" className={styles.primary} disabled={!text.trim()} onClick={previewNotice}><Sparkles size={15}/>保存并整理<ArrowUpRight size={14}/></button></div></footer>
          </section>
          <aside className={styles.guide}><div className={styles.guideHeading}><span className={styles.overline}>FROM A SPARK TO AN IDEA</span><h2>输入之后，<br/>还有你的声音。</h2></div><Artwork/><p className={styles.guideDescription}>先捕捉，再用自己的话理解。<br/>好想法，不必等到准备好。</p></aside>
        </div>
      </section>
      <section id="collection" className={styles.collection}><div className={styles.collectionHeading}><div><h2>最近留下的灵感 <span>03</span></h2><p>有些想法，值得再想一遍。</p></div><span className={styles.demo}>演示资料</span></div><div className={styles.notes}>{notes.map((note, i) => <article key={note.title} className={styles.note} data-tone={i}><div className={styles.noteTop}><span className={styles.noteIcon}><note.icon size={18}/></span><span>{note.type}<span className={styles.noteDot}>·</span>演示</span></div><h3>{note.title}</h3><p>{note.text}</p><span className={styles.tag}># {note.tag}</span></article>)}</div></section>
      <p className={styles.footnote}><ArrowDown size={13}/>让输入经过你，变成自己的东西。</p>
    </main>
    {notice && <div className={styles.toast} role="status"><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice("")}><X size={17}/></button></div>}
  </div>;
}

