"use client";

import { useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Check, ChevronDown, Link2, LoaderCircle, Plus, Settings2 } from "lucide-react";
import { SOURCE_TYPES, type CaptureInput } from "@/lib/types";
import { AeroScene } from "./aero-scene";
import { EchoHeading } from "./echo-heading";
import { TrueFocusLine } from "./true-focus-line";
import LineSidebar from "./line-sidebar";
import sidebarStyles from "./line-sidebar.module.css";

type SpeechResultEvent = { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function EchoSymbol({ small = false }: { small?: boolean }) {
  return <span className={"echo-mark " + (small ? "small" : "")} aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M14 12c-10 4-10 12 0 16M21 7C4 13 4 27 21 33M27 12c10 4 10 12 0 16M21 16v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></span>;
}

type NavigationView = "capture" | "library" | "settings";
export function SpaceHeader({ view, onNavigate, status }: { view: NavigationView | "note"; onNavigate: (view: NavigationView) => void; status?: ReactNode }) {
  const pages: NavigationView[] = ["capture", "library", "settings"];
  return <header className="space-header">
    <button className="brand" onClick={() => onNavigate("capture")} aria-label="拾念首页"><EchoSymbol /><strong>拾念</strong></button>
    <nav className="space-nav" aria-label="主导航">
      <button aria-current={view === "capture" ? "page" : undefined} onClick={() => onNavigate("capture")}>记录</button>
      <button aria-current={view === "library" || view === "note" ? "page" : undefined} onClick={() => onNavigate("library")}>星图</button>
    </nav>
    <div className="space-account">{status}<button className="account-button" aria-label="账号与设置" aria-current={view === "settings" ? "page" : undefined} onClick={() => onNavigate("settings")}><Settings2 size={18} /></button></div>
    <LineSidebar className={sidebarStyles.desktopRail} items={["记录", "星图", "设置"]} activeIndex={pages.indexOf(view === "note" ? "library" : view)}
      accentColor="#c084fc" textColor="#c4c4c4" markerColor="#6c6c6c" showIndex showMarker
      proximityRadius={100} maxShift={30} falloff="smooth" markerLength={60} markerGap={0}
      tickScale={0.5} scaleTick itemGap={20} fontSize={1.1} smoothing={100}
      onItemClick={index => onNavigate(pages[index])} />
  </header>;
}

export function MobileNav({ view, onNavigate }: { view: NavigationView | "note"; onNavigate: (view: NavigationView) => void }) {
  return <nav className="mobile-nav" aria-label="移动端主导航">
    <button className={view === "capture" ? "active" : ""} aria-current={view === "capture" ? "page" : undefined} onClick={() => onNavigate("capture")}><span aria-hidden="true">＋</span><span>记录</span></button>
    <button className={view === "library" || view === "note" ? "active" : ""} aria-current={view === "library" || view === "note" ? "page" : undefined} onClick={() => onNavigate("library")}><span aria-hidden="true">⌕</span><span>星图</span></button>
    <button className={view === "settings" ? "active" : ""} aria-current={view === "settings" ? "page" : undefined} onClick={() => onNavigate("settings")}><span aria-hidden="true">⋯</span><span>设置</span></button>
  </nav>;
}

export function CaptureHeading() {
  return <div className="capture-heading"><p className="capture-focus-kicker"><TrueFocusLine>一闪，便有回响</TrueFocusLine></p><h1 className="kinetic-heading"><EchoHeading>此刻，想记下什么？</EchoHeading></h1></div>;
}

export function CaptureSpace({ children }: { children: ReactNode }) {
  const [focused, setFocused] = useState(false);
  return <section className="capture-space" data-writing={focused}>
    <AeroScene quiet={focused} />
    <div className="capture-content" onFocusCapture={event => {
      if (event.target.matches("input, textarea, select")) setFocused(true);
    }} onBlurCapture={event => {
      if (!(event.relatedTarget instanceof Element && event.currentTarget.contains(event.relatedTarget) && event.relatedTarget.matches("input, textarea, select"))) setFocused(false);
    }}><CaptureHeading />{children}</div>
  </section>;
}

export function EchoAura({ className = "" }: { className?: string }) {
  return <div className={"entry-art " + className}><AeroScene /></div>;
}

type ComposerProps = {
  capture: CaptureInput;
  onChange: (change: Partial<CaptureInput>) => void;
  sourceOpen: boolean;
  onSourceToggle: () => void;
  saving: boolean;
  draftState: "idle" | "saving" | "saved" | "error";
  onSave: (organize: boolean) => void;
  preview?: boolean;
};

function VoiceInput({ value, onChange, disabled, preview }: { value: string; onChange: (value: string) => void; disabled: boolean; preview: boolean }) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef("");
  const finalTextRef = useRef("");
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState("");

  function toggle() {
    if (preview) { setMessage("预览不会启用麦克风"); return; }
    if (recording) { recognitionRef.current?.stop(); return; }
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) { setMessage("当前浏览器不支持语音输入，请直接输入"); return; }
    const recognition = new Constructor();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = true;
    baseTextRef.current = value.trim();
    finalTextRef.current = value.trim();
    recognition.onresult = event => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        transcript += result?.[0]?.transcript || "";
        if (result?.isFinal) finalTextRef.current = `${finalTextRef.current}${finalTextRef.current && result[0]?.transcript.trim() ? " " : ""}${result[0]?.transcript || ""}`.trimStart();
      }
      const interim = transcript.trim();
      const committed = finalTextRef.current;
      const next = `${committed}${committed && interim && !committed.endsWith(interim) ? " " : ""}${interim}`.trimStart();
      if (next) onChange(next);
    };
    recognition.onerror = event => { setRecording(false); setMessage(event.error === "not-allowed" ? "麦克风权限未开启，请允许后重试" : "没有识别到清晰语音，请重试"); };
    recognition.onend = () => { setRecording(false); recognitionRef.current = null; };
    recognitionRef.current = recognition;
    setMessage(""); setRecording(true);
    try { recognition.start(); } catch { setRecording(false); setMessage("语音输入启动失败，请直接输入"); }
  }

  return <div className="voice-input-wrap">
    <button type="button" className={`voice-pill ${recording ? "is-recording" : ""}`} aria-label={recording ? "停止语音输入" : "开始语音输入"} aria-pressed={recording} onClick={toggle} disabled={disabled}>
      <span className="voice-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>
      <span>{recording ? "正在听" : "语音"}</span>
    </button>
    {message && <span className="voice-message" role="status">{message}</span>}
  </div>;
}

