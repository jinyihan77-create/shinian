"use client";

import { useRef, useState } from "react";
import { ArrowRight, Check, Flag, LoaderCircle, RotateCcw, Ticket } from "lucide-react";
import type { EchoNote } from "@/lib/types";
import { actionTicketCopy, taskStatus, type TaskAction } from "@/lib/task-tickets";
import type { TaskTransition } from "./pending-tickets";
import styles from "./pending-tickets.module.css";

export function TaskJourneyBar({ note, onTransition, blockedReason, preview = false }: { note: EchoNote; onTransition: TaskTransition; blockedReason?: string; preview?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const status = taskStatus(note);
  if (status === "none") return null;
  const copy = actionTicketCopy(note);
  const completed = status === "completed";
  const action: TaskAction = completed ? "reopen" : status === "active" ? "complete" : "start";
  async function transition() {
    if (lock.current || blockedReason) return;
    lock.current = true; setBusy(true); setError("");
    try { await onTransition(note, action); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "没有更新成功，请再试一次。"); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className={styles.journeyBar} data-status={status} data-completed={completed || undefined} aria-label="事项进度">
    <div className={styles.journeyCopy}><strong>{completed ? <Flag size={16} /> : <Ticket size={16} />}{completed ? "已完成" : status === "active" ? "进行中" : "行动票"}</strong><p>{blockedReason || (preview ? "演示进度仅在本次预览中有效，不会保存到账号。" : completed ? "这件事已经完成，可以回看，也可以再做一次。" : status === "active" ? copy.nextStep : `AI 从这条记录里听见：${copy.title}`)}</p></div>
    <button className="btn btn-secondary" disabled={busy || Boolean(blockedReason)} onClick={() => void transition()}>{busy ? <LoaderCircle size={15} className="spin" /> : completed ? <RotateCcw size={15} /> : status === "active" ? <Check size={15} /> : <ArrowRight size={15} />}{busy ? "正在确认…" : completed ? "再做一次" : status === "active" ? "完成" : "开始这一步"}</button>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
