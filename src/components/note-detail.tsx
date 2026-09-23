"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, LoaderCircle, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { repository, RepositoryError } from "@/lib/repository";
import { CAPTURE_LIMITS, isSafeSourceUrl } from "@/lib/schema";
import { DEFAULT_QUESTION, SOURCE_TYPES, type AiResult, type CaptureInput, type EchoNote } from "@/lib/types";
import reflectionStyles from "./reflection-panel.module.css";
import { ArtFlashcard } from "./art-flashcard";
import { FLASHCARD_TAG, withFlashcardFavorite } from "@/lib/art-flashcards";
import flashcardStyles from "./art-flashcard.module.css";
import { preserveTaskTags, visibleTags, type TaskAction } from "@/lib/task-tickets";
import { TaskJourneyBar } from "./task-journey-bar";
import { captureKindFromTags } from "@/lib/note-context";
import LatticeLoader from "./lattice-loader";

export interface NoteDetailProps {
  note: EchoNote;
  onBack: () => void;
  onUpdated: (note?: EchoNote, deletedId?: string) => Promise<void>;
  onOrganize: (note: EchoNote) => Promise<void>;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
}

const captureOf = (note: EchoNote): CaptureInput => ({ userText: note.userText, sourceType: note.sourceType, sourceName: note.sourceName, sourceUrl: note.sourceUrl, sourceTimestamp: note.sourceTimestamp, sourceExcerpt: note.sourceExcerpt });
const parseTags = (text: string) => [...new Set(text.split(/[，,、\n]/).map(tag => tag.trim()).filter(Boolean))];
const messageOf = (error: unknown) => error instanceof Error ? error.message : "暂时没有保存成功，已输入的文字还在，请再试一次。";
const formatDate = (value: string) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
const questionOf = (note: EchoNote) => note.reflectionPrompt || note.aiResult?.reflectionQuestions[0] || DEFAULT_QUESTION;
interface ReflectionDraft { text: string; prompt: string; baseText: string; basePrompt: string; version: number | undefined }
interface AiEditBaseline { result: AiResult; hasThought: boolean; hasSource: boolean; version: number | undefined }

function SectionTitle({ number, title, hint, action }: { number: string; title: string; hint?: string; action?: React.ReactNode }) {
  return <div className="section-heading"><div className="section-title"><span className="section-number" aria-hidden="true">{number}</span><div><h2>{title}</h2>{hint && <p className="muted">{hint}</p>}</div></div>{action}</div>;
}