export function CaptureComposer({ capture, onChange, sourceOpen, onSourceToggle, saving, draftState, onSave, preview = false }: ComposerProps) {
  const hasContent = [capture.userText, capture.sourceName, capture.sourceUrl, capture.sourceTimestamp, capture.sourceExcerpt].some(value => value.trim());
  return <section className="capture-composer" aria-label="快速记录" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing && !saving && hasContent) { event.preventDefault(); onSave(false); }
  }}>
    <div className="writing-surface">
      <label className="sr-only" htmlFor="capture-thought">我的想法</label>
      <textarea id="capture-thought" className="capture-textarea" placeholder="一句想法，一段听后感……" value={capture.userText} maxLength={20000} onChange={event => onChange({ userText: event.target.value })} disabled={saving} />
      <div className="composer-toolbar">
        <button type="button" className="source-toggle" onClick={onSourceToggle} disabled={saving} aria-expanded={sourceOpen} aria-controls="capture-source-details"><Plus size={16} className={sourceOpen ? "rotated" : ""} />{sourceOpen ? "收起来源" : "添加来源"}{!sourceOpen && (capture.sourceUrl || capture.sourceName || capture.sourceExcerpt || capture.sourceTimestamp) ? <span className="source-dot" aria-label="已有来源" /> : null}</button>
        <span className="character-count">{capture.userText.length > 0 && capture.userText.length.toLocaleString() + " 字"}</span>
      </div>
      <div id="capture-source-details" className="source-form" hidden={!sourceOpen}>
        <div className="capture-source-row"><div className="link-input"><Link2 size={16} /><label className="sr-only" htmlFor="capture-link">播客或文章链接</label><input id="capture-link" placeholder="播客或文章链接" value={capture.sourceUrl} onChange={event => onChange({ sourceUrl: event.target.value })} disabled={saving} maxLength={2048} type="url" /></div><select className="source-select" aria-label="来源类型" value={capture.sourceType} onChange={event => onChange({ sourceType: event.target.value as CaptureInput["sourceType"] })} disabled={saving}>{SOURCE_TYPES.map(type => <option key={type}>{type}</option>)}</select></div>
        <details className="source-more"><summary>补充名称、时间点或原文<ChevronDown size={13} /></summary>
          <div className="form-grid"><label className="field"><span className="field-label">来源名称</span><input className="input" placeholder="节目名或文章标题" maxLength={200} value={capture.sourceName} onChange={event => onChange({ sourceName: event.target.value })} disabled={saving} /></label><label className="field"><span className="field-label">时间点</span><input className="input" placeholder="例如 18:20" maxLength={80} value={capture.sourceTimestamp} onChange={event => onChange({ sourceTimestamp: event.target.value })} disabled={saving} /></label></div>
          <label className="field"><span className="field-label">原文或转写片段</span><textarea className="textarea" rows={4} placeholder="粘贴想保留的原文片段" maxLength={40000} value={capture.sourceExcerpt} onChange={event => onChange({ sourceExcerpt: event.target.value })} disabled={saving} /></label>
        </details><p className="small-note">链接仅作出处；AI 整理使用你提供的文字。</p>
      </div>
    </div>
    <div className="capture-footer">
      <div className="capture-footer-left"><VoiceInput value={capture.userText} onChange={value => onChange({ userText: value })} disabled={saving} preview={preview} /><span className={"draft-state " + (draftState === "error" ? "danger-text" : "")} aria-live="polite">{preview ? "预览输入不会保存" : draftState === "saving" ? "正在保存本机草稿…" : draftState === "saved" ? <><Check size={13} />草稿已留在此设备</> : draftState === "error" ? "草稿保存失败，请先复制文字" : "保存后才会进入私人灵感集"}</span></div>
      <button type="button" className="btn btn-primary capture-submit" disabled={saving || !hasContent} onClick={() => onSave(false)}>{saving ? <LoaderCircle className="spin" size={16} /> : null}{saving ? "正在保存…" : "记下"}{!saving && <ArrowUpRight size={17} />}</button>
    </div>
  </section>;
}
