"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, ChevronDown, Cloud, FileText, Library, LockKeyhole, Plus, Search, Settings2, ShieldCheck, Sparkles, X } from "lucide-react";
import { CaptureComposer, CaptureSpace, EchoSymbol, MobileNav, SaveStrokeMoment, SpaceHeader } from "./studio-ui";
import { InspirationCollection } from "./inspiration-collection";
import { CheckinPanel } from "./checkin-panel";
import type { LibraryFilter } from "@/lib/search";
import { createExamples } from "@/lib/examples";
import { emptyCapture, type EchoNote } from "@/lib/types";
import reflectionStyles from "./reflection-panel.module.css";
import { ArtFlashcard } from "./art-flashcard";
import { FLASHCARD_TAG, withFlashcardFavorite } from "@/lib/art-flashcards";
import flashcardStyles from "./art-flashcard.module.css";
import { taskTags, type TaskAction } from "@/lib/task-tickets";
import { TaskJourneyBar } from "./task-journey-bar";
import { captureContextTags, type CaptureKind } from "@/lib/note-context";

type PreviewView = "capture" | "library" | "settings" | "note";
const initialNotes = createExamples().map((note, index) => ({ ...note, reflectionText: index === 1 ? "先把想做的事缩小到今天愿意完成的一步，行动会从这里开始。" : note.reflectionText, tags: [...note.tags, ...(index > 0 ? [FLASHCARD_TAG] : []), ...(index === 1 ? captureContextTags("relationship") : index === 2 ? captureContextTags("moment") : [])], createdAt: `2026-09-${20 - index}T08:00:00Z`, updatedAt: `2026-09-${20 - index}T08:00:00Z` }));

