"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Check, LoaderCircle, Sparkles, Trash2, X } from "lucide-react";
import { composeSpeechInput } from "@/lib/speech-input";
import type { DeletePlan, EchoNote } from "@/lib/types";
import styles from "./ai-delete-assistant.module.css";

export interface DeleteOutcome {
  deletedIds: string[];
  failed: { id: string; message: string }[];
}

interface AiDeleteAssistantProps {
  notes: EchoNote[];
  disabled?: boolean;
  preview?: boolean;
  onPlan?: (command: string) => Promise<DeletePlan>;
  onDelete?: (notes: EchoNote[]) => Promise<DeleteOutcome>;
}

function previewPlan(notes: EchoNote[], command: string): DeletePlan {
  const words = command.replace(/请|帮我|删除|删掉|清理|卡片|词条|记录|关于|的/g, " ").split(/\s+/).filter(Boolean);
  const matches = notes.filter(note => {
    const text = `${note.title} ${note.tags.join(" ")} ${note.sourceType} ${note.sourceName} ${note.userText}`;
    return words.length ? words.some(word => text.includes(word)) : false;
  }).slice(0, 3);
  const fallback = matches.length ? matches : notes.slice(0, Math.min(2, notes.length));
  return {
    interpretation: matches.length ? `演示：查找与“${words.join("、")}”有关的记录。` : "演示：这里会呈现 AI 找到的候选记录。",
    matches: fallback.map(note => ({ id: note.id, reason: matches.length ? "演示内容中包含你说出的线索。" : "这是一条用于展示核对流程的演示候选。" })),
  };
}

