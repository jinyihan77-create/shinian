"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ArrowUpRight, Check, LoaderCircle, Moon, RotateCw, Sparkles, X } from "lucide-react";
import { CHECKIN_EXPERIENCE_VERSION, CHECKIN_LIMITS, checkinKeywordsFromNotes, checkinSourceNoteIds, checkinSummarySchema, getCheckinDay, stableStarTheme, stableVisualSeed, suggestCheckinFromNotes, type CheckinSummary } from "@/lib/checkin";
import { SEVEN_STAR_POINTS, STAR_MATERIALS, starMaterial, starPath } from "@/lib/star-materials";
import type { EchoNote } from "@/lib/types";
import styles from "./checkin-panel.module.css";
import { DailyOrbit } from "./daily-orbit";
import { SevenStarCard } from "./seven-star-card";
const defaultQuote = "把一点微光，留给明天的自己。";
const ENTRY_STAR_PATH = starPath(SEVEN_STAR_POINTS, 50, 46);
const JOURNEY_SCENES = [
  { label: "念头亮起", title: "跟着这一点光，往前走。" },
  { label: "穿过回声", title: "越靠近，散落的念头越清晰。" },
  { label: "抵达今夜", title: "今晚的星，在这里。" },
] as const;
const JOURNEY_DUST = Array.from({ length: 64 }, (_, index) => ({
  left: 4 + ((index * 37 + index * index * 3) % 92),
  top: 3 + ((index * 53 + index * index * 7) % 92),
  size: 1 + (index % 4) * .45,
  opacity: .2 + (index % 7) * .055,
  layer: index % 3,
}));
const JOURNEY_STREAKS = Array.from({ length: 22 }, (_, index) => ({
  angle: index * (360 / 22) + (index % 3) * 2.8,
  radius: 22 + (index % 6) * 8,
  length: 34 + (index % 5) * 13,
}));
const JOURNEY_WORD_POSITIONS = [
  { left: 18, top: 27, drift: -32 }, { left: 76, top: 34, drift: 28 }, { left: 23, top: 66, drift: -24 },
  { left: 71, top: 72, drift: 35 }, { left: 34, top: 18, drift: -18 }, { left: 82, top: 57, drift: 22 },
];

function clampJourneyDepth(value: number) {
  return Math.max(0, Math.min(1, value));
}

class CheckinRequestError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