/** Public visual sandbox. Never reads or writes personal data or calls AI services. */
export function DesignPreview() {
  const [view, setView] = useState<PreviewView>("capture");
  const [capture, setCapture] = useState(emptyCapture());
  const [sourceOpen, setSourceOpen] = useState(false);
  const [captureKind, setCaptureKind] = useState<CaptureKind>("thought");
  const [saveMoment, setSaveMoment] = useState(0);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<"created" | "updated">("created");
  const [selected, setSelected] = useState<EchoNote | null>(null);
  const [reflection, setReflection] = useState("");
  const [previewNotes, setPreviewNotes] = useState(initialNotes);
  useEffect(() => {
    function followPreviewLink() {
      const initialView = window.location.hash.slice(1);
      if (initialView === "capture" || initialView === "library" || initialView === "settings") setView(initialView);
      if (initialView === "flashcard") { setSelected(initialNotes[0]); setReflection(initialNotes[0].reflectionText); setView("note"); }
    }
    followPreviewLink();
    window.addEventListener("hashchange", followPreviewLink);
    return () => window.removeEventListener("hashchange", followPreviewLink);
  }, []);
  function navigate(next: PreviewView) {
    setView(next); setMessage("");
    window.history.replaceState(null, "", `#${next === "note" ? "library" : next}`);
    window.scrollTo({ top: 0, behavior: "instant" });
    document.querySelector<HTMLElement>(".main-wrap")?.scrollTo({ top: 0, behavior: "instant" });
  }
  function open(note: EchoNote) { setSelected(note); setReflection(note.reflectionText); navigate("note"); }
  async function transitionTask(note: EchoNote, action: TaskAction) {
    const next = { ...note, tags: taskTags(note, action), updatedAt: new Date().toISOString() };
    setPreviewNotes(current => current.map(item => item.id === next.id ? next : item));
    setSelected(current => current?.id === next.id ? next : current);
    setFilter(action === "complete" ? "arrival" : "departure");
    setMessage(action === "complete" ? "演示事项已标记完成。仅本次预览有效，未保存到账号。" : "演示事项已开始。仅本次预览有效，未保存到账号。");
  }
  function togglePreviewFavorite() {
    if (!selected || !reflection.trim()) return;
    const favorite = !selected.tags.includes(FLASHCARD_TAG);
    const next = { ...selected, reflectionText: reflection, tags: withFlashcardFavorite(selected.tags, favorite) };
    setSelected(next);
    setPreviewNotes(current => current.map(note => note.id === next.id ? next : note));
    setMessage(favorite ? "演示闪卡已加入本页的「闪卡收藏」。仅本次预览有效，刷新后清空，未保存到账号。" : "已移出演示收藏；没有修改账号数据。");
  }
  function previewOnly() { setMessage("这是界面预览，内容只停留在当前页面；没有保存，也没有调用 AI。请返回正式入口连接私人账号后使用。"); }
  function previewCaptureSave() {
    setSaveMoment(value => value + 1);
    setMessage("这是一段保存反馈预览；文字没有保存，也没有调用 AI。");
  }

  return <>
    <div className="preview-banner"><strong>界面预览</strong><span>以下均为演示资料 · 输入不会保存 · AI 未调用</span><a href="/workspace">返回正式入口<ArrowRight size={11} style={{ display: "inline", marginLeft: 5 }} /></a></div>
    <div className="app-shell preview-shell">
      <SpaceHeader view={view} onNavigate={navigate} />
      <div className="main-wrap">
      <main className={`main-content ${view === "capture" ? "capture-page" : ""}`}>
        {view === "capture" && <CaptureSpace><CaptureComposer capture={capture} onChange={change => setCapture(value => ({ ...value, ...change }))} sourceOpen={sourceOpen} onSourceToggle={() => setSourceOpen(!sourceOpen)} saving={false} draftState="idle" onSave={previewCaptureSave} captureKind={captureKind} onCaptureKind={setCaptureKind} onOpenCheckin={() => document.getElementById("daily-star-entry")?.click()} preview /><SaveStrokeMoment sequence={saveMoment} /><CheckinPanel preview notes={previewNotes} compact />{previewNotes[0] && <button className="preview-recent" onClick={() => open(previewNotes[0])}><span className="preview-recent-copy"><small>继续上一次记录</small><strong>{previewNotes[0].title}</strong></span><ArrowUpRight size={16} /></button>}</CaptureSpace>}
        {view === "library" && <InspirationCollection
          notes={previewNotes} query={query} filter={filter} tag={tag} sort={sort}
          onQuery={setQuery} onFilter={setFilter} onTag={setTag} onSort={setSort}
          onCreate={() => navigate("capture")} onOpen={open} onTransition={transitionTask} preview
        />}
        {view === "note" && selected && <><div className="detail-header"><button className="btn btn-ghost" onClick={() => navigate("library")}><ArrowLeft size={15} />返回回声屿</button><h1>{selected.title}</h1><div className="detail-meta"><span>{selected.sourceType}</span><span className="demo-chip">演示资料 · 无真实出处</span></div></div><TaskJourneyBar note={selected} onTransition={transitionTask} preview /><div className="detail-sections"><section className="panel detail-section"><div className="section-heading"><div className="section-title"><span className="section-number">01</span><h2>当时的想法</h2></div><BookOpen size={18} /></div><p className="prose">{selected.userText}</p></section><section className="panel detail-section"><div className="section-heading"><div className="section-title"><span className="section-number">02</span><h2>AI 帮你理一理</h2></div><Sparkles size={18} /></div><p className="muted">这里还没有整理结果。预览不会调用 AI，也不会模拟生成成功。</p><div className="actions"><button className="btn ai-organize-button" onClick={previewOnly}><Sparkles size={15} />整理这条灵感</button></div></section><section className="panel detail-section reflection-section"><div className="section-heading"><div className="section-title"><span className="section-number">03</span><h2>三句话，留给未来的自己</h2></div></div><div className={flashcardStyles.workbench}><div className={flashcardStyles.writing}><p className={flashcardStyles.intro}>我理解了什么？它为什么触动我？我想怎样试一试？<br />每行写一句，翻面就能看到自己的闪卡。</p><details className={reflectionStyles.panel} open><summary className={reflectionStyles.summary}><span className={reflectionStyles.index}>03</span><span className={reflectionStyles.summaryCopy}><strong>写下自己的理解</strong><span>{reflection.trim() ? "已经留下一段自己的话，随时续写。" : "不必完整，从一句自己的话开始。"}</span></span><ChevronDown className={reflectionStyles.chevron} size={18} /></summary><div className={reflectionStyles.body}><div className={reflectionStyles.editor}><p className="reflection-question">如果讲给朋友听，你会怎么解释这条想法？</p><label className="sr-only" htmlFor="preview-reflection">我的理解</label><textarea id="preview-reflection" className={reflectionStyles.textarea} placeholder={"我理解了……\n它让我想到……\n下一次，我想试试……"} value={reflection} onChange={event => setReflection(event.target.value)} /><div className={`actions ${reflectionStyles.actions}`}><button className="btn btn-primary" onClick={previewOnly}>保存我的理解</button><span className={reflectionStyles.status}>预览输入不会保存</span></div></div><aside className={reflectionStyles.standard}><strong>这是你的解释</strong>这里只预览你自己写下的理解。正式账号中，理解会与原始记录一起保存。</aside></div></details></div><ArtFlashcard key={selected.id} noteId={selected.id} title={selected.title} text={reflection} favorite={selected.tags.includes(FLASHCARD_TAG)} onFavorite={togglePreviewFavorite} preview /></div></section></div></>}
        {view === "settings" && <>
          <div className="page-heading"><h1>账号与设置</h1></div>
          <section className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><LockKeyhole size={22} /></div><div><h2>私人账号</h2><p>预览不读取账号信息</p></div><span className="chip">未登录</span></div><p className="settings-description">回到正式入口，连接你的私人账号与云端资料库。</p><div className="actions settings-footer"><a href="/workspace" className="btn btn-primary settings-entry-link">返回正式入口<ArrowRight size={15} /></a></div></section>
          <section className="panel settings-panel settings-storage"><div className="settings-heading"><div className="settings-icon"><Cloud size={22} /></div><div><h2>你的资料，安心保存</h2><p>预览没有保存或同步数据</p></div></div><button className="backup-action backup-primary" onClick={previewOnly}><FileText size={24} /><span><strong>导出完整备份</strong><small>正式账号登录后使用</small></span><ArrowRight size={16} /></button><details className="backup-more"><summary>更多资料管理 <ChevronDown size={15} /></summary><div className="backup-actions">{["从备份恢复", "导出阅读版"].map(label => <button key={label} className="backup-action" onClick={previewOnly}><FileText size={22} /><span><strong>{label}</strong><small>正式账号登录后使用</small></span><ArrowRight size={16} /></button>)}</div></details></section>
        </>}
      </main></div>
      <MobileNav view={view} onNavigate={navigate} />
      {message && <div className="toast toast-info" role="status"><ShieldCheck size={18} /><span>{message}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setMessage("")}><X size={15} /></button></div>}
    </div>
  </>;
}