export function AiDeleteAssistant({ notes, disabled = false, preview = false, onPlan, onDelete }: AiDeleteAssistantProps) {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [plan, setPlan] = useState<DeletePlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [planning, setPlanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState("");
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const speechBase = useRef("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const candidates = useMemo(() => {
    const byId = new Map(notes.map(note => [note.id, note]));
    return (plan?.matches ?? []).flatMap(match => {
      const note = byId.get(match.id);
      return note ? [{ note, reason: match.reason }] : [];
    });
  }, [notes, plan]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.dataset.aiCleanupOpen = "true";
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !deleting) setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
      delete document.body.dataset.aiCleanupOpen;
    };
  }, [open, deleting]);

  useEffect(() => () => { recognitionRef.current?.stop(); recognitionRef.current = null; }, []);

  function close() {
    if (deleting) return;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setOpen(false);
    setPlan(null);
    setSelected(new Set());
    setError("");
    setFinished("");
  }

  function toggleVoice() {
    if (recognitionRef.current) { recognitionRef.current.stop(); return; }
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) { setError("当前浏览器不支持语音输入，可以直接打字告诉 AI。"); return; }
    const recognition = new Constructor();
    speechBase.current = command.trim() ? `${command.trim()} ` : "";
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = event => setCommand(composeSpeechInput(speechBase.current, event.results));
    recognition.onerror = event => {
      setListening(false);
      setError(event.error === "not-allowed" ? "请允许麦克风权限后再试。" : "这次没有听清，可以再说一次。");
    };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; };
    recognitionRef.current = recognition;
    setError("");
    try { recognition.start(); setListening(true); }
    catch { recognitionRef.current = null; setListening(false); setError("语音暂时无法启动，可以先打字告诉 AI。"); }
  }

  async function makePlan(event?: React.FormEvent) {
    event?.preventDefault();
    const value = command.trim();
    if (value.length < 2) { setError("请说清楚想删除哪类记录。"); return; }
    setPlanning(true); setError(""); setFinished(""); setPlan(null); setSelected(new Set());
    try {
      const next = preview ? previewPlan(notes, value) : await onPlan?.(value);
      if (!next) throw new Error("AI 清理功能暂时不可用。");
      setPlan(next);
      setSelected(new Set(next.matches.map(match => match.id)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 暂时没有生成清理清单，没有删除任何内容。");
    } finally { setPlanning(false); }
  }

  function toggle(id: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function confirmDelete() {
    const targets = candidates.filter(candidate => selected.has(candidate.note.id)).map(candidate => candidate.note);
    if (!targets.length) { setError("还没有选中要删除的记录。"); return; }
    if (preview) {
      setFinished(`这是界面预览：已演示确认 ${targets.length} 条，但没有调用 AI，也没有删除资料。`);
      setPlan(null); setSelected(new Set()); return;
    }
    if (!onDelete) { setError("删除功能暂时不可用，没有删除任何内容。"); return; }
    setDeleting(true); setError("");
    try {
      const outcome = await onDelete(targets);
      if (outcome.failed.length) {
        const failedIds = new Set(outcome.failed.map(item => item.id));
        setPlan(current => current ? { ...current, matches: current.matches.filter(match => failedIds.has(match.id)) } : current);
        setSelected(failedIds);
        setError(`${outcome.deletedIds.length ? `已删除 ${outcome.deletedIds.length} 条；` : ""}${outcome.failed.length} 条因刚刚被修改或网络中断而保留。请核对后再试。`);
      } else {
        setFinished(`已从回声屿删除 ${outcome.deletedIds.length} 条记录。`);
        setPlan(null); setSelected(new Set());
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除没有完成，请刷新后核对。");
    } finally { setDeleting(false); }
  }

  return <>
    <button className={styles.trigger} disabled={disabled || !notes.length} onClick={() => setOpen(true)} title={notes.length ? "用一句话批量整理不需要的记录" : "还没有可以清理的记录"}>
      <Sparkles size={15} /><span>AI 清理</span>
    </button>
    {open && <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="ai-delete-title">
        <div className={styles.glow} aria-hidden="true" />
        <header className={styles.header}>
          <div className={styles.mark}><Sparkles size={18} /></div>
          <div><span>AI CLEANUP</span><h2 id="ai-delete-title">告诉我，想清理哪些？</h2></div>
          <button className={styles.close} aria-label="关闭 AI 清理" onClick={close} disabled={deleting}><X size={18} /></button>
        </header>

        {finished ? <div className={styles.finished}><span><Check size={22} /></span><p>{finished}</p><button onClick={close}>完成</button></div> : <>
          <form className={styles.command} onSubmit={event => void makePlan(event)}>
            <label htmlFor="delete-command">说一句自然的话就好</label>
            <div className={styles.inputShell}>
              <textarea ref={inputRef} id="delete-command" value={command} maxLength={500} rows={3} disabled={planning || deleting}
                placeholder="例如：删掉上个月关于拖延的记录" onChange={event => { setCommand(event.target.value); setPlan(null); setSelected(new Set()); setError(""); }} />
              <div className={styles.inputActions}>
                <button type="button" className={styles.voice} aria-label={listening ? "停止语音输入" : "用语音告诉 AI"} aria-pressed={listening} onClick={toggleVoice} disabled={planning || deleting}>
                  <AudioLines size={19} /><span>{listening ? "正在听" : "直接说"}</span><i className={styles.strands} aria-hidden="true"><b /><b /><b /></i>
                </button>
                {!plan && <button type="submit" className={styles.planButton} title="先找出候选记录，确认后才会删除" disabled={planning || deleting || command.trim().length < 2}>
                  {planning ? <LoaderCircle className={styles.spin} size={17} /> : <Sparkles size={16} />}{planning ? "正在查找…" : "开始清理"}
                </button>}
              </div>
            </div>
            {preview && <p className={styles.previewNote}>界面预览只演示核对流程，不会调用 AI 或删除资料。</p>}
          </form>

          {plan && <div className={styles.review}>
            <div className={styles.interpretation}><span>AI 理解为</span><p>{plan.interpretation}</p></div>
            {candidates.length ? <>
              <div className={styles.reviewTop}><strong>删除前再看一眼</strong><span>已选 {selected.size} / {candidates.length}</span></div>
              <div className={styles.candidates}>
                {candidates.map(({ note, reason }) => <label key={note.id} className={styles.candidate} data-selected={selected.has(note.id)}>
                  <input type="checkbox" checked={selected.has(note.id)} onChange={() => toggle(note.id)} disabled={deleting} />
                  <span className={styles.check}>{selected.has(note.id) && <Check size={13} />}</span>
                  <span className={styles.candidateCopy}><strong>{note.title}</strong><small>{reason}</small><em>{note.sourceType} · {new Date(note.createdAt).toLocaleDateString("zh-CN")}</em></span>
                </label>)}
              </div>
              <div className={styles.actions}>
                <button className={styles.back} disabled={deleting} onClick={() => { setPlan(null); setSelected(new Set()); }}>换一种说法</button>
                <button className={styles.delete} disabled={deleting || !selected.size} onClick={() => void confirmDelete()}>
                  {deleting ? <LoaderCircle className={styles.spin} size={16} /> : <Trash2 size={16} />}{deleting ? "正在删除…" : preview ? `演示确认 ${selected.size} 条` : `确认删除 ${selected.size} 条`}
                </button>
              </div>
            </> : <div className={styles.noMatch}><p>没有找到足够明确的候选。</p><button onClick={() => { setPlan(null); setSelected(new Set()); }}>换一种说法</button></div>}
          </div>}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </>}
      </section>
    </div>}
  </>;
}
