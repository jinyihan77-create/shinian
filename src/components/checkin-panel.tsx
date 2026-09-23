"use client";

import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Check, LoaderCircle, Moon, Pause, Play, RefreshCw, RotateCw, Sparkles, X } from "lucide-react";
import { CHECKIN_LIMITS, checkinSummarySchema, getCheckinDay, suggestCheckinFromNotes, type CheckinSummary } from "@/lib/checkin";
import { createCheckinArtwork } from "@/lib/checkin-art";
import { STAR_MATERIALS, starMaterial } from "@/lib/star-materials";
import type { EchoNote } from "@/lib/types";
import styles from "./checkin-panel.module.css";
import { StarCurtain } from "./star-curtain";

const LanyardCheckin = dynamic(() => import("./lanyard-checkin"), { ssr: false });
const defaultQuote = "把一点微光，留给明天的自己。";

class CheckinRequestError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

async function requestCheckin(userId: string, input?: { expectedDay: string; mood: string; quote: string }, signal?: AbortSignal): Promise<CheckinSummary> {
  let response: Response;
  try {
    response = await fetch("/api/checkins", {
      method: input ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
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
  const busyRef = useRef(false);
  const preserveDraftRef = useRef(false);
  const customizedRef = useRef(false);
  const lastTheme = useRef(-1);

  function chooseTheme() {
    const seed = window.crypto.getRandomValues(new Uint32Array(1))[0] % 100000;
    const next = seed % STAR_MATERIALS.length === lastTheme.current ? seed + 1 : seed;
    lastTheme.current = next % STAR_MATERIALS.length;
    setTheme(next);
  }
  function show() {
    const suggestion = suggestCheckinFromNotes(notes);
    if (!customizedRef.current) { setMood(suggestion.mood); setQuote(suggestion.quote); }
    chooseTheme(); preserveDraftRef.current = false; setFlipped(false); setError(""); setNotice(""); setOpen(true);
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
        entry: { day: summary.today, mood: mood.trim(), quote: quote.trim(), createdAt: new Date().toISOString() },
      } : await requestCheckin(userId!, { expectedDay: summary.today, mood: mood.trim(), quote: quote.trim() });
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

  return <>
    <button id="daily-star-entry" className={`${styles.entry} ${compact ? styles.entryCompact : ""}`} onClick={show} aria-label="打开星空打卡牌">
      <span className={styles.entryArt} aria-hidden="true"><span className={styles.entryCord} /><span className={styles.entryBadge}><svg viewBox="0 0 100 140"><rect x="8" y="8" width="84" height="124" rx="10" fill="#24213b" stroke="currentColor" strokeOpacity=".72" /><path d="M18 39h64M18 93h64" stroke="currentColor" strokeOpacity=".16" /><circle cx="27" cy="25" r="1.8" fill="#f7eaff" /><circle cx="67" cy="48" r="1.3" fill="#e3d7ff" /><circle cx="43" cy="74" r="1" fill="#fff" /><circle cx="75" cy="108" r="1.8" fill="#f6e5ff" /></svg><small>SHINIAN</small></span></span>
      <span className={styles.entryCopy}><span className={styles.eyebrow}>Q7 · 每天一点微光</span><strong>给今天，摘一颗星</strong><span>今天的记录已经替你拾好一句回响。</span></span>
      <span className={styles.entryAction}>去摘星<ArrowUpRight size={18} /></span>
    </button>
    {open && createPortal(<CheckinDialog
      theme={theme} mood={mood} quote={quote} summary={summary} preview={preview} busy={busy}
      suggestionCount={suggestCheckinFromNotes(notes).sourceCount}
      loading={loading} error={error} notice={notice} flipped={flipped}
      disabled={accountPaused || !userId} onClose={close} onTheme={chooseTheme}
      onSelectTheme={value => { lastTheme.current = value % STAR_MATERIALS.length; setTheme(value); setFlipped(false); }}
      onMood={value => { customizedRef.current = true; setMood(value); }} onQuote={value => { customizedRef.current = true; setQuote(value); }} onFlip={() => setFlipped(value => !value)}
      onRetry={() => { preserveDraftRef.current = true; setRefresh(value => value + 1); }} onSubmit={submit}
    />, document.body)}
  </>;
}

interface DialogProps {
  theme: number; mood: string; quote: string; summary: CheckinSummary | null;
  suggestionCount: number;
  preview: boolean; busy: boolean; loading: boolean; disabled: boolean; flipped: boolean;
  error: string; notice: string;
  onClose: () => void; onTheme: () => void; onMood: (value: string) => void; onQuote: (value: string) => void;
  onSelectTheme: (theme: number) => void;
  onFlip: () => void; onRetry: () => void; onSubmit: () => void;
}

function CheckinDialog(props: DialogProps) {
  const { theme, mood, quote, summary, preview, busy, loading, error, notice, flipped, suggestionCount, disabled, onSubmit } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [curtainTheme, setCurtainTheme] = useState(theme);
  const [art, setArt] = useState<{ frontImage: string; backImage: string } | null>(null);
  const [artError, setArtError] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const autoSaveAttempted = useRef(false);
  const material = starMaterial(theme);
  const confirmed = Boolean(summary?.entry);
  const savingDisabled = busy || loading || !summary || confirmed || (!preview && (props.disabled || Boolean(error)));
  const unavailable = useCallback(() => setFallback(true), []);
  const rendered = useCallback(() => setReady(true), []);

  function pickStar(index: number) {
    props.onSelectTheme(curtainTheme + index);
    setPicked(index);
  }
  function pickAgain() {
    setCurtainTheme(theme + 7); setPicked(null); setReady(false); setFallback(false); setPaused(false);
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
    if (picked === null) return;
    const timer = window.setTimeout(() => {
      try {
        setArt(createCheckinArtwork({ theme, mood, quote: quote.trim() || defaultQuote, totalDays: summary?.totalDays ?? 0, currentStreak: summary?.currentStreak ?? 0, date: summary?.today ?? getCheckinDay(), preview }));
        setArtError(false);
      } catch { setArtError(true); }
    }, 180);
    return () => clearTimeout(timer);
  }, [theme, mood, quote, summary, preview, picked]);
  useEffect(() => {
    if (picked === null) {
      autoSaveAttempted.current = false;
      return;
    }
    if (autoSaveAttempted.current || editing || busy || loading || !summary || summary.entry || error || (!preview && disabled)) return;
    const timer = window.setTimeout(() => {
      autoSaveAttempted.current = true;
      onSubmit();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [picked, editing, busy, loading, summary, error, preview, disabled, onSubmit]);
  useEffect(() => {
    if (picked === null || ready || fallback || reduced || !art) return;
    const timer = window.setTimeout(() => setFallback(true), 15000);
    return () => clearTimeout(timer);
  }, [ready, fallback, reduced, art, picked]);

  const staticMode = fallback || reduced;
  return <dialog ref={dialog} className={styles.dialog} style={{ "--star-glow": material.glow, "--star-secondary": material.secondary, "--star-accent": material.accent } as CSSProperties} aria-labelledby={picked === null ? undefined : "checkin-title"} aria-label={picked === null ? "给今天，摘一颗星" : undefined}
    onCancel={event => { event.preventDefault(); props.onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) props.onClose(); }}>
    <div className={styles.modal}>
      <header className={styles.modalHeader}><span><Moon size={16} />拾念<span className={styles.headerDivider}>/</span>每天一点微光</span><div className={styles.headerActions}>{picked !== null && <button className={styles.pickAgain} onClick={pickAgain} disabled={busy}><ArrowLeft size={13} />再摘一颗</button>}<button aria-label="关闭打卡牌" onClick={props.onClose} disabled={busy}><X size={20} /></button></div></header>
      {picked === null ? <div className={styles.picker}>
        <StarCurtain key={curtainTheme} theme={curtainTheme} onPick={pickStar} paused={hidden} reduceMotion={reduced} />
        <p className={styles.pickerNote}>{preview ? "体验预览 · 摘星不会保存或增加打卡天数" : "今日回响已经拾好 · 摘下一颗星，即刻收进今天"}</p>
      </div> : <div className={styles.layout}>
        <section className={styles.visual} aria-label="星空吊牌预览">
          <div className={styles.scene}>
            <div className={styles.halo} aria-hidden="true" />
            {art && !staticMode && <LanyardCheckin {...art} theme={theme} flipped={flipped} paused={paused || hidden} onUnavailable={unavailable} onReady={rendered} className={styles.lanyard} />}
            {art && (staticMode || !ready) && <div className={styles.staticBadge} aria-hidden="true"><span className={styles.staticCord} />{material.halo && <span className={styles.staticOrbit} />}<img src={flipped && summary ? art.backImage : art.frontImage} alt="" draggable={false} /></div>}
            {!art && <div className={styles.sceneLoading}>{artError ? <><Sparkles /><p>{mood || "此刻的心情"}</p><strong>{quote || defaultQuote}</strong></> : <><LoaderCircle className="spin" size={20} /><span>正在描绘这一片星空…</span></>}</div>}
          </div>
          <p className={styles.sceneCaption}>{staticMode ? "轻按下方按钮，看看另一面" : ready ? "拖动吊牌，让今天的微光轻轻晃动" : "正在挂好你的星空牌…"}</p>
          <div className={styles.cardControls}>
            <button onClick={props.onFlip} disabled={!summary || loading}><RotateCw size={15} />{flipped ? "看看心情" : "看看天数"}</button>
            {!staticMode && <button onClick={() => setPaused(value => !value)} aria-label={paused ? "恢复吊牌动态" : "暂停吊牌动态"}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? "播放" : "暂停"}</button>}
            <button onClick={props.onTheme}><RefreshCw size={14} />换种质感</button>
          </div>
          <p className={styles.material}>{material.name}<span>·</span>每次相遇，都有一点不同</p>
          {fallback && <p className={styles.fallbackNotice}>当前显示静态吊牌，翻面和打卡仍可使用。</p>}
        </section>
        <form className={styles.form} onSubmit={event => { event.preventDefault(); props.onSubmit(); }}>
          <span className={styles.eyebrow}>{preview ? "体验预览 · 不会保存" : "你摘下的光，属于今天"}</span>
          <h2 ref={title} tabIndex={-1} id="checkin-title">给今天，<br />留一颗星。</h2>
          <p className={styles.intro}>{suggestionCount > 0 ? `已经从今天的 ${suggestionCount} 条记录里，为你拾起这一句。` : "今天还没有新的记录，先留下一句安静的默认回响。"}</p>
          <fieldset className={styles.fields} disabled={busy || loading || confirmed}>
            <legend className="sr-only">今天的心情和金句</legend>
            <div className={styles.generated}><span className={styles.generatedLabel}>{suggestionCount > 0 ? "根据今日记录生成" : "今日默认回响"}</span><strong className={styles.generatedMood}>{mood || "平静"}</strong><p className={styles.generatedQuote}>{quote || defaultQuote}</p></div>
            <details className={styles.adjustment} onToggle={event => setEditing(event.currentTarget.open)}><summary>调整这张牌 <span>心情与文字</span></summary><div className={styles.adjustmentBody}>
              <label className={styles.label} htmlFor="checkin-mood">此刻的心情</label>
              <input id="checkin-mood" className={styles.moodInput} value={mood} onChange={event => props.onMood(event.target.value)} maxLength={CHECKIN_LIMITS.mood} placeholder="写下自己的心情" />
              <label className={styles.quoteLabel} htmlFor="checkin-quote"><span>挂在牌上的一句话</span><span>{quote.length}/{CHECKIN_LIMITS.quote}</span></label>
              <textarea id="checkin-quote" className={styles.quoteInput} value={quote} onChange={event => props.onQuote(event.target.value)} maxLength={CHECKIN_LIMITS.quote} placeholder={defaultQuote} rows={3} />
            </div></details>
          </fieldset>
          <div className={styles.stats} aria-live="polite"><span>累计 <strong>{loading || !summary ? "—" : summary.totalDays}</strong> 天</span><span>连续 <strong>{loading || !summary ? "—" : summary.currentStreak}</strong> 天</span>{preview && <small>演示天数</small>}</div>
          <button className={styles.submit} disabled={savingDisabled} type="submit">{busy || loading ? <LoaderCircle size={17} className="spin" /> : confirmed ? <Check size={17} /> : <Sparkles size={17} />}{loading ? "正在读取打卡…" : busy ? "正在保存…" : confirmed ? preview ? "演示已体验 · 未保存" : "今天已收好" : preview ? "体验收下这颗星" : "收下今天的星"}</button>
          {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" onClick={props.onRetry} disabled={busy || loading}>重新读取打卡</button></div>}
          {notice && <p className={styles.notice} role="status">{notice}</p>}
          <p className={styles.footnote}>{preview ? "这里只体验效果，不读取私人记录，也不会保存心情或天数。" : confirmed ? "今天的心情已经收好。明天再挂上一句新的话。" : "以北京时间记一天；每天一次，保存后计入天数。"}</p>
        </form>
      </div>}
    </div>
  </dialog>;
}