type CheckinSaveInput = { expectedDay: string; mood: string; quote: string; starVariant: number; themeId: string; materialId: string; visualSeed: string; experienceVersion: number; sourceNoteIds: string[] };
type CheckinUpdateInput = { expectedDay: string; mood: string; quote: string; expectedRevision: number };
async function requestCheckin(userId: string, input?: CheckinSaveInput | CheckinUpdateInput, signal?: AbortSignal, writeMethod: "POST" | "PATCH" = "POST"): Promise<CheckinSummary> {
  let response: Response;
  try {
    response = await fetch("/api/checkins", {
      method: input ? writeMethod : "GET", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "x-echo-user-id": userId },
      ...(input ? { body: JSON.stringify(input) } : {}), signal: signal ?? AbortSignal.timeout(20000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new CheckinRequestError("连接中断，尚未确认打卡。你的文字仍在，恢复连接后可以重试。");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("echo:session-expired"));
    throw new CheckinRequestError(typeof body?.error === "string" ? body.error : "暂时无法读取或保存打卡，请稍后重试。", body?.code);
  }
  const parsed = checkinSummarySchema.safeParse(body);
  if (!parsed.success || (input && (!parsed.data.entry || parsed.data.today !== input.expectedDay))) {
    throw new CheckinRequestError("服务器尚未确认有效的打卡记录，请保留文字并重新核对。");
  }
  return parsed.data;
}

/** Preview deliberately keeps its state in memory and never calls the check-in API. */
export function CheckinPanel({ userId, notes = [], preview = false, accountPaused = false, compact = false }: { userId?: string; notes?: readonly EchoNote[]; preview?: boolean; accountPaused?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(0);
  const [mood, setMood] = useState("平静");
  const [quote, setQuote] = useState("");
  const [summary, setSummary] = useState<CheckinSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState(0);
  const busyRef = useRef(false);
  const preserveDraftRef = useRef(false);
  const customizedRef = useRef(false);
  const lastTheme = useRef(-1);
  const currentSuggestion = suggestCheckinFromNotes(notes);
  const currentKeywords = checkinKeywordsFromNotes(notes);

  function show() {
    const suggestion = currentSuggestion;
    if (!customizedRef.current) { setMood(suggestion.mood); setQuote(suggestion.quote); }
    const day = getCheckinDay();
    const initial = stableStarTheme(userId ?? "preview", day, STAR_MATERIALS.length);
    lastTheme.current = initial;
    setTheme(initial); setSelectedVariant(0); preserveDraftRef.current = false; setFlipped(false); setError(""); setNotice("");
    if (!preview) setSummary(null);
    setOpen(true);
  }
  const close = useCallback(() => { if (!busyRef.current) setOpen(false); }, []);

  useEffect(() => {
    if (!open) return;
    if (preview) {
      const today = getCheckinDay();
      setSummary(value => value?.today === today ? value : { today, totalDays: 0, currentStreak: 0, entry: null });
      return;
    }
    if (!userId || accountPaused) {
      setError("请先恢复私人账号登录，再读取和保存打卡。当前填写的文字仍保留。"); setLoading(false); setSummary(null); return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    let disposed = false;
    setLoading(true); setError(""); setSummary(null);
    void requestCheckin(userId, undefined, controller.signal).then(value => {
      if (disposed) return;
      setSummary(value);
      if (value.entry && !preserveDraftRef.current) {
        setMood(value.entry.mood); setQuote(value.entry.quote);
        const savedTheme = Number((value.entry.themeId ?? "").replace(/^climate-/, ""));
        if (Number.isFinite(savedTheme)) { lastTheme.current = savedTheme; setTheme(savedTheme); }
        setSelectedVariant(value.entry.starVariant ?? 0);
      } else if (value.entry && preserveDraftRef.current) {
        setNotice("你的本地文字仍保留在输入框里；今天已有一条云端记录，这次文字尚未保存。");
      }
    }).catch(err => {
      if (!disposed) setError(controller.signal.aborted ? "读取超时，请重试；尚未取得今天的打卡记录。" : err instanceof Error ? err.message : "暂时无法读取打卡。");
    }).finally(() => { clearTimeout(timer); if (!disposed) setLoading(false); });
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [open, preview, userId, accountPaused, refresh]);

  async function submit() {
    if (busyRef.current || !summary || summary.entry || loading || (!preview && (accountPaused || !userId))) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const value = preview ? {
        today: summary.today, totalDays: 1, currentStreak: 1,
        entry: { day: summary.today, mood: mood.trim(), quote: quote.trim(), createdAt: new Date().toISOString(), starVariant: selectedVariant, themeId: `climate-${theme % 7}`, materialId: starMaterial(theme).kind, visualSeed: stableVisualSeed(userId ?? "preview", summary.today), experienceVersion: CHECKIN_EXPERIENCE_VERSION, sourceNoteIds: checkinSourceNoteIds(notes, summary.today) },
      } : await requestCheckin(userId!, { expectedDay: summary.today, mood: mood.trim(), quote: quote.trim(), starVariant: selectedVariant, themeId: `climate-${theme % 7}`, materialId: starMaterial(theme).kind, visualSeed: stableVisualSeed(userId!, summary.today), experienceVersion: CHECKIN_EXPERIENCE_VERSION, sourceNoteIds: checkinSourceNoteIds(notes, summary.today) });
      setSummary(value); setMood(value.entry!.mood); setQuote(value.entry!.quote); setFlipped(false);
      setNotice(preview ? "已展示一次打卡效果。演示天数仅在当前页面，不会保存。" : "今天的打卡已保存到你的私人账号。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "打卡未确认成功，文字仍为你保留。");
      if (err instanceof CheckinRequestError && err.code === "DAY_CHANGED") {
        preserveDraftRef.current = true;
        setNotice("日期已进入新的一天。正在重新核对，文字仍保留；读取完成后请再次点亮。");
        setRefresh(value => value + 1);
      }
    } finally { busyRef.current = false; setBusy(false); }
  }

  useEffect(() => {
    const entry = summary?.entry;
    const expectedDay = summary?.today;
    if (!open || preview || !entry?.revision || !expectedDay || !userId || accountPaused || busyRef.current || (entry.mood === mood.trim() && entry.quote === quote.trim())) return;
    const timer = window.setTimeout(() => {
      if (busyRef.current) return;
      busyRef.current = true; setBusy(true); setError(""); setNotice("正在同步调整…");
      void requestCheckin(userId, { expectedDay, mood: mood.trim(), quote: quote.trim(), expectedRevision: entry.revision! }, undefined, "PATCH")
        .then(value => { setSummary(value); setNotice("星笺调整已保存。"); })
        .catch(err => { setError(err instanceof Error ? err.message : "星笺调整尚未确认，文字仍为你保留。"); setNotice(""); })
        .finally(() => { busyRef.current = false; setBusy(false); });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [accountPaused, mood, open, preview, quote, summary, userId]);

  return <>
    <button id="daily-star-entry" className={`${styles.entry} ${compact ? styles.entryCompact : ""}`} onClick={show} aria-label="打开星空打卡牌">
      <span className={styles.entryArt} aria-hidden="true"><span className={styles.entryStar}><svg viewBox="0 0 100 100"><defs><linearGradient id="entry-star-light" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff4fa" /><stop offset=".42" stopColor="#eeb8d2" /><stop offset=".72" stopColor="#c9b7e6" /><stop offset="1" stopColor="#b8dbea" /></linearGradient></defs><path d={ENTRY_STAR_PATH} fill="url(#entry-star-light)" fillOpacity=".86" stroke="#fff9fc" strokeOpacity=".85" strokeWidth=".7" /><circle cx="50" cy="50" r="2" fill="#fff" /></svg></span></span>
      <span className={styles.entryCopy}><span className={styles.eyebrow}>Q7 · 一念入星河</span><strong>{currentSuggestion.sourceCount > 0 ? "今晚的星海，已经亮起" : "给今天，留一颗星"}</strong><span>{currentSuggestion.sourceCount > 0 ? `今天的 ${currentSuggestion.sourceCount} 条记录正在远处发光。` : "还没有新的记录，也可以留一颗无字星。"}</span></span>
      <span className={styles.entryAction}>去摘星<ArrowUpRight size={18} /></span>
    </button>
    {open && createPortal(<CheckinDialog
      theme={theme} mood={mood} quote={quote} summary={summary} preview={preview} busy={busy} selectedVariant={selectedVariant}
      suggestionCount={currentSuggestion.sourceCount} keywords={currentKeywords}
      loading={loading} error={error} notice={notice} flipped={flipped}
      disabled={accountPaused || !userId} onClose={close}
      onSelectTheme={(value, variant) => { lastTheme.current = value % STAR_MATERIALS.length; setTheme(value); setSelectedVariant(variant); setFlipped(false); }}
      onMood={value => { customizedRef.current = true; setMood(value); }} onQuote={value => { customizedRef.current = true; setQuote(value); }} onFlip={() => setFlipped(value => !value)}
      onRetry={() => { preserveDraftRef.current = true; setRefresh(value => value + 1); }} onSubmit={submit}
    />, document.body)}
  </>;
}

interface DialogProps {
  theme: number; mood: string; quote: string; summary: CheckinSummary | null; selectedVariant: number;
  suggestionCount: number; keywords: readonly string[];
  preview: boolean; busy: boolean; loading: boolean; disabled: boolean; flipped: boolean;
  error: string; notice: string;
  onClose: () => void; onMood: (value: string) => void; onQuote: (value: string) => void;
  onSelectTheme: (theme: number, variant: number) => void;
  onFlip: () => void; onRetry: () => void; onSubmit: () => void;
}

function StarJourney({ day, reduced, keywords, onArrive }: { day: string; reduced: boolean; keywords: readonly string[]; onArrive: () => void }) {
  const [depth, setDepth] = useState(0);
  const [gestureSettled, setGestureSettled] = useState(0);
  const depthRef = useRef(0);
  const gesture = useRef<{ pointerId: number; y: number; at: number; velocity: number } | null>(null);
  const step = depth < .34 ? 0 : depth < .7 ? 1 : 2;
  const updateDepth = useCallback((value: number | ((current: number) => number)) => {
    const next = clampJourneyDepth(typeof value === "function" ? value(depthRef.current) : value);
    depthRef.current = next;
    setDepth(next);
  }, []);
  const advance = useCallback(() => {
    updateDepth(current => current < .34 ? .38 : current < .7 ? .74 : 1);
  }, [updateDepth]);
  useEffect(() => {
    if (reduced) { onArrive(); return; }
    if (depth < .995 || gesture.current) return;
    const timer = window.setTimeout(onArrive, 520);
    return () => window.clearTimeout(timer);
  }, [depth, gestureSettled, onArrive, reduced]);
  const journeyStyle = {
    "--journey-depth": depth,
    "--journey-far-scale": 1 + depth * .82,
    "--journey-near-scale": 1 + depth * 1.72,
    "--journey-portal-size": `${76 + depth * 390}px`,
    "--journey-portal-opacity": .12 + depth * .58,
    "--journey-streak-opacity": Math.max(0, (depth - .08) * .62),
    "--journey-streak-scale": .04 + depth * 1.25,
    "--journey-light-scale": .88 + depth * 1.08,
    "--journey-sky-brightness": .92 + depth * .28,
  } as CSSProperties;
  const scene = JOURNEY_SCENES[step];
  const progress = Math.round(depth * 100);
  const onPointerEnd = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    updateDepth(value => value + Math.max(-.08, Math.min(.14, current.velocity * 130)));
    setGestureSettled(value => value + 1);
  }, [updateDepth]);
  return <section className={styles.journey} data-step={step} tabIndex={0} style={journeyStyle}
    aria-label="进入星海的手势旅程"
    onWheel={event => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? event.currentTarget.clientHeight : 1;
      const delta = event.deltaY * unit;
      updateDepth(value => value + Math.sign(delta) * Math.min(.15, Math.abs(delta) / 680));
    }}
    onPointerDown={event => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { pointerId: event.pointerId, y: event.clientY, at: performance.now(), velocity: 0 };
    }}
    onPointerMove={event => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const now = performance.now();
      const delta = (current.y - event.clientY) / Math.max(300, event.currentTarget.clientHeight * .72);
      const elapsed = Math.max(8, now - current.at);
      current.velocity = delta / elapsed;
      current.y = event.clientY;
      current.at = now;
      updateDepth(value => value + delta);
    }}
    onPointerUp={onPointerEnd}
    onPointerCancel={onPointerEnd}
    onKeyDown={event => {
      if ([" ", "ArrowDown", "PageDown"].includes(event.key)) { event.preventDefault(); advance(); }
      if (["ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); updateDepth(value => value - .34); }
    }}>
    <div className={styles.journeySky} aria-hidden="true">
      <span className={`${styles.journeyDust} ${styles.journeyDustFar}`}>{JOURNEY_DUST.filter(star => star.layer !== 2).map((star, index) => <i key={index} style={{ left: `${star.left}%`, top: `${star.top}%`, width: `${star.size}px`, height: `${star.size}px`, opacity: star.opacity } as CSSProperties} />)}</span>
      <span className={`${styles.journeyDust} ${styles.journeyDustNear}`}>{JOURNEY_DUST.filter(star => star.layer === 2).map((star, index) => <i key={index} style={{ left: `${star.left}%`, top: `${star.top}%`, width: `${star.size + .7}px`, height: `${star.size + .7}px`, opacity: Math.min(.72, star.opacity + .16) } as CSSProperties} />)}</span>
      <span className={styles.journeyPortal} />
      <span className={styles.journeyStreaks}>{JOURNEY_STREAKS.map((streak, index) => <i key={index} style={{ "--streak-angle": `${streak.angle}deg`, "--streak-radius": `${streak.radius}px`, "--streak-length": `${streak.length}px` } as CSSProperties} />)}</span>
      <span className={styles.thoughtLight} />
    </div>
    {keywords.length > 0 && <div className={styles.journeyWords} aria-label="今天沿途闪过的关键词">{keywords.slice(0, 6).map((word, index) => {
      const position = JOURNEY_WORD_POSITIONS[index];
      const appears = Math.max(0, Math.min(1, (depth - .08 - index * .045) * 5));
      const fades = Math.max(0, Math.min(1, (depth - .76 - index * .02) * 5));
      return <span key={`${word}-${index}`} style={{ left: `${position.left}%`, top: `${position.top}%`, opacity: appears * (1 - fades), transform: `translate3d(${position.drift * depth}px,${(depth - .5) * position.drift * .35}px,0) scale(${.72 + depth * .54})` }}>{word}</span>;
    })}</div>}
    <div className={styles.journeyCopy} key={step}><span>{scene.label}</span><h2>{scene.title}</h2><p>{step < 2 ? "滚轮向下，或用手指上滑，朝这点光靠近" : "再向前一点，就能抵达今天的星球。"}</p></div>
    <div className={styles.journeyProgress} role="progressbar" aria-label="前往星海的距离" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>{Array.from({ length: 7 }, (_, index) => <i key={index} data-active={depth >= index / 7} />)}</div>
    <div className={styles.journeyActions}><button type="button" onClick={advance}>{step === 2 ? "穿过这束光" : "往前"}<ArrowUpRight size={15} /></button><button type="button" onClick={onArrive}>直接到星海</button></div>
    <small>{day.replaceAll("-", ".")} · Q7</small>
  </section>;
}

function CheckinDialog(props: DialogProps) {
  const { theme, mood, quote, summary, preview, busy, loading, error, notice, flipped, suggestionCount, keywords, disabled, onSubmit, selectedVariant } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [stage, setStage] = useState<"journey" | "star-sea" | "revealing">("journey");
  const [orbitTheme, setOrbitTheme] = useState(theme);
  const [reduced, setReduced] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const autoSaveAttempted = useRef(false);
  const material = starMaterial(theme);
  const confirmed = Boolean(summary?.entry);
  function claimCore() {
    props.onSelectTheme(orbitTheme, 0);
    setPicked(0);
    setStage("revealing");
  }
  function pickAgain() {
    setOrbitTheme(theme); setPicked(null);
    dialog.current?.scrollTo?.({ top: 0, behavior: "instant" });
  }
  useEffect(() => {
    if (picked !== null) {
      dialog.current?.scrollTo?.({ top: 0, behavior: "instant" });
      title.current?.focus({ preventScroll: true });
    }
  }, [picked]);

  useEffect(() => {
    const element = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => { element.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReduced(media.matches);
    const syncVisible = () => setHidden(document.hidden);
    syncPreference(); syncVisible();
    media.addEventListener("change", syncPreference); document.addEventListener("visibilitychange", syncVisible);
    return () => { media.removeEventListener("change", syncPreference); document.removeEventListener("visibilitychange", syncVisible); };
  }, []);
  useEffect(() => {
    if (summary?.entry) {
      setPicked(summary.entry.starVariant ?? selectedVariant);
      return;
    }
    if (reduced) setStage("star-sea");
  }, [reduced, selectedVariant, summary?.entry, summary?.today]);
  useEffect(() => {
    if (picked === null) {
      autoSaveAttempted.current = false;
      return;
    }
    if (autoSaveAttempted.current || editing || busy || loading || !summary || summary.entry || error || (!preview && disabled)) return;
    const timer = window.setTimeout(() => {
      autoSaveAttempted.current = true;
      onSubmit();
    }, 420);
    return () => window.clearTimeout(timer);
  }, [picked, editing, busy, loading, summary, error, preview, disabled, onSubmit]);
  return <dialog ref={dialog} className={styles.dialog} style={{ "--star-glow": material.glow, "--star-secondary": material.secondary, "--star-accent": material.accent } as CSSProperties} aria-labelledby={picked === null ? undefined : "checkin-title"} aria-label={picked === null ? "今夜跃迁" : undefined}
    onCancel={event => { event.preventDefault(); props.onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) props.onClose(); }}>
    <div className={styles.modal}>
      <header className={styles.modalHeader}><span><Moon size={16} />拾念<span className={styles.headerDivider}>/</span>今夜跃迁</span><div className={styles.headerActions}>{picked !== null && !confirmed && <button className={styles.pickAgain} onClick={pickAgain} disabled={busy}><ArrowLeft size={13} />重看星球</button>}<button aria-label="关闭打卡牌" onClick={props.onClose} disabled={busy}><X size={20} /></button></div></header>
      {stage === "journey" ? <StarJourney day={summary?.today ?? getCheckinDay()} reduced={reduced} keywords={keywords} onArrive={() => {
        setStage("star-sea");
      }} /> : picked === null ? <div className={styles.picker}>
        <DailyOrbit key={orbitTheme} theme={orbitTheme} keywords={keywords} onClaim={claimCore} paused={hidden} reduceMotion={reduced} />
        <p className={styles.pickerNote}>{preview ? "体验预览 · 收下星核不会保存或增加打卡天数" : "这颗星核由今天的记录聚成 · 带回身边后自动保存"}</p>
      </div> : <div className={styles.layout}>
        <section className={styles.visual} aria-label="今日星笺">
          <div className={styles.scene}>
            <div className={styles.halo} aria-hidden="true" />
            {summary && <SevenStarCard theme={theme} mood={mood} quote={quote} date={summary.today} totalDays={summary.totalDays} currentStreak={summary.currentStreak} sourceCount={suggestionCount} flipped={flipped} preview={preview} syncing={busy} />}
          </div>
          <p className={styles.sceneCaption}>{flipped ? "最近七天的星轨，留给回看" : "今日星核，沿着刚才的轨道展开"}</p>
          <div className={styles.cardControls}>
            <button onClick={props.onFlip} disabled={!summary || loading}><RotateCw size={15} />{flipped ? "看看心情" : "看看天数"}</button>
          </div>
          <p className={styles.material}>{material.name}<span>·</span>今日回响晶片</p>
          {reduced && <p className={styles.fallbackNotice}>已按减少动态效果显示，星笺仍可翻面和保存。</p>}
        </section>
        <form className={styles.form} onSubmit={event => { event.preventDefault(); props.onSubmit(); }}>
          <span className={styles.eyebrow}>{preview ? "体验预览 · 不会保存" : "你摘下的光，属于今天"}</span>
          <h2 ref={title} tabIndex={-1} id="checkin-title">给今天，<br />留一颗星。</h2>
          <p className={styles.intro}>{suggestionCount > 0 ? `已经从今天的 ${suggestionCount} 条记录里，为你拾起这一句。` : "今天还没有新的记录，可以留一颗无字星，也可以补上一句话。"}</p>
          <fieldset className={styles.fields} disabled={busy || loading}>
            <legend className="sr-only">今天的心情和金句</legend>
            <div className={styles.generated}><span className={styles.generatedLabel}>{suggestionCount > 0 ? "从今天的记录里拾到" : "无字星 · 等你说一句"}</span><strong className={styles.generatedMood}>{mood || "此刻"}</strong><p className={styles.generatedQuote}>{quote || "还没有一句回响"}</p></div>
            <details className={styles.adjustment} onToggle={event => setEditing(event.currentTarget.open)}><summary>调整这张牌 <span>心情与文字</span></summary><div className={styles.adjustmentBody}>
              <label className={styles.label} htmlFor="checkin-mood">此刻的心情</label>
              <input id="checkin-mood" className={styles.moodInput} value={mood} onChange={event => props.onMood(event.target.value)} maxLength={CHECKIN_LIMITS.mood} placeholder="写下自己的心情" />
              <label className={styles.quoteLabel} htmlFor="checkin-quote"><span>挂在牌上的一句话</span><span>{quote.length}/{CHECKIN_LIMITS.quote}</span></label>
              <textarea id="checkin-quote" className={styles.quoteInput} value={quote} onChange={event => props.onQuote(event.target.value)} maxLength={CHECKIN_LIMITS.quote} placeholder={defaultQuote} rows={3} />
            </div></details>
          </fieldset>
          <div className={styles.stats} aria-live="polite"><span>累计 <strong>{loading || !summary ? "—" : summary.totalDays}</strong> 天</span><span>连续 <strong>{loading || !summary ? "—" : summary.currentStreak}</strong> 天</span>{preview && <small>演示天数</small>}</div>
          <div className={styles.submit} role="status" aria-label="星笺同步状态">{busy || loading ? <LoaderCircle size={17} className="spin" /> : confirmed ? <Check size={17} /> : <Sparkles size={17} />}{loading ? "正在读取今天的星…" : busy ? "正在同步这颗星…" : confirmed ? preview ? "演示星笺 · 没有保存" : "已留在今天" : error ? "这颗星还没有同步" : "正在把这颗星留在今天…"}</div>
          {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" onClick={() => { autoSaveAttempted.current = false; props.onRetry(); }} disabled={busy || loading}>重新核对并同步</button></div>}
          {notice && <p className={styles.notice} role="status">{notice}</p>}
          <p className={styles.footnote}>{preview ? "这里只体验效果，不读取私人记录，也不会保存心情或天数。" : confirmed ? "今天的心情已经收好。明天再挂上一句新的话。" : "以北京时间记一天；每天一次，保存后计入天数。"}</p>
        </form>
      </div>}
    </div>
  </dialog>;
}
