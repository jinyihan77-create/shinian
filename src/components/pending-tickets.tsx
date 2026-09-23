"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, Check, Flag, LoaderCircle, RotateCcw, Ticket } from "lucide-react";
import type { EchoNote } from "@/lib/types";
import { taskStatus, ticketNumber, type TaskAction } from "@/lib/task-tickets";
import TearTicket from "./tear-ticket";
import styles from "./pending-tickets.module.css";

export type TicketKind = "departure" | "arrival";
export type TaskTransition = (note: EchoNote, action: TaskAction) => Promise<void>;

export function orderTicketsByProgress(notes: EchoNote[], kind: TicketKind): EchoNote[] {
  if (kind === "arrival") return notes;
  return notes
    .map((note, index) => ({ note, index, rank: taskStatus(note) === "pending" ? 0 : 1 }))
    .sort((first, second) => first.rank - second.rank || first.index - second.index)
    .map(({ note }) => note);
}

export function PendingTickets({ notes, kind, preview, paused, onOpen, onTransition }: {
  notes: EchoNote[]; kind: TicketKind; preview: boolean; paused: boolean; onOpen: (note: EchoNote) => void; onTransition: TaskTransition;
}) {
  const completed = kind === "arrival";
  const orderedNotes = orderTicketsByProgress(notes, kind);
  return <div className={styles.section}>
    <div className={styles.intro}><Ticket size={18} aria-hidden="true" /><div><h2>{completed ? "哪些事情，已经被你做到了？" : "今晚，想先推进哪一件？"}</h2><p>{completed ? "完成的事留在这里，想回看时再打开。" : "点开一张票，从今天愿意完成的一小步开始。"}</p></div></div>
    <div className={styles.grid}>{orderedNotes.map(note => <PendingTicket key={`${kind}:${note.id}`} note={note} preview={preview} paused={paused} onOpen={() => onOpen(note)} onTransition={onTransition} />)}</div>
    <p className={styles.footnote}>{preview ? "演示票根 · 状态仅在本次预览中变化，刷新后恢复。" : "只有你明确点击“标记完成”，这件事才会进入已完成。"}</p>
  </div>;
}

function PendingTicket({ note, preview, paused, onOpen, onTransition }: {
  note: EchoNote; preview: boolean; paused: boolean; onOpen: () => void; onTransition: TaskTransition;
}) {
  const root = useRef<HTMLElement>(null);
  const lock = useRef(false);
  const [width, setWidth] = useState(460);
  const [visit, setVisit] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.floor(el.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const state = taskStatus(note);
  const completed = state === "completed";
  const compact = width < 430;
  const palettes = [
    { accent: "#d9a6ba", surface: "rgba(48, 31, 43, .78)" },
    { accent: "#9fb9dc", surface: "rgba(27, 35, 52, .78)" },
    { accent: "#a8c8bb", surface: "rgba(27, 43, 41, .78)" },
    { accent: "#d6bd8f", surface: "rgba(49, 40, 31, .78)" },
    { accent: "#c9b7d4", surface: "rgba(39, 31, 47, .78)" },
  ];
  const paletteSeed = [...note.id].reduce((total, character) => total + character.charCodeAt(0), 0);
  const palette = palettes[paletteSeed % palettes.length];
  const accent = palette.accent;
  const action = completed ? "回看记录" : state === "active" ? "打开记录" : "开始并打开";
  const stateLabel = completed ? "已完成" : state === "active" ? "进行中" : "待开始";
  const question = completed ? "这件事，后来为你带来了什么？" : state === "active" ? "今天还想把它往前推一点吗？" : "愿意从哪一个最小动作开始？";
  const date = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(note.createdAt));
  async function transition(next: TaskAction) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError("");
    try { await onTransition(note, next); return true; }
    catch (err) { setError(err instanceof Error ? err.message : "事项状态尚未保存，请重试。"); return false; }
    finally { lock.current = false; setBusy(false); setVisit(value => value + 1); }
  }
  async function open() {
    if (lock.current) return;
    if (state === "pending") { if (await transition("start")) onOpen(); return; }
    setVisit(value => value + 1); onOpen();
  }
  return <article ref={root} className={styles.entry} data-state={state} style={{ "--ticket-accent": accent } as CSSProperties} aria-label={`${stateLabel}：${note.title}`} aria-busy={busy}>
    <TearTicket key={visit} width={width} height={compact ? 220 : 256} stubSize={compact ? Math.max(84, Math.min(96, Math.floor(width * .27))) : 116}
      orientation="horizontal" rotate={0} tilt={!paused && !busy} tiltMax={3} tiltReach={70}
      radius={18} holes={compact ? 9 : 11} holeSize={5} notch={4} roughness={0.45}
      tearAngle={26} stretch={22} resistance={0.45} recenter={false} disabled={busy}
      background={palette.surface} stubBackground={accent} color="#f5eff9"
      borderColor="rgba(220, 206, 231, .24)" onTear={() => void open()} ariaLabel={`拖动票根，${action}：${note.title}`}
      stub={<div className={styles.stub} data-compact={compact || undefined}>
        <span className={styles.stubStatus}>{stateLabel}</span>
        <div className={styles.stubAction}>{busy ? <LoaderCircle className="spin" size={25} /> : completed ? <Flag size={25} strokeWidth={1.2} /> : <ArrowRight size={25} strokeWidth={1.2} />}<strong>{completed ? "想回看吗？" : state === "active" ? "继续一点？" : "现在开始？"}</strong><span>{busy ? "正在确认…" : "轻触打开"}</span></div>
        <span className={styles.serial}>NO. {ticketNumber(note.id)}</span>
      </div>}>
      <div className={styles.body}>
        <div className={styles.meta}><span>{date}</span>{(preview || note.isExample) && <span className={styles.demo}>演示</span>}</div>
        <div className={styles.ticketHeading}><span>{stateLabel}</span>{completed && <span className={styles.stamp}><Check size={12} />完成</span>}</div>
        <h3 className={styles.title} title={note.title}>{note.title}</h3>
        <p className={styles.question}>{question}</p>
        <div className={styles.route} aria-hidden="true"><i /><span /><ArrowRight size={15} /><span /><i data-arrived={completed || undefined} /></div>
      </div>
    </TearTicket>
    <div className={styles.actions}>
      {completed && <button disabled={busy} onClick={() => void transition("reopen")} aria-label={`重新列入待办：${note.title}`}><RotateCcw size={13} />重新列入待办</button>}
      <div><button className={styles.openAction} disabled={busy} onClick={() => void open()} aria-label={`${action}：${note.title}`}>{busy ? "正在确认…" : action}<ArrowUpRight size={15} /></button>{state === "active" && <button className={styles.complete} disabled={busy} onClick={() => void transition("complete")} aria-label={`标记完成：${note.title}`}><Check size={15} />标记完成</button>}</div>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </article>;
}