export function NoteDetail({ note, onBack, onUpdated, onOrganize, onNotify }: NoteDetailProps) {
  const [editingContent, setEditingContent] = useState(false);
  const [content, setContent] = useState<CaptureInput>(() => captureOf(note));
  const [editingMeta, setEditingMeta] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [tags, setTags] = useState(visibleTags(note.tags).join("，"));
  const [aiBaseline, setAiBaseline] = useState<AiEditBaseline | null>(null);
  const [aiDirty, setAiDirty] = useState(false);
  const [reflectionDraft, setReflectionDraft] = useState<ReflectionDraft | null>(null);
  const [busy, setBusy] = useState<"content" | "meta" | "reflection" | "ai" | "delete" | "favorite" | "task" | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [contentError, setContentError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const operation = useRef(false);
  const leaving = useRef(false);
  const leaveDialog = useRef<HTMLDivElement>(null);
  const contentBaseline = useRef({ input: captureOf(note), version: note.storageVersion });
  const metaBaseline = useRef({ title: note.title, tags: visibleTags(note.tags).join("，"), version: note.storageVersion });
  const deleteVersion = useRef<number | undefined>(undefined);

  // Drafts compare with the version that was opened for editing, never with a
  // newly synchronized row. Untouched reflection fields read directly from it.
  useEffect(() => {
    setContent(captureOf(note)); setReflectionDraft(null);
    setTitle(note.title); setTags(visibleTags(note.tags).join("，"));
    contentBaseline.current = { input: captureOf(note), version: note.storageVersion };
    metaBaseline.current = { title: note.title, tags: visibleTags(note.tags).join("，"), version: note.storageVersion };
    setEditingContent(false); setEditingMeta(false); setAiBaseline(null); setAiDirty(false); setConfirmDelete(false); setContentError(""); setSyncError("");
    leaving.current = false; setPendingNavigation(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  const editingAi = aiBaseline !== null;
  const contentDirty = editingContent && JSON.stringify(content) !== JSON.stringify(contentBaseline.current.input);
  const metaDirty = editingMeta && (title !== metaBaseline.current.title || tags !== metaBaseline.current.tags);
  const reflection = reflectionDraft?.text ?? note.reflectionText;
  const reflectionDirty = Boolean(reflectionDraft && reflectionDraft.text !== reflectionDraft.baseText);
  const promptDirty = Boolean(reflectionDraft && reflectionDraft.prompt !== reflectionDraft.basePrompt);
  const unsaved = contentDirty || metaDirty || reflectionDirty || promptDirty || aiDirty;
  const processing = organizing || note.aiStatus === "processing";
  const stale = Boolean(note.aiResult && note.aiInputRevision !== note.revision);
  const captureKind = captureKindFromTags(note.tags);
  const canOrganize = Boolean(note.userText.trim() || note.sourceExcerpt.trim());
  const questions = note.aiResult?.reflectionQuestions.slice(0, 2) ?? [DEFAULT_QUESTION];
  const currentQuestion = reflectionDraft?.prompt ?? questionOf(note);
  const editedVersionChanged = (editingContent && contentBaseline.current.version !== note.storageVersion)
    || (editingMeta && metaBaseline.current.version !== note.storageVersion)
    || (aiBaseline && aiBaseline.version !== note.storageVersion)
    || (reflectionDraft && reflectionDraft.version !== note.storageVersion)
    || (confirmDelete && deleteVersion.current !== note.storageVersion);

  useEffect(() => {
    if (!unsaved && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { if (!leaving.current) event.preventDefault(); };
    const confirmNavigation = (event: Event) => {
      if (leaving.current) return;
      const proceed = (event as CustomEvent<{ proceed: () => void }>).detail?.proceed;
      if (typeof proceed !== "function") return;
      event.preventDefault();
      if (busy) { onNotify("正在等待云端确认，请稍候再离开。", "info"); return; }
      setPendingNavigation(() => proceed);
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("echo:before-navigate", confirmNavigation);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("echo:before-navigate", confirmNavigation);
    };
  }, [unsaved, busy, onNotify]);

  useEffect(() => {
    if (!pendingNavigation) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    leaveDialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (!leaving.current) previousFocus?.focus(); };
  }, [pendingNavigation]);

  function discardAndLeave() {
    if (!pendingNavigation) return;
    leaving.current = true;
    const proceed = pendingNavigation;
    setPendingNavigation(null);
    proceed();
  }

  function back() {
    onBack();
  }

  function versionAtStart(version: number | undefined): number {
    if (!version) throw new RepositoryError("缺少编辑开始时的版本，请保留输入，重新打开记录后再修改。", "VERSION_REQUIRED");
    return version;
  }

  function reportError(error: unknown, deleting = false): string {
    const message = error instanceof RepositoryError && error.status === 409
      ? deleting
        ? "这条记录已经更新，尚未删除。请先点“保留记录”，查看最新内容后再重新发起删除。"
        : `${messageOf(error)} 当前输入仍保留。请先复制需要保留的文字，再取消本区域编辑，刷新记录后重新打开编辑，核对后保存。`
      : messageOf(error);
    setSyncError(message); onNotify(message, "error");
    return message;
  }

  function beginContent() {
    contentBaseline.current = { input: captureOf(note), version: note.storageVersion };
    setContent(captureOf(note)); setContentError(""); setSyncError(""); setEditingContent(true);
  }

  function beginMeta() {
    metaBaseline.current = { title: note.title, tags: visibleTags(note.tags).join("，"), version: note.storageVersion };
    setTitle(note.title); setTags(visibleTags(note.tags).join("，")); setSyncError(""); setEditingMeta(true);
  }

  function updateReflection(patch: Partial<Pick<ReflectionDraft, "text" | "prompt">>) {
    setReflectionDraft(current => ({
      ...(current ?? { text: note.reflectionText, prompt: questionOf(note), baseText: note.reflectionText,
        basePrompt: questionOf(note), version: note.storageVersion }), ...patch,
    }));
  }

  async function saveContent(event: React.FormEvent) {
    event.preventDefault(); if (operation.current) return;
    if (!isSafeSourceUrl(content.sourceUrl)) { setContentError("请输入完整的 http:// 或 https:// 链接，已输入的内容还在。"); return; }
    operation.current = true; setBusy("content"); setContentError("");
    try {
      const saved = await repository.updateContent(note.id, content, versionAtStart(contentBaseline.current.version));
      await onUpdated(saved); setEditingContent(false); setSyncError("");
      onNotify(note.aiResult ? "内容已保存，已有整理保留，可以重新整理。" : "想法和来源已保存。");
    } catch (error) { setContentError(reportError(error)); }
    finally { operation.current = false; setBusy(null); }
  }

  async function saveMeta(event: React.FormEvent) {
    event.preventDefault(); if (operation.current) return;
    operation.current = true; setBusy("meta");
    try {
      const saved = await repository.updateMeta(note.id, { title, tags: preserveTaskTags(parseTags(tags), note.tags) }, versionAtStart(metaBaseline.current.version));
      await onUpdated(saved); setEditingMeta(false); setSyncError(""); onNotify("标题和标签已保存。");
    }
    catch (error) { reportError(error); }
    finally { operation.current = false; setBusy(null); }
  }

  async function saveReflection(event: React.FormEvent) {
    event.preventDefault(); if (operation.current || !reflectionDraft || (!reflectionDirty && !promptDirty)) return;
    operation.current = true; setBusy("reflection");
    try {
      const saved = await repository.saveReflection(note.id, reflection, currentQuestion, versionAtStart(reflectionDraft.version));
      await onUpdated(saved); setReflectionDraft(null); setSyncError(""); onNotify("你的理解已保存，一点点让想法长成自己的东西。");
    }
    catch (error) { reportError(error); }
    finally { operation.current = false; setBusy(null); }
  }

  async function transitionTask(current: EchoNote, action: TaskAction) {
    if (operation.current || unsaved || editingMeta) throw new Error("请先保存当前修改，再更新事项进度。");
    operation.current = true; setBusy("task");
    try {
      const saved = await repository.updateTask(current, action);
      await onUpdated(saved); setSyncError("");
      onNotify(action === "complete" ? "这件事已标记完成。" : "这件事已开始，进度已经保存。");
    } finally { operation.current = false; setBusy(null); }
  }

  async function toggleFlashcardFavorite() {
    if (operation.current || unsaved || editingMeta || (!note.reflectionText.trim() && !note.tags.includes(FLASHCARD_TAG))) return;
    operation.current = true; setBusy("favorite");
    const nextFavorite = !note.tags.includes(FLASHCARD_TAG);
    try {
      const saved = await repository.updateMeta(note.id, {
        title: note.title, tags: withFlashcardFavorite(note.tags, nextFavorite),
      }, versionAtStart(note.storageVersion));
      await onUpdated(saved); setSyncError("");
      onNotify(nextFavorite ? "闪卡已收藏，可以在回声屿的「闪卡」里重温。" : "已取消收藏，原笔记和你的理解仍然保留。");
    } catch (error) { reportError(error); }
    finally { operation.current = false; setBusy(null); }
  }

  async function organize() {
    if (processing || !canOrganize || contentDirty || editingAi) return;
    setOrganizing(true);
    try { await onOrganize(note); } catch (error) { onNotify(messageOf(error), "error"); }
    finally { setOrganizing(false); }
  }

  async function saveAi(result: AiResult) {
    if (operation.current || !aiBaseline) throw new Error("请等待当前保存完成后再保存整理内容。");
    operation.current = true; setBusy("ai");
    try {
      const saved = await repository.updateAiResult(note.id, result, versionAtStart(aiBaseline.version));
      await onUpdated(saved); setAiBaseline(null); setAiDirty(false); setSyncError(""); onNotify("整理内容的修改已保存。");
    } finally { operation.current = false; setBusy(null); }
  }

  async function remove() {
    if (operation.current) return;
    operation.current = true; setBusy("delete");
    try { await repository.remove(note.id, versionAtStart(deleteVersion.current)); leaving.current = true; await onUpdated(undefined, note.id); onNotify("记录已删除。"); onBack(); }
    catch (error) { reportError(error, true); }
    finally { operation.current = false; setBusy(null); }
  }

  return <div className="detail-page">
    <button className="btn btn-ghost" onClick={back}><ArrowLeft size={17} />返回回声屿</button>
    <header className="detail-header">
      <p className="eyebrow">一条想法，慢慢生长</p>
      <h1>{note.title}</h1>
      <div className="detail-meta"><span>{note.sourceType}</span><span>{formatDate(note.createdAt)}</span>{captureKind !== "thought" && <span className="tag">{captureKind === "relationship" ? "和 TA" : "今日片刻"}</span>}{note.isExample && <span className="tag">演示资料</span>}<span className="chip">{processing ? "整理中" : stale ? "待更新" : note.aiStatus === "done" ? "已整理" : "待整理"}</span><span className="chip">{note.reflectionText.trim() ? "已有输出" : "待输出"}</span></div>
      {visibleTags(note.tags).length > 0 && <div className="detail-tags">{visibleTags(note.tags).map(tag => <span className="tag" key={tag}>#{tag}</span>)}</div>}
      {(syncError || editedVersionChanged) && <div className={`inline-notice ${syncError ? "error" : ""}`} role={syncError ? "alert" : "status"}><p>{syncError || "云端记录已有更新，当前编辑中的文字仍保留。保存时会核对版本；如需重新打开编辑，请先复制要保留的输入。"}</p><button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => void onUpdated()}>刷新云端记录</button></div>}
      {!editingMeta && <button className="btn btn-ghost" onClick={beginMeta} disabled={Boolean(busy)}><Pencil size={15} />编辑标题和标签</button>}
      {editingMeta && <form className="panel detail-editor" onSubmit={saveMeta}>
        <label className="field"><span className="field-label">标题</span><input className="input" value={title} onChange={event => setTitle(event.target.value)} maxLength={100} required disabled={busy === "meta"} /></label>
        <label className="field"><span className="field-label">标签</span><input className="input" value={tags} onChange={event => setTags(event.target.value)} placeholder="用逗号隔开，例如：主动学习，表达" disabled={busy === "meta"} /></label>
        <div className="actions"><button className="btn btn-primary" disabled={Boolean(busy)}>{busy === "meta" ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存标题和标签</button><button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => { setEditingMeta(false); setSyncError(""); }}>取消</button></div>
      </form>}
    </header>
    <TaskJourneyBar note={note} onTransition={transitionTask} blockedReason={unsaved ? "请先保存当前修改，再更新事项进度。" : editingMeta ? "请先完成标题和标签的编辑。" : busy ? "正在等待保存确认…" : undefined} />

    <div className="detail-sections">
      <form className="panel detail-section" onSubmit={saveContent}>
        <SectionTitle number="01" title="我的原始想法" hint="保留最初想到的那个瞬间。" action={!editingContent && <button type="button" className="btn btn-ghost" onClick={beginContent} disabled={Boolean(busy)}><Pencil size={15} />编辑</button>} />
        {editingContent ? <label className="field"><span className="field-label">我的想法</span><textarea className="textarea" rows={5} value={content.userText} onChange={event => setContent({ ...content, userText: event.target.value })} placeholder="记下刚刚的想法……" maxLength={CAPTURE_LIMITS.userText} disabled={busy === "content"} /></label> : <p className={`prose ${!note.userText ? "muted" : ""}`}>{note.userText || "还没有写下自己的想法，随时可以补充。"}</p>}
        <div className="divider" />
        <SectionTitle number="02" title="来源材料" hint="你实际提供的出处与文字。" />
        {editingContent ? <div>
          <div className="form-grid">
            <label className="field"><span className="field-label">来源类型</span><select className="input" value={content.sourceType} onChange={event => setContent({ ...content, sourceType: event.target.value as CaptureInput["sourceType"] })} disabled={busy === "content"}>{SOURCE_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
            <label className="field"><span className="field-label">来源名称 · 选填</span><input className="input" value={content.sourceName} onChange={event => setContent({ ...content, sourceName: event.target.value })} maxLength={CAPTURE_LIMITS.sourceName} placeholder="节目名、文章名或书名" disabled={busy === "content"} /></label>
          </div>
          <label className="field"><span className="field-label">来源链接 · 选填</span><input className="input" type="text" inputMode="url" value={content.sourceUrl} onChange={event => { setContent({ ...content, sourceUrl: event.target.value }); setContentError(""); }} placeholder="https://…" maxLength={CAPTURE_LIMITS.sourceUrl} disabled={busy === "content"} /></label>
          <label className="field"><span className="field-label">时间点 · 选填</span><input className="input" value={content.sourceTimestamp} onChange={event => setContent({ ...content, sourceTimestamp: event.target.value })} placeholder="例如：约 18:20" maxLength={CAPTURE_LIMITS.sourceTimestamp} disabled={busy === "content"} /></label>
          <label className="field"><span className="field-label">原文或转写片段 · 选填</span><textarea className="textarea" rows={5} value={content.sourceExcerpt} onChange={event => setContent({ ...content, sourceExcerpt: event.target.value })} maxLength={CAPTURE_LIMITS.sourceExcerpt} placeholder="这里放原文；你自己的听后感请写在上面的想法框里。" disabled={busy === "content"} /><span className="muted">这里保存你提供的片段，不会自动读取链接内容。</span></label>
          {contentError && <p className="inline-notice error" role="alert">{contentError}</p>}
          <div className="actions"><button className="btn btn-primary" disabled={Boolean(busy)}>{busy === "content" ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存想法和来源</button><button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => { setEditingContent(false); setContentError(""); setSyncError(""); }}>取消</button></div>
        </div> : <div>
          {(note.sourceName || note.sourceTimestamp) && <p className="source-description">{note.sourceName && <strong>{note.sourceName}</strong>}{note.sourceTimestamp && <span className="muted"> · {note.sourceTimestamp}</span>}</p>}
          {note.sourceUrl && isSafeSourceUrl(note.sourceUrl) && <a className="source-link" href={note.sourceUrl} target="_blank" rel="noopener noreferrer">打开来源<ArrowUpRight size={16} /><span className="muted">{new URL(note.sourceUrl).hostname}</span></a>}
          {note.sourceExcerpt ? <div className="source-excerpt"><p className="eyebrow">你提供的来源片段</p><p className="prose">{note.sourceExcerpt}</p></div> : <p className="muted">未提供来源正文。链接仅保存为出处，不代表已读取其内容。</p>}
        </div>}
      </form>

      <section className="panel detail-section">
        <SectionTitle number="03" title="AI 帮我整理" hint="理清线索，留一点继续思考的空间。" action={<button className="btn ai-organize-button" onClick={() => void organize()} disabled={processing || !canOrganize || contentDirty || editingAi || Boolean(busy)}>{!processing && <Sparkles size={16} />}{processing ? "正在整理…" : note.aiResult || note.aiStatus === "error" ? "重新整理" : "整理一下"}</button>} />
        {contentDirty && <p className="inline-notice">请先保存想法和来源的修改，再重新整理。</p>}
        {stale && <p className="inline-notice">内容已修改，建议重新整理。以下保留的是上一次的结果。</p>}
        {note.aiError && <p className="inline-notice error" role="alert">{note.aiError}</p>}
        {!canOrganize && <p className="inline-notice">只有来源信息，还需要补充一点想法或来源文字，才能开始整理。</p>}
        {processing && <div className="ai-thinking-state"><LatticeLoader label="正在理清线索" pattern="orbit" grid={3} shape="round" color="#efc4df" cellSize={7} gap={3} fontSize={14} step={105} idleOpacity={0.16} glow glowColor="#e5a9d3" /></div>}
        {note.aiResult || aiBaseline ? <>
          <p className="ai-basis muted">{stale ? "以下结果基于修改前提供的记录与材料。" : note.sourceExcerpt.trim() ? note.userText.trim() ? "本次整理依据：你的记录和你提供的来源片段" : "本次整理依据：你提供的来源片段；未提供个人想法" : "本次整理依据：你的记录；未读取来源正文"}</p>
          {aiBaseline ? <AiEditor key={note.id} result={aiBaseline.result} hasThought={aiBaseline.hasThought} hasSource={aiBaseline.hasSource} blocked={Boolean(busy)} onCancel={() => { setAiBaseline(null); setAiDirty(false); setSyncError(""); }} onSave={saveAi} onDirtyChange={setAiDirty} onError={error => { reportError(error); }} /> : note.aiResult && <AiResultView result={note.aiResult} />}
          {!editingAi && <button className="btn btn-ghost" disabled={processing || Boolean(busy)} onClick={() => {
            if (!note.aiResult) return;
            setAiBaseline({ result: structuredClone(note.aiResult), hasThought: Boolean(note.userText.trim()), hasSource: Boolean(note.sourceExcerpt.trim()), version: note.storageVersion }); setAiDirty(false); setSyncError("");
          }}><Pencil size={15} />编辑整理内容</button>}
        </> : canOrganize && !processing && <div className="empty-state"><Sparkles size={25} /><p>先留下记录，想整理的时候再来。</p><p className="muted">整理只使用这条记录和你补充的片段。你也可以直接写下自己的理解。</p></div>}
      </section>

      <section className="panel detail-section reflection-section">
        <SectionTitle number="04" title="三句话，留给未来的自己" hint="一幅画收藏风景，一张卡留住你的理解。" />
        <div className={flashcardStyles.workbench}>
        <form className={flashcardStyles.writing} onSubmit={saveReflection}>
          <p className={flashcardStyles.intro}>我理解了什么？它为什么触动我？我想怎样试一试？<br />每行写一句，翻面就能看到自己的闪卡。</p>
          <details className={reflectionStyles.panel} open>
            <summary className={reflectionStyles.summary}><span className={reflectionStyles.index}>04</span><span className={reflectionStyles.summaryCopy}><strong>写下自己的理解</strong><span>{note.reflectionText.trim() ? "已经留下一段自己的话，随时续写。" : "不必完整，从一句自己的话开始。"}</span></span><ChevronDown className={reflectionStyles.chevron} size={18} /></summary>
            <div className={reflectionStyles.body}>
              <div className={reflectionStyles.editor}>
                <p className="reflection-question">{currentQuestion}</p>
                {questions.length > 1 && <details className="question-options"><summary className="muted">换一个思考角度<ChevronDown size={14} /></summary><div className="actions">{questions.filter(question => question !== currentQuestion).map(question => <button type="button" className="btn btn-ghost" key={question} disabled={busy === "reflection"} onClick={() => updateReflection({ prompt: question })}>{question}</button>)}</div></details>}
                <label className="sr-only" htmlFor={`reflection-${note.id}`}>我自己的理解</label><textarea id={`reflection-${note.id}`} className={reflectionStyles.textarea} rows={6} value={reflection} onChange={event => updateReflection({ text: event.target.value })} maxLength={CAPTURE_LIMITS.reflectionText} placeholder={"我理解了……\n它让我想到……\n下一次，我想试试……"} disabled={busy === "reflection"} />
                <div className={`actions ${reflectionStyles.actions}`}><button className="btn btn-primary" disabled={Boolean(busy) || (!reflectionDirty && !promptDirty)}>{busy === "reflection" ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存我的理解</button>{reflectionDraft && <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => { setReflectionDraft(null); setSyncError(""); }}>取消本次修改</button>}<span className={reflectionStyles.status}>{reflectionDirty || promptDirty ? "有尚未保存的修改" : note.reflectionText.trim() ? "已保存，随时可以继续写。" : "不必完整，也不需要标准答案。"}</span></div>
              </div>
              <aside className={reflectionStyles.standard}><strong>这是你的解释</strong>只写你此刻的理解。它会保存在这条灵感里，不覆盖原始记录，也不算作 AI 的内容。</aside>
            </div>
          </details>
        </form>
        <ArtFlashcard key={note.id} noteId={note.id} title={note.title} text={reflection} favorite={note.tags.includes(FLASHCARD_TAG)} onFavorite={() => void toggleFlashcardFavorite()} pending={busy === "favorite"} blockedReason={unsaved ? "卡面正在预览你的修改，请先保存理解，再收藏。" : editingMeta ? "请先完成标题和标签的编辑。" : busy ? "请等待当前保存完成。" : undefined} />
        </div>
      </section>

      <div className="danger-zone">
        {confirmDelete ? <div className="panel"><p>确定删除「{note.title}」吗？</p><p className="muted">这条记录的想法、来源、整理和个人输出将一起删除，无法撤销。</p><div className="actions"><button className="btn btn-danger" disabled={Boolean(busy)} onClick={() => void remove()}>{busy === "delete" ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}确认删除</button><button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => { setConfirmDelete(false); setSyncError(""); }}>保留记录</button></div></div> : <button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => { deleteVersion.current = note.storageVersion; setConfirmDelete(true); setSyncError(""); }}><Trash2 size={15} />删除这条记录</button>}
      </div>
    </div>
    {pendingNavigation && <div className="modal-backdrop">
      <div ref={leaveDialog} className="modal panel" role="dialog" aria-modal="true" aria-labelledby="leave-title" aria-describedby="leave-description" onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); setPendingNavigation(null); }
        if (event.key === "Tab") {
          const buttons = leaveDialog.current?.querySelectorAll<HTMLButtonElement>("button");
          if (!buttons?.length) return;
          const first = buttons[0]; const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
        <h2 id="leave-title">还有修改没有保存</h2>
        <p id="leave-description">离开后，这次未保存的文字和修改会丢失。可以继续编辑并保存，再去其他页面。</p>
        <div className="actions"><button className="btn btn-primary" onClick={() => setPendingNavigation(null)}>继续编辑</button><button className="btn btn-ghost" onClick={discardAndLeave}>放弃修改并离开</button></div>
      </div>
    </div>}
  </div>;
}

function AiResultView({ result }: { result: AiResult }) {
  return <div className="ai-content">
    <div><p className="eyebrow">标题建议</p><h3>{result.title}</h3></div>
    {result.thoughtSummary && <div><p className="eyebrow">我的想法 · 整理</p><p className="prose">{result.thoughtSummary}</p></div>}
    {result.sourceSummary && <div><p className="eyebrow">来源片段 · 概括</p><p className="prose">{result.sourceSummary}</p></div>}
    {result.keyPoints.length > 0 && <div><p className="eyebrow">值得留下的要点</p><ul className="ai-points">{result.keyPoints.map((point, index) => <li key={index}><span className="chip">{point.origin}</span><span className="prose">{point.text}</span></li>)}</ul></div>}
    {result.tags.length > 0 && <div className="detail-tags">{result.tags.map((tag, index) => <span className="tag" key={`${tag}-${index}`}>#{tag}</span>)}</div>}
    <div><p className="eyebrow">可以再想一想</p>{result.reflectionQuestions.map((question, index) => <p className="prose" key={index}>{question}</p>)}</div>
    {result.possibleApplication && <div className="inline-notice"><p className="eyebrow">可尝试的应用 · AI 建议</p><p className="prose">{result.possibleApplication}</p></div>}
  </div>;
}

function AiEditor({ result, hasThought, hasSource, blocked, onSave, onCancel, onDirtyChange, onError }: { result: AiResult; hasThought: boolean; hasSource: boolean; blocked: boolean; onSave: (result: AiResult) => Promise<void>; onCancel: () => void; onDirtyChange: (dirty: boolean) => void; onError: (error: unknown) => void }) {
  const [draft, setDraft] = useState<AiResult>(() => structuredClone(result));
  const [tags, setTags] = useState(result.tags.join("，"));
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const disabled = saving || blocked;
  useEffect(() => {
    onDirtyChange(JSON.stringify(draft) !== JSON.stringify(result) || tags !== result.tags.join("，"));
  }, [draft, tags, result, onDirtyChange]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (lock.current || blocked) return;
    lock.current = true; setSaving(true);
    try { await onSave({ ...draft, tags: parseTags(tags), sourceSummary: draft.sourceSummary?.trim() || null, possibleApplication: draft.possibleApplication?.trim() || null }); }
    catch (error) { onError(error); }
    finally { lock.current = false; setSaving(false); }
  }
  return <form className="detail-editor" onSubmit={submit}>
    <label className="field"><span className="field-label">标题建议</span><input className="input" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} maxLength={100} required disabled={disabled} /></label>
    {(hasThought || draft.thoughtSummary) && <label className="field"><span className="field-label">我的想法 · 整理</span><textarea className="textarea" rows={3} value={draft.thoughtSummary} onChange={event => setDraft({ ...draft, thoughtSummary: event.target.value })} maxLength={6000} disabled={disabled} /></label>}
    {(hasSource || draft.sourceSummary) && <label className="field"><span className="field-label">来源片段 · 概括</span><textarea className="textarea" rows={3} value={draft.sourceSummary ?? ""} onChange={event => setDraft({ ...draft, sourceSummary: event.target.value })} maxLength={10000} disabled={disabled} /></label>}
    <p className="field-label">核心要点 · 最多 3 条</p>
    {draft.keyPoints.map((point, index) => <div className="field" key={index}>
      <div className="actions"><select className="input" aria-label={`第 ${index + 1} 条要点的依据`} value={point.origin} onChange={event => setDraft({ ...draft, keyPoints: draft.keyPoints.map((item, i) => i === index ? { ...item, origin: event.target.value as "用户记录" | "来源片段" } : item) })} disabled={disabled}>{(hasThought || point.origin === "用户记录") && <option>用户记录</option>}{(hasSource || point.origin === "来源片段") && <option>来源片段</option>}</select><button type="button" className="btn btn-ghost" aria-label={`删除第 ${index + 1} 条要点`} disabled={disabled} onClick={() => setDraft({ ...draft, keyPoints: draft.keyPoints.filter((_, i) => i !== index) })}><X size={16} /></button></div>
      <textarea className="textarea" rows={2} aria-label={`第 ${index + 1} 条要点`} value={point.text} onChange={event => setDraft({ ...draft, keyPoints: draft.keyPoints.map((item, i) => i === index ? { ...item, text: event.target.value } : item) })} maxLength={2000} required disabled={disabled} />
    </div>)}
    {draft.keyPoints.length < 3 && <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => setDraft({ ...draft, keyPoints: [...draft.keyPoints, { text: "", origin: hasThought ? "用户记录" : "来源片段" }] })}><Plus size={15} />补充要点</button>}
    <label className="field"><span className="field-label">建议标签 · 最多 5 个，用逗号隔开</span><input className="input" value={tags} onChange={event => setTags(event.target.value)} disabled={disabled} /></label>
    {draft.reflectionQuestions.map((question, index) => <label className="field" key={index}><span className="field-label">思考问题 {index + 1}</span><div className="actions"><input className="input" value={question} onChange={event => setDraft({ ...draft, reflectionQuestions: draft.reflectionQuestions.map((item, i) => i === index ? event.target.value : item) })} maxLength={500} required disabled={disabled} />{draft.reflectionQuestions.length > 1 && <button type="button" className="btn btn-ghost" aria-label={`删除问题 ${index + 1}`} disabled={disabled} onClick={() => setDraft({ ...draft, reflectionQuestions: draft.reflectionQuestions.filter((_, i) => i !== index) })}><X size={16} /></button>}</div></label>)}
    {draft.reflectionQuestions.length < 2 && <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => setDraft({ ...draft, reflectionQuestions: [...draft.reflectionQuestions, ""] })}><Plus size={15} />补充一个问题</button>}
    <label className="field"><span className="field-label">可尝试的应用 · 选填</span><textarea className="textarea" rows={3} value={draft.possibleApplication ?? ""} onChange={event => setDraft({ ...draft, possibleApplication: event.target.value })} maxLength={2000} disabled={disabled} /></label>
    <div className="actions"><button className="btn btn-primary" disabled={disabled}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存整理内容</button><button type="button" className="btn btn-ghost" onClick={onCancel} disabled={disabled}>取消</button></div>
  </form>;
}
