"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, Check, Flag, LoaderCircle, RotateCcw, Ticket, X } from "lucide-react";
import type { EchoNote } from "@/lib/types";
import { actionTicketCopy, taskStatus, ticketNumber, type TaskAction } from "@/lib/task-tickets";
import TearTicket from "./tear-ticket";
import styles from "./pending-tickets.module.css";

export type TicketKind = "departure" | "arrival";
export type TaskTransition = (note: EchoNote, action: TaskAction) => Promise<void>;

export function orderTicketsByProgress(notes: EchoNote[], kind: TicketKind): EchoNote[] {
  if (kind === "arrival") return notes;
  return notes
    .map((note, index) => ({
      note,
      index,
      rank: taskStatus(note) === "pending" ? 0 : 1,
      handledAt: Date.parse(note.updatedAt),
    }))
    .sort((first, second) => {
      if (first.rank !== second.rank) return first.rank - second.rank;
      if (first.rank === 1 && Number.isFinite(first.handledAt) && Number.isFinite(second.handledAt) && first.handledAt !== second.handledAt) {
        return first.handledAt - second.handledAt;
      }
      return first.index - second.index;
    })
    .map(({ note }) => note);
}

export function PendingTickets({ notes, kind, preview, paused, onOpen, onTransition }: {
  notes: EchoNote[]; kind: TicketKind; preview: boolean; paused: boolean; onOpen: (note: EchoNote) => void; onTransition: TaskTransition;
}) {
  const completed = kind === "arrival";
  const orderedNotes = orderTicketsByProgress(notes, kind);
  return <div className={styles.section}>
    <div className={styles.intro}><Ticket size={18} aria-hidden="true" /><div><h2>{completed ? "这些事情，已经被你做到了" : "从一句话里，长出一个下一步"}</h2><p>{completed ? "完成的行动会留下盖章票，想回看时再打开。" : "只有明确想做的事才会来到这里。撕下票根，就从最小一步开始。"}</p></div></div>
    <div className={styles.grid}>{orderedNotes.map(note => <PendingTicket key={`${kind}:${note.id}`} note={note} preview={preview} paused={paused} onOpen={() => onOpen(note)} onTransition={onTransition} />)}</div>
    <p className={styles.footnote}>{preview ? "演示行动票 · 状态仅在本次预览中变化，刷新后恢复。" : "普通感想不会来到这里；只有你明确完成，这张票才会盖章。"}</p>
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
    const measure = () => setWidth(Math.max(300, Math.floor(el.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const state = taskStatus(note);
  const completed = state === "completed";
  const copy = actionTicketCopy(note);
  const compact = width < 430;
  const palettes = [
    { accent: "#f1a8c9", surface: "rgba(44, 25, 39, .88)", foil: "#a8dff1", ink: "#ffd9e9" },
    { accent: "#9fc9ee", surface: "rgba(22, 31, 49, .9)", foil: "#e2b4da", ink: "#d5ecff" },
    { accent: "#9ed9ca", surface: "rgba(20, 39, 39, .88)", foil: "#d9c6ff", ink: "#d8fff3" },
    { accent: "#e4c68e", surface: "rgba(44, 34, 25, .9)", foil: "#edaec8", ink: "#fff0ca" },
    { accent: "#cab2ee", surface: "rgba(35, 27, 49, .9)", foil: "#93dce7", ink: "#eee1ff" },
  ];
  const paletteSeed = [...note.id].reduce((total, character) => total + character.charCodeAt(0), 0);
  const palette = palettes[paletteSeed % palettes.length];
  const accent = palette.accent;
  const action = completed ? "回看记录" : state === "active" ? "继续" : "开始这一步";
  const stateLabel = completed ? "已完成" : state === "active" ? "进行中" : "想做";
  const question = completed ? "这件事，后来为你带来了什么？" : state === "active" ? copy.nextStep : `第一步：${copy.nextStep}`;
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
  return <article ref={root} className={styles.entry} data-state={state} style={{ "--ticket-accent": accent, "--ticket-foil": palette.foil, "--ticket-ink": palette.ink } as CSSProperties} aria-label={`${stateLabel}：${copy.title}`} aria-busy={busy}>
    <TearTicket key={visit} width={width} height={compact ? 202 : 256} stubSize={compact ? Math.max(82, Math.min(94, Math.floor(width * .27))) : 116}
      orientation="horizontal" rotate={0} tilt={!paused && !busy} tiltMax={3} tiltReach={70}
      radius={18} holes={compact ? 9 : 11} holeSize={5} notch={4} roughness={0.45}
      tearAngle={26} stretch={22} resistance={0.45} recenter={false} disabled={busy}
      background={palette.surface} stubBackground={accent} color="#f5eff9"
      borderColor="rgba(236, 224, 242, .3)" onTear={() => void open()} ariaLabel={`拖动票根，${action}：${copy.title}`}
      stub={<div className={styles.stub} data-compact={compact || undefined}>
        <span className={styles.stubStatus}>{stateLabel}</span>
        <div className={styles.stubAction}>{busy ? <LoaderCircle className="spin" size={25} /> : completed ? <Flag size={25} strokeWidth={1.2} /> : <ArrowRight size={25} strokeWidth={1.2} />}<strong>{completed ? "回看" : state === "active" ? "继续" : "开始"}</strong><span>{busy ? "正在确认…" : "轻触票根"}</span></div>
        <span className={styles.serial}>NO. {ticketNumber(note.id)}</span>
      </div>}>
      <div className={styles.body}>
        <div className={styles.meta}><span>{date}</span>{(preview || note.isExample) && <span className={styles.demo}>演示</span>}</div>
        <div className={styles.ticketHeading}><span>{stateLabel}</span>{completed && <span className={styles.stamp}><Check size={12} />完成</span>}</div>
        <h3 className={styles.title} title={copy.title}>{copy.title}</h3>
        <p className={styles.question}>{question}</p>
        <div className={styles.route} aria-hidden="true"><i /><span /><ArrowRight size={15} /><span /><i data-arrived={completed || undefined} /></div>
      </div>
    </TearTicket>
    <div className={styles.actions}>
      {completed && <button disabled={busy} onClick={() => void transition("reopen")} aria-label={`再做一次：${copy.title}`}><RotateCcw size={13} />再做一次</button>}
      {state === "pending" && <button className={styles.dismiss} disabled={busy} onClick={() => void transition("dismiss")} aria-label={`这只是想法：${copy.title}`}><X size={13} />这只是想法</button>}
      <div><button className={styles.openAction} disabled={busy} onClick={() => void open()} aria-label={`${action}：${copy.title}`}>{busy ? "正在确认…" : action}<ArrowUpRight size={15} /></button>{state === "active" && <button className={styles.complete} disabled={busy} onClick={() => void transition("complete")} aria-label={`标记完成：${copy.title}`}><Check size={15} />完成</button>}</div>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </article>;
}
