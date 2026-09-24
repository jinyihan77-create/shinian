"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, AudioLines, BookOpen, Check, Headphones, Heart, Leaf, LoaderCircle, MessageCircle, MoonStar, Pause, Play, Search, SlidersHorizontal, Sparkles, Ticket, X } from "lucide-react";
import { searchNotes, type LibraryFilter } from "@/lib/search";
import { composeSpeechInput } from "@/lib/speech-input";
import type { DeletePlan, EchoNote } from "@/lib/types";
import BorderGlow from "./border-glow";
import DecayBackground from "./decay-background";
import styles from "./inspiration-collection.module.css";
import { FLASHCARD_TAG, paintingForNote } from "@/lib/art-flashcards";
import DepthCarousel from "./depth-carousel";
import { PendingTickets, type TaskTransition } from "./pending-tickets";
import { actionTicketCopy, taskStatus, ticketMeta, ticketPool, visibleTags, type TaskAction } from "@/lib/task-tickets";
import { DesktopScrollMemory } from "./desktop-scroll-memory";
import { captureKindFromTags } from "@/lib/note-context";
import { AiDeleteAssistant, type DeleteOutcome } from "./ai-delete-assistant";

interface CollectionProps {
  notes: EchoNote[];
  query: string;
  filter: LibraryFilter;
  tag: string;
  sort: "created" | "updated";
  onQuery: (value: string) => void;
  onFilter: (value: LibraryFilter) => void;
  onTag: (value: string) => void;
  onSort: (value: "created" | "updated") => void;
  onCreate: () => void;
  onOpen: (note: EchoNote) => void;
  onTransition?: TaskTransition;
  onDeletePlan?: (command: string) => Promise<DeletePlan>;
  onBulkDelete?: (notes: EchoNote[]) => Promise<DeleteOutcome>;
  deleteDisabled?: boolean;
  preview?: boolean;
}
type PoolView = "all" | "inbox" | "one_time" | "recurring" | "waiting" | "archive";

