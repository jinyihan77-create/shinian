"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, Check, Flag, LoaderCircle, RotateCcw, Ticket } from "lucide-react";
import type { EchoNote } from "@/lib/types";
import { taskLabels, taskStatus, ticketNumber, type TaskAction } from "@/lib/task-tickets";
import TearTicket from "./tear-ticket";
import styles from "./pending-tickets.module.css";

export type TicketKind = "departure" | "arrival";
export type TaskTransition = (note: EchoNote, action: TaskAction) => Promise<void>;

export function PendingTickets({ notes, kind, preview, paused, onOpen, onTransition }: {
  notes: EchoNote[]; kind: TicketKind; preview: boolean; paused: boolean; onOpen: (note: EchoNote) => void; onTransition: TaskTransition;
}) {
  const completed = kind === "arrival";
  return <div className={styles.section}>
    <div className={styles.intro}><Ticket size={18} aria-hidden="true" /><div><h2>{completed ? "终点票 · 已完成" : "启程票 · 待办事项"}</h2><p>{completed ? "每一张终点票，都是你亲手完成的一件事。" : "选一件事启程，做完后收下一张终点票。"}</p></div></div>
    <div className={styles.grid}>{notes.map(note => <PendingTicket key={`${kind}:${note.id}`} note={note} preview={preview} paused={paused} onOpen={() => onOpen(note)} onTransition={onTransition} />)}</div>
    <p className={styles.footnote}>{preview ? "演示票根 · 状态仅在本次预览中变化，刷新后恢复。" : "由你确认完成后，事项才会移入终点票。"}</p>
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
  const vertical = width < 400;
  const accent = completed ? "#b7d7cd" : "#d4c2ea";
  const action = completed ? "回看事项" : state === "active" ? "继续这件事" : "启程 · 开始做";
  const date = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(note.createdAt));
  async function transition(next: TaskAction) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await onTransition(note, next); }
    catch (err) { setError(err instanceof Error ? err.message : "事项状态尚未保存，请重试。"); }
    finally { lock.current = false; setBusy(false); setVisit(value => value + 1); }
  }
  function open() {
    if (lock.current) return;
    if (state === "pending") { void transition("start"); return; }
    setVisit(value => value + 1); onOpen();
  }
  return <article ref={root} className={styles.entry} data-state={state} style={{ "--ticket-accent": accent } as CSSProperties} aria-label={`${completed ? "终点票" : "启程票"}：${note.title}`} aria-busy={busy}>
    <TearTicket key={visit} width={width} height={vertical ? 360 : 286} stubSize={vertical ? 82 : 116}
      orientation={vertical ? "vertical" : "horizontal"} rotate={0} tilt={!paused && !busy} tiltMax={3} tiltReach={70}
      radius={18} holes={vertical ? 12 : 11} holeSize={5} notch={4} roughness={0.45}
      tearAngle={26} stretch={22} resistance={0.45} recenter={false} disabled={busy}
      background="rgba(25, 22, 35, .72)" stubBackground={accent} color="#f5eff9"
      borderColor="rgba(220, 206, 231, .24)" onTear={open} ariaLabel={`撕开票根，${action}：${note.title}`}
      stub={<div className={styles.stub} data-vertical={vertical || undefined}>
        <span className={styles.stubStatus}>{taskLabels[state]}</span>
        <div className={styles.stubAction}>{busy ? <LoaderCircle className="spin" size={25} /> : completed ? <Flag size={25} strokeWidth={1.2} /> : <ArrowRight size={25} strokeWidth={1.2} />}<strong>{completed ? "抵达终点" : state === "active" ? "正在路上" : "现在启程"}</strong><span>{busy ? "正在确认…" : completed ? "撕开回看" : state === "active" ? "撕开继续" : "撕开开始"}</span></div>
        <span className={styles.serial}>NO. {ticketNumber(note.id)}</span>
      </div>}>
      <div className={styles.body}>
        <div className={styles.meta}><span>{note.sourceType} · 记录于 {date}</span>{(preview || note.isExample) && <span className={styles.demo}>演示票根</span>}</div>
        <div className={styles.ticketHeading}><span>{completed ? "终点票" : "启程票"}</span><small>{completed ? "ARRIVAL" : "DEPARTURE"}</small>{completed && <span className={styles.stamp}><Check size={12} />已完成</span>}</div>
        <h3 className={styles.title} title={note.title}>{note.title}</h3>
        <p className={styles.excerpt}>{note.userText || note.sourceExcerpt || "给这件事留一点时间。"}</p>
        <div className={styles.route} aria-hidden="true"><i /><span /><ArrowRight size={15} /><span /><i data-arrived={completed || undefined} /></div>
        <div className={styles.routeLabels}><span>一个念头</span><span>{completed ? "一件已完成的事" : "下一步，行动"}</span></div>
      </div>
    </TearTicket>
    <div className={styles.actions}>
      {completed ? <button disabled={busy} onClick={() => void transition("reopen")} aria-label={`重新启程：${note.title}`}><RotateCcw size={13} />重新启程</button> : <span>{state === "active" ? "已经启程，按自己的节奏来" : "从一件小事开始"}</span>}
      <div><button disabled={busy} onClick={open} aria-label={`${action}：${note.title}`}>{busy ? "正在确认…" : action}<ArrowUpRight size={15} /></button>{state === "active" && <button className={styles.complete} disabled={busy} onClick={() => void transition("complete")} aria-label={`完成，收下终点票：${note.title}`}><Check size={15} />收下终点票</button>}</div>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </article>;
}