/** Shared by the private workspace and the explicitly labelled visual preview. */
export function InspirationCollection({ notes, query, filter, tag, sort, onQuery, onFilter, onTag, onSort, onCreate, onOpen, onTransition = async () => {}, onDeletePlan, onBulkDelete, deleteDisabled = false, preview = false }: CollectionProps) {
  const [motionPaused, setMotionPaused] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchListening, setSearchListening] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [drawn, setDrawn] = useState<EchoNote | null>(null);
  const [drawBusy, setDrawBusy] = useState<TaskAction | null>(null);
  const [poolView, setPoolView] = useState<PoolView>("all");
  const searchRecognition = useRef<{ stop: () => void } | null>(null);
  useEffect(() => {
    try { setMotionPaused(window.sessionStorage.getItem("shinian-card-motion") === "paused"); } catch { /* The visual preference is optional. */ }
  }, []);
  useEffect(() => () => { searchRecognition.current?.stop(); searchRecognition.current = null; }, []);
  function toggleMotion() {
    const next = !motionPaused;
    setMotionPaused(next);
    try { window.sessionStorage.setItem("shinian-card-motion", next ? "paused" : "playing"); } catch { /* Keep the current-page preference when storage is unavailable. */ }
  }
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(() => searchNotes(notes, deferredQuery, filter, tag, sort).filter(({ note }) => {
    if (poolView === "all") return true;
    if (poolView === "archive") return ticketPool(note) === "archive" || taskStatus(note) === "completed";
    return ticketPool(note) === poolView;
  }), [notes, deferredQuery, filter, tag, sort, poolView]);
  const tags = useMemo(() => [...new Set(notes.flatMap(note => visibleTags(note.tags)))].sort(), [notes]);
  const filters = useMemo<{ value: LibraryFilter; label: string; count: number }[]>(() => [
    { value: "all", label: "全部", count: notes.length },
    { value: "departure", label: "行动票", count: notes.filter(note => ["pending", "active"].includes(taskStatus(note))).length },
    { value: "arrival", label: "已完成", count: notes.filter(note => taskStatus(note) === "completed").length },
  ], [notes]);
  const flashcardCount = useMemo(() => notes.filter(note => note.tags.includes(FLASHCARD_TAG)).length, [notes]);
  const poolCounts = useMemo(() => ({
    inbox: notes.filter(note => ticketPool(note) === "inbox").length,
    one_time: notes.filter(note => ticketPool(note) === "one_time" && ["pending", "active"].includes(taskStatus(note))).length,
    recurring: notes.filter(note => ticketPool(note) === "recurring" && ["pending", "active"].includes(taskStatus(note))).length,
    waiting: notes.filter(note => ticketPool(note) === "waiting").length,
    archive: notes.filter(note => ticketPool(note) === "archive" || taskStatus(note) === "completed").length,
  }), [notes]);
  const filtered = Boolean(query.trim() || tag || filter !== "all");
  function reset() { onQuery(""); onFilter("all"); onTag(""); setPoolView("all"); }
  function selectView(next: "all" | "tasks" | "flashcards") {
    if (next === "all") { onFilter("all"); onTag(""); }
    if (next === "tasks") { onFilter(filter === "arrival" ? "arrival" : "departure"); onTag(""); }
    if (next === "flashcards") { onFilter("all"); onTag(FLASHCARD_TAG); }
  }
  const activeView = tag === FLASHCARD_TAG ? "flashcards" : filter === "departure" || filter === "arrival" ? "tasks" : "all";
  const filterCount = Number(Boolean(tag && tag !== FLASHCARD_TAG)) + Number(filter === "arrival") + Number(sort !== "created");
  const flashcards = results.filter(({ note }) => note.tags.includes(FLASHCARD_TAG));
  const actionPool = useMemo(() => notes.filter(note => ["pending", "active"].includes(taskStatus(note)) && ["one_time", "recurring"].includes(ticketPool(note))), [notes]);
  const allowCardSweep = !motionPaused && results.length <= 8;
  function toggleSearchVoice() {
    if (searchRecognition.current) { searchRecognition.current.stop(); return; }
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) { setSearchMessage("当前浏览器不支持语音搜索"); return; }
    const recognition = new Constructor();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = event => {
      const next = composeSpeechInput("", event.results);
      if (next) onQuery(next);
    };
    recognition.onerror = event => { setSearchListening(false); setSearchMessage(event.error === "not-allowed" ? "请允许麦克风权限后再试" : "没有听清，再说一次试试"); };
    recognition.onend = () => { setSearchListening(false); searchRecognition.current = null; };
    searchRecognition.current = recognition;
    setSearchMessage(preview ? "语音只用于本次预览搜索，不会保存" : "");
    try { recognition.start(); setSearchListening(true); } catch { searchRecognition.current = null; setSearchListening(false); setSearchMessage("语音搜索暂时无法启动"); }
  }
  function drawAction() {
    if (!actionPool.length) { setDrawn(null); return; }
    const weighted = actionPool.flatMap(note => {
      const meta = ticketMeta(note.tags);
      const resistanceWeight = meta.resistance === "low" ? 3 : meta.resistance === "medium" ? 2 : 1;
      const durationWeight = Math.max(1, 65 - meta.durationMinutes) / 20;
      return Array.from({ length: Math.max(1, Math.round(resistanceWeight * durationWeight)) }, () => note);
    });
    setDrawn(weighted[Math.floor(Math.random() * weighted.length)] || actionPool[0]);
  }
  async function drawnTransition(action: TaskAction) {
    if (!drawn || drawBusy) return;
    setDrawBusy(action);
    try { await onTransition(drawn, action); if (action === "complete" || action === "dismiss") setDrawn(null); }
    finally { setDrawBusy(null); }
  }

  return <section className={styles.collection} aria-labelledby="collection-title">
    <div className={styles.atmosphere} aria-hidden="true" />
    <header className={styles.heading}>
      <div><span className={styles.kicker}><span />拾起片刻，留给以后</span><h1 id="collection-title"><span className={styles.titleCn}>回声屿</span><span className={styles.titleEn}>ECHO ISLE</span></h1><p>你留下的念头，都在这里等你回来。</p></div>
    </header>

    <div className={styles.tools}>
      <div className={styles.search}>
        <Search size={19} aria-hidden="true" /><input aria-label="向过去的自己提问" placeholder="想问过去的自己什么？" value={query} onChange={event => onQuery(event.target.value)} />
        {query && <button aria-label="清空搜索" onClick={() => onQuery("")}><X size={17} /></button>}
        <button className={styles.voiceSearch} aria-label={searchListening ? "停止语音搜索" : "用语音搜索"} aria-pressed={searchListening} onClick={toggleSearchVoice}><AudioLines size={18} /><span className={styles.searchStrands} aria-hidden="true"><i /><i /><i /></span></button>
      </div>
      <div className={styles.cleanupAction}>
        <AiDeleteAssistant notes={notes} disabled={deleteDisabled} preview={preview} onPlan={onDeletePlan} onDelete={onBulkDelete} />
      </div>
      <button className={styles.drawAction} disabled={preview || !actionPool.length} onClick={drawAction} title={actionPool.length ? "从已确认的行动池抽一张" : "先确认一条行动建议"}><Ticket size={15} /><span>抽一张行动卡</span><b>{actionPool.length}</b></button>
      <button className={styles.filterTrigger} aria-expanded={filterOpen} onClick={() => setFilterOpen(value => !value)}><SlidersHorizontal size={16} /><span>筛选</span>{filterCount > 0 && <b>{filterCount}</b>}</button>
    </div>
    <div className={styles.filterRow}>
      <div className={styles.filters} role="group" aria-label="回声屿视图"><button aria-pressed={activeView === "all"} onClick={() => selectView("all")}>全部<span>{notes.length}</span></button><button aria-pressed={activeView === "tasks"} onClick={() => selectView("tasks")}>行动票<span>{filters[1].count}</span></button><button aria-pressed={activeView === "flashcards"} onClick={() => selectView("flashcards")}>闪卡<span>{flashcardCount}</span></button></div>
      <div className={styles.viewOptions}>
        <span className={styles.count}>{preview ? "演示内容 · " : ""}{filtered ? "找到 " : "共 "}{results.length} 条</span>
      </div>
    </div>
    <div className={styles.poolRail} aria-label="行动票根分区"><span className={styles.poolRailLabel}>行动分区</span><button aria-pressed={poolView === "inbox"} aria-label={`票根收集箱 ${poolCounts.inbox} 条`} onClick={() => { setPoolView("inbox"); onFilter("all"); onTag(""); }}>票根箱 <b>{poolCounts.inbox}</b></button><button aria-pressed={poolView === "one_time"} aria-label={`单次行动 ${poolCounts.one_time} 条`} onClick={() => { setPoolView("one_time"); onFilter("departure"); onTag(""); }}>单次 <b>{poolCounts.one_time}</b></button><button aria-pressed={poolView === "recurring"} aria-label={`周期行动 ${poolCounts.recurring} 条`} onClick={() => { setPoolView("recurring"); onFilter("departure"); onTag(""); }}>周期 <b>{poolCounts.recurring}</b></button><button aria-pressed={poolView === "waiting"} aria-label={`等待清单 ${poolCounts.waiting} 条`} onClick={() => { setPoolView("waiting"); onFilter("all"); onTag(""); }}>等待 <b>{poolCounts.waiting}</b></button><button aria-pressed={poolView === "archive"} aria-label={`归档 ${poolCounts.archive} 条`} onClick={() => { setPoolView("archive"); onFilter("arrival"); onTag(""); }}>归档 <b>{poolCounts.archive}</b></button></div>
    {searchMessage && <p className={styles.searchMessage} role="status">{searchMessage}</p>}
    {drawn && <div className={styles.drawnPanel} role="dialog" aria-label="抽到的行动卡"><div className={styles.drawnGlow} aria-hidden="true" /><div className={styles.drawnHeading}><span><Ticket size={15} />今天先做这一件</span><button aria-label="关闭抽卡" onClick={() => setDrawn(null)}><X size={15} /></button></div><h2>{actionTicketCopy(drawn).title}</h2><p>{actionTicketCopy(drawn).nextStep}</p><small>{ticketPool(drawn) === "recurring" ? "周期行动" : "单次行动"} · {ticketMeta(drawn.tags).durationMinutes} 分钟 · {ticketMeta(drawn.tags).resistance === "low" ? "低阻力" : ticketMeta(drawn.tags).resistance === "high" ? "高阻力" : "中等阻力"}</small><div className={styles.drawnActions}>{taskStatus(drawn) === "pending" && <button className="btn btn-primary" disabled={Boolean(drawBusy)} onClick={() => void drawnTransition("start")}>{drawBusy === "start" ? <LoaderCircle className="spin" size={14} /> : <ArrowRight size={14} />}开始这一步</button>}{taskStatus(drawn) === "active" && <button className="btn btn-primary" disabled={Boolean(drawBusy)} onClick={() => void drawnTransition("complete")}>{drawBusy === "complete" ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}标记完成</button>}<button className="btn btn-secondary" disabled={Boolean(drawBusy)} onClick={() => setDrawn(null)}>跳过</button>{taskStatus(drawn) === "pending" && <button className="btn btn-ghost" disabled={Boolean(drawBusy)} onClick={() => void drawnTransition("dismiss")}>作废</button>}<button className="btn btn-ghost" disabled={Boolean(drawBusy)} onClick={() => { setDrawn(null); window.setTimeout(drawAction, 0); }}>再抽一张</button></div></div>}
    {filterOpen && <div className={styles.filterDrawer} aria-label="更多筛选">
      <div className={styles.drawerHeader}><div><strong>马上找到</strong><span>先看状态；主题需要时再展开。</span></div><button aria-label="关闭筛选" onClick={() => setFilterOpen(false)}><X size={16} /></button></div>
      <div className={styles.drawerSection}><span className={styles.drawerLabel}>补充查看</span><div className={styles.drawerChips} role="group" aria-label="补充状态筛选"><button aria-pressed={filter === "arrival"} onClick={() => onFilter("arrival")}>已完成 <em>{filters[2].count}</em></button></div></div>
      {tags.length > 0 && <details className={styles.themeDetails}><summary>按主题查找 <span>{tags.length}</span></summary><div className={styles.drawerChips} role="group" aria-label="按主题筛选"><button aria-pressed={!tag || tag === FLASHCARD_TAG} onClick={() => onTag("")}>所有主题</button>{tags.map(item => <button key={item} aria-pressed={tag === item} onClick={() => onTag(tag === item ? "" : item)}># {item}</button>)}</div></details>}
      <div className={styles.drawerFooter}><label className={styles.sort}><span>排序</span><select value={sort} onChange={event => onSort(event.target.value as CollectionProps["sort"])}><option value="created">最新记下</option><option value="updated">最近修改</option></select></label><button className={styles.motionToggle} onClick={toggleMotion} aria-label={motionPaused ? "播放卡片背景" : "暂停卡片背景"}>{motionPaused ? <Play size={13} /> : <Pause size={13} />}<span>{motionPaused ? "播放背景" : "动态背景"}</span></button><button className={styles.clearFilters} onClick={reset}>清除筛选</button></div>
    </div>}

    {results.length ? tag === FLASHCARD_TAG ?
      <section className={styles.showcase} aria-labelledby="flashcard-showcase-title">
        <div className={styles.showcaseHeader}><div><span className={styles.showcaseKicker}>SHINIAN · MY OWN WORDS</span><h2 id="flashcard-showcase-title">闪卡橱窗</h2><p>轻轻拖动，重读一次自己的理解。</p></div><span className={styles.showcaseCount}>{flashcards.length} 张收藏</span></div>
        <DepthCarousel
          items={flashcards.map(({ note }) => { const painting = paintingForNote(note.id); return { image: `/artworks/${painting.id}-2400.webp`, alt: `${painting.title}，闪卡封面` }; })}
          cardWidth={224}
          cardHeight={286}
          spread={68}
          depth={170}
          tilt={13}
          renderCard={(item, index, isActive) => { const note = flashcards[index]?.note; const painting = note ? paintingForNote(note.id) : null; return <div className={`${styles.showcaseCard} ${isActive ? styles.showcaseCardActive : ""}`}><img src={item.image} alt="" draggable={false} /><span className={styles.showcaseShade} /><div className={styles.showcaseCopy}><span>MY OWN WORDS · {String(index + 1).padStart(2, "0")}</span><h3>{note?.title || "一张留给未来的闪卡"}</h3><p>{note?.reflectionText?.trim() || "还没有写下自己的理解。"}</p><small>{painting?.title} · {painting?.artist}</small></div></div>; }}
        />
      </section>
    : filter === "departure" || filter === "arrival" ? <PendingTickets notes={results.map(({ note }) => note)} kind={filter} preview={preview} paused={motionPaused} onOpen={onOpen} onTransition={onTransition} /> : <div className={styles.grid}>{results.map(({ note, snippet, matchedField }) => <NoteCard key={note.id} note={note} motionPaused={motionPaused} animated={allowCardSweep} onOpen={() => onOpen(note)} snippet={deferredQuery.trim() ? snippet : undefined} matchedField={deferredQuery.trim() ? matchedField : undefined} />)}</div>
      : <div className={styles.empty}><Sparkles size={30} strokeWidth={1.2} /><h2>{tag === FLASHCARD_TAG ? "这里等着你的第一张闪卡" : filter === "arrival" && !query && !tag ? "还没有完成的行动" : filter === "departure" && !query && !tag && notes.length ? "还没有行动票" : notes.length ? "还没找到这段回响" : "从一句话开始"}</h2><p>{tag === FLASHCARD_TAG ? "在一条记录里写下自己的理解，再收藏成闪卡。" : filter === "arrival" && !query && !tag ? "一件事被你标记完成后，会安静地留在这里。" : filter === "departure" && !query && !tag && notes.length ? "说出“我想做……”或“记得去……”，拾念会替你提炼最小的一步。" : notes.length ? "换一种说法，或者直接用语音问问过去的自己。" : "一句想法、一段听后感，都可以留在这里。"}</p><button className={styles.create} onClick={filter === "arrival" && !query && !tag ? () => onFilter("departure") : filter === "departure" && !query && !tag ? onCreate : notes.length ? reset : onCreate}>{filter === "arrival" && !query && !tag ? "查看行动票" : filter === "departure" && !query && !tag ? "回去说一句" : notes.length ? tag === FLASHCARD_TAG ? "查看全部" : "清除筛选" : "留下第一句话"}<ArrowUpRight size={17} /></button></div>}
    {!filtered && activeView === "all" && notes.length > 0 && <DesktopScrollMemory note={notes[notes.length - 1]} onOpen={() => onOpen(notes[notes.length - 1])} />}
  </section>;
}

const palettes = [
  ["#c77ba6", "#8c6e9e", "#f1c3d4"],
  ["#9b83c3", "#d49db9", "#ead4e8"],
  ["#6f80bd", "#be8ebf", "#e5d9f2"],
];
export function NoteCard({ note, onOpen, snippet, matchedField, motionPaused = false, animated = true }: { note: EchoNote; onOpen: () => void; snippet?: string; matchedField?: string; motionPaused?: boolean; animated?: boolean }) {
  const seed = [...note.id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  const palette = palettes[note.sourceType === "播客" ? 0 : note.sourceType === "文章" ? 1 : 2];
  const glowColor = note.sourceType === "播客" ? "326 54 72" : note.sourceType === "文章" ? "284 42 72" : "234 40 72";
  const SourceIcon = note.sourceType === "播客" ? Headphones : note.sourceType === "生活" ? Leaf : BookOpen;
  const text = snippet || note.userText || note.sourceExcerpt || note.sourceName || "已经留好出处，随时补充你的想法。";
  const status = note.aiStatus === "done" ? "已整理" : note.aiStatus === "processing" ? "整理中" : note.aiStatus === "error" ? "整理失败 · 可重试" : note.aiStatus === "outdated" ? "整理待更新" : "待整理";
  const date = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(note.createdAt));
  const captureKind = captureKindFromTags(note.tags);
  return <BorderGlow className={styles.cardFrame} style={{ "--card-glow": `${palette[0]}66` } as CSSProperties} edgeSensitivity={22} glowColor={glowColor} backgroundColor="#120F17" backgroundOpacity={0.16} borderRadius={28} glowRadius={36} glowIntensity={1.2} coneSpread={25} animated={animated} colors={palette} fillOpacity={0.3}>
    <button className={styles.card} style={{ "--card-accent": palette[0], "--card-secondary": palette[1] } as CSSProperties} onClick={onOpen} aria-label={`打开念头：${note.title}`}>
      <DecayBackground colors={palette} seed={seed} paused={motionPaused} className={styles.cardVisual} />
      <span className={styles.cardVeil} aria-hidden="true" />
      <span className={styles.cardMeta}><span className={styles.source}><SourceIcon size={17} strokeWidth={1.6} />{note.sourceType}</span>{captureKind !== "thought" && <span className={styles.context}>{captureKind === "relationship" ? <Heart size={12} /> : <MoonStar size={12} />}{captureKind === "relationship" ? "和 TA" : "今日片刻"}</span>}{note.isExample && <span className={styles.demo}>演示资料</span>}<ArrowUpRight className={styles.openArrow} size={19} /></span>
      <span className={styles.cardTitle}>{note.title}</span>
      <span className={styles.excerpt}>{matchedField && <span className={styles.match}>{matchedField} · </span>}{text}</span>
      <span className={styles.cardTags}>{visibleTags(note.tags).slice(0, 3).map(item => <span key={item}># {item}</span>)}</span>
      <span className={styles.cardBottom}><time dateTime={note.createdAt}>{date}</time><span className={styles.status}>{note.reflectionText.trim() && <MessageCircle size={13} aria-label="已有自己的理解" />}<span>{status}</span></span></span>
    </button>
  </BorderGlow>;
}
