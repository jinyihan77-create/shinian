"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, AudioLines, BookOpen, Check, ChevronDown, FileText, Headphones, Heart, Leaf, Lightbulb, Link2, LoaderCircle, MoonStar, MoreHorizontal, Plus, Settings2, Sparkles, Star, Video } from "lucide-react";
import type { CaptureInput, SourceIntakeResult } from "@/lib/types";
import type { CaptureKind } from "@/lib/note-context";
import { composeSpeechInput, type SpeechResultLike } from "@/lib/speech-input";
import { AeroScene } from "./aero-scene";
import { EchoHeading } from "./echo-heading";
import { TrueFocusLine } from "./true-focus-line";
import LineSidebar from "./line-sidebar";
import sidebarStyles from "./line-sidebar.module.css";

type SpeechResultEvent = { resultIndex: number; results: ArrayLike<SpeechResultLike> };
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
      <button aria-current={view === "library" || view === "note" ? "page" : undefined} onClick={() => onNavigate("library")}>回声屿</button>
    </nav>
    <div className="space-account">{status}<button className="account-button" aria-label="账号与设置" aria-current={view === "settings" ? "page" : undefined} onClick={() => onNavigate("settings")}><Settings2 size={18} /></button></div>
    <LineSidebar className={sidebarStyles.desktopRail} items={["记录", "回声屿", "设置"]} activeIndex={pages.indexOf(view === "note" ? "library" : view)}
      accentColor="#c084fc" textColor="#c4c4c4" markerColor="#6c6c6c" showIndex showMarker
      proximityRadius={100} maxShift={30} falloff="smooth" markerLength={60} markerGap={0}
      tickScale={0.5} scaleTick itemGap={20} fontSize={1.1} smoothing={100}
      onItemClick={index => onNavigate(pages[index])} />
  </header>;
}

export function MobileNav({ view, onNavigate }: { view: NavigationView | "note"; onNavigate: (view: NavigationView) => void }) {
  return <nav className="mobile-nav" aria-label="移动端主导航">
    <button className={view === "capture" ? "active" : ""} aria-current={view === "capture" ? "page" : undefined} onClick={() => onNavigate("capture")}><span aria-hidden="true">＋</span><span>记录</span></button>
    <button className={view === "library" || view === "note" ? "active" : ""} aria-current={view === "library" || view === "note" ? "page" : undefined} onClick={() => onNavigate("library")}><span aria-hidden="true">⌕</span><span>回声屿</span></button>
    <button className={view === "settings" ? "active" : ""} aria-current={view === "settings" ? "page" : undefined} onClick={() => onNavigate("settings")}><span aria-hidden="true">⋯</span><span>设置</span></button>
  </nav>;
}

const CAPTURE_PROMPTS = [
  "此刻，想记下什么？",
  "七七，今晚想留下什么？",
  "哪句话，还在心里发光？",
  "今天，什么让你停了一下？",
  "说吧，刚刚想到了什么？",
];

export function CaptureHeading({ paused = false }: { paused?: boolean }) {
  const [promptIndex, setPromptIndex] = useState(0);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (paused || motion.matches) return;
    const timer = window.setInterval(() => setPromptIndex(value => (value + 1) % CAPTURE_PROMPTS.length), 7000);
    return () => window.clearInterval(timer);
  }, [paused]);
  return <div className="capture-heading"><p className="capture-focus-kicker"><TrueFocusLine>一闪，便有回响</TrueFocusLine></p><h1 className="kinetic-heading"><span className="sr-only">此刻，想记下什么？</span><span className="capture-prompt-window" aria-hidden="true"><span className="capture-prompt-line" key={promptIndex}><EchoHeading>{CAPTURE_PROMPTS[promptIndex]}</EchoHeading></span></span></h1></div>;
}

export function CaptureSpace({ children }: { children: ReactNode }) {
  const [focused, setFocused] = useState(false);
  return <section className="capture-space" data-writing={focused}>
    <AeroScene quiet={focused} />
    <div className="capture-content" onFocusCapture={event => {
      if (event.target.matches("input, textarea, select")) setFocused(true);
    }} onBlurCapture={event => {
      if (!(event.relatedTarget instanceof Element && event.currentTarget.contains(event.relatedTarget) && event.relatedTarget.matches("input, textarea, select"))) setFocused(false);
    }}><CaptureHeading paused={focused} />{children}</div>
  </section>;
}

export function SaveStrokeMoment({ sequence, children = "已接住这一念" }: { sequence: number; children?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!sequence) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 2600);
    return () => window.clearTimeout(timer);
  }, [sequence]);
  if (!visible) return null;
  return <div className="save-stroke-moment" key={sequence} role="status">
    <span className="sr-only">{children}</span>
    <svg viewBox="0 0 760 112" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id={`save-stroke-${sequence}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ff9fc5" /><stop offset=".52" stopColor="#d8c5f0" /><stop offset="1" stopColor="#bfe5ef" /></linearGradient></defs>
      <text className="save-stroke-glow" x="380" y="75" textAnchor="middle">{children}</text>
      <text className="save-stroke-line" x="380" y="75" textAnchor="middle" stroke={`url(#save-stroke-${sequence})`}>{children}</text>
      <text className="save-stroke-fill" x="380" y="75" textAnchor="middle">{children}</text>
    </svg>
  </div>;
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
  captureKind?: CaptureKind;
  onCaptureKind?: (kind: CaptureKind) => void;
  onOpenCheckin?: () => void;
  onOrganizeSource?: (transcript: string) => Promise<SourceIntakeResult>;
  preview?: boolean;
};

function VoiceInput({ value, onChange, onCommit, disabled, preview }: { value: string; onChange: (value: string) => void; onCommit: () => void; disabled: boolean; preview: boolean }) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef("");
  const heardRef = useRef(false);
  const failedRef = useRef(false);
  const commitRef = useRef(onCommit);
  const [voiceState, setVoiceState] = useState<"idle" | "requesting" | "recording" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => { commitRef.current = onCommit; }, [onCommit]);

  useEffect(() => () => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    recognition?.stop();
  }, []);

  async function toggle() {
    if (recognitionRef.current) { recognitionRef.current.stop(); return; }
    if (voiceState === "requesting") return;
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) { setVoiceState("error"); setMessage("当前浏览器不支持语音输入，请直接输入"); return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceState("error");
      setMessage("当前浏览器无法访问麦克风，请检查浏览器和系统权限后重试");
      return;
    }
    setVoiceState("requesting");
    setMessage("请在浏览器提示中允许麦克风权限…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
    } catch (error) {
      const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
      setVoiceState("error");
      setMessage(name === "NotAllowedError" || name === "SecurityError"
        ? "麦克风权限未开启。请点击地址栏的锁形图标，允许麦克风后再试。"
        : "无法访问麦克风，请检查浏览器和系统权限后重试");
      return;
    }
    const recognition = new Constructor();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    baseTextRef.current = value.trim();
    heardRef.current = false;
    failedRef.current = false;
    recognition.onresult = event => {
      const next = composeSpeechInput(baseTextRef.current, event.results);
      if (next) { heardRef.current = true; onChange(next); }
    };
    recognition.onerror = event => {
      failedRef.current = true;
      setVoiceState("error");
      setMessage(event.error === "not-allowed"
        ? "麦克风权限未开启。请点击地址栏的锁形图标，允许麦克风后再试。"
        : "没有识别到清晰语音，请点击重试或直接输入");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (failedRef.current) { setVoiceState("error"); return; }
      setVoiceState("idle");
      if (heardRef.current && !failedRef.current && !preview) {
        setMessage("已经听见，正在替你收好…");
        queueMicrotask(() => commitRef.current());
      }
    };
    recognitionRef.current = recognition;
    setMessage(preview ? "语音只填写本次预览，不会保存" : "");
    try { recognition.start(); setVoiceState("recording"); } catch {
      recognitionRef.current = null;
      setVoiceState("error");
      setMessage("语音输入启动失败，请检查麦克风权限后重试");
    }
  }

  const recording = voiceState === "recording";
  const requesting = voiceState === "requesting";
  const hasError = voiceState === "error";
  return <div className={`voice-input-wrap ${recording ? "is-recording" : ""} ${hasError ? "has-error" : ""}`}>
    <button type="button" className={`voice-siri-dock ${recording ? "is-recording" : ""} ${requesting ? "is-requesting" : ""} ${hasError ? "is-error" : ""}`} aria-label={recording ? "停止口述记录" : requesting ? "正在请求麦克风权限" : hasError ? "麦克风权限错误，点击重试" : "开始口述记录"} aria-pressed={recording} aria-busy={requesting} onClick={() => void toggle()} disabled={disabled || requesting}>
      <span className="voice-siri-orb" aria-hidden="true"><AudioLines size={18} /><i /><i /><i /></span>
      <span className="voice-siri-copy"><strong>{recording ? "我在听" : requesting ? "正在请求权限" : hasError ? "麦克风需要权限" : "说给拾念听"}</strong><small>{recording ? "说完轻触，文字会自然落下来" : requesting ? "请在浏览器提示中允许麦克风" : hasError ? "点击重试，或检查地址栏的锁形图标" : value.trim() ? "继续口述，拾念会接着记录" : "点一下开始口述"}</small></span>
      <span className="voice-strands" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
    </button>
    {message && <span className={`voice-message ${hasError ? "is-error" : ""}`} role="status">{message}</span>}
  </div>;
}

function SourceVoiceIntake({ onChange, onOrganize, disabled, preview }: {
  onChange: (change: Partial<CaptureInput>) => void;
  onOrganize?: (transcript: string) => Promise<SourceIntakeResult>;
  disabled: boolean;
  preview: boolean;
}) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const failedRef = useRef(false);
  const mountedRef = useRef(true);
  const [recording, setRecording] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"neutral" | "success" | "error">("neutral");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      failedRef.current = true;
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      recognition?.stop();
    };
  }, []);

  async function finish(dictated: string) {
    if (preview) {
      setTone("neutral");
      setMessage("预览已收到语音；正式入口才会调用 AI 并填写来源。");
      return;
    }
    if (!onOrganize) {
      setTone("error");
      setMessage("AI 来源整理暂时不可用，原有内容没有改变。");
      return;
    }
    setOrganizing(true);
    setTone("neutral");
    setMessage("AI 正在拆分来源…");
    try {
      const result = await onOrganize(dictated);
      if (!mountedRef.current) return;
      const change: Partial<CaptureInput> = {};
      const filled: string[] = [];
      if (result.sourceType !== null) { change.sourceType = result.sourceType; filled.push("类型"); }
      if (result.sourceName !== null) { change.sourceName = result.sourceName; filled.push("名称"); }
      if (result.sourceTimestamp !== null) { change.sourceTimestamp = result.sourceTimestamp; filled.push("时间点"); }
      if (result.sourceExcerpt !== null) { change.sourceExcerpt = result.sourceExcerpt; filled.push("原话"); }
      if (!filled.length) {
        setTone("neutral");
        setMessage("我听到了，但还没找到可填写的来源信息，再说具体一点就好。");
        return;
      }
      onChange(change);
      setTone("success");
      setMessage(`已填好${filled.join("、")}，可以直接记下。`);
    } catch (error) {
      if (!mountedRef.current) return;
      setTone("error");
      setMessage(error instanceof Error ? error.message : "AI 暂时没能整理这段话，原有内容没有改变。");
    } finally {
      if (mountedRef.current) setOrganizing(false);
    }
  }

  function toggle() {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) {
      setTone("error");
      setMessage("当前浏览器不支持语音输入，可以展开下方手动补充。");
      return;
    }
    const recognition = new Constructor();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = true;
    transcriptRef.current = "";
    failedRef.current = false;
    setTranscript("");
    setMessage("");
    setTone("neutral");
    recognition.onresult = event => {
      const next = composeSpeechInput("", event.results).slice(0, 3_000);
      transcriptRef.current = next;
      setTranscript(next);
    };
    recognition.onerror = event => {
      failedRef.current = true;
      setRecording(false);
      setTone("error");
      setMessage(event.error === "not-allowed" ? "麦克风权限未开启，请允许后重试。" : "没有听清，再说一次就好。");
    };
    recognition.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
      if (failedRef.current || !mountedRef.current) return;
      const dictated = transcriptRef.current.trim();
      if (!dictated) {
        setTone("error");
        setMessage("没有听清，再说一次就好。");
        return;
      }
      void finish(dictated);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setRecording(true);
    } catch {
      recognitionRef.current = null;
      setTone("error");
      setMessage("语音输入启动失败，请稍后重试。");
    }
  }

  return <div className={`source-voice-intake ${recording ? "is-recording" : ""} ${organizing ? "is-organizing" : ""}`}>
    <button type="button" className="source-voice-trigger" onClick={toggle} disabled={disabled || organizing} aria-pressed={recording}>
      <span className="source-voice-orb" aria-hidden="true">{organizing ? <Sparkles size={20} /> : <AudioLines size={20} />}<i /><i /></span>
      <span className="source-voice-copy"><strong>{recording ? "说完了" : organizing ? "AI 正在整理" : "告诉 AI 来源"}</strong><small>{recording ? "说完轻触这里" : "这是什么？你听到了哪一句？"}</small></span>
      <span className="source-voice-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
    </button>
    {transcript && <p className="source-voice-transcript">“{transcript}”</p>}
    {message && <p className={`source-voice-message is-${tone}`} role={tone === "error" ? "alert" : "status"}>{message}</p>}
  </div>;
}

export function CaptureComposer({ capture, onChange, sourceOpen, onSourceToggle, saving, draftState, onSave, captureKind = "thought", onCaptureKind = () => {}, onOpenCheckin = () => {}, onOrganizeSource, preview = false }: ComposerProps) {
  const hasContent = [capture.userText, capture.sourceName, capture.sourceUrl, capture.sourceTimestamp, capture.sourceExcerpt].some(value => value.trim());
  const sourceOptions = [
    { value: "播客", icon: Headphones },
    { value: "文章", icon: FileText },
    { value: "书籍", icon: BookOpen },
    { value: "视频", icon: Video },
    { value: "生活", icon: Leaf },
    { value: "其他", icon: MoreHorizontal },
  ] as const;
  const linkPlaceholder = capture.sourceType === "播客" ? "粘贴节目链接" : capture.sourceType === "文章" ? "粘贴文章链接" : capture.sourceType === "书籍" ? "豆瓣、微信读书或书籍链接（选填）" : capture.sourceType === "视频" ? "粘贴视频链接" : "添加相关链接（选填）";
  return <section className="capture-composer" aria-label="快速记录" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing && !saving && hasContent) { event.preventDefault(); onSave(true); }
  }}>
    <div className="writing-surface">
      <button type="button" className="capture-star-shortcut capture-star-primary" onClick={onOpenCheckin} disabled={saving} title="摘下今天的星" aria-label="摘下今天的星"><Star size={16} /><span>摘星</span></button>
      <label className="sr-only" htmlFor="capture-thought">我的想法</label>
      <textarea id="capture-thought" className="capture-textarea" placeholder="一句想法，一段听后感……" value={capture.userText} maxLength={20000} onChange={event => onChange({ userText: event.target.value })} disabled={saving} />
      <VoiceInput value={capture.userText} onChange={value => onChange({ userText: value })} onCommit={() => onSave(true)} disabled={saving} preview={preview} />
      <div className="capture-kind" role="radiogroup" aria-label="这条记录放在哪里">
        <span>放在哪里</span>
        <button type="button" role="radio" aria-checked={captureKind === "thought"} onClick={() => onCaptureKind("thought")} disabled={saving}><Lightbulb size={14} />普通念头</button>
        <button type="button" role="radio" aria-checked={captureKind === "moment"} onClick={() => onCaptureKind("moment")} disabled={saving}><MoonStar size={14} />今日片刻</button>
        <button type="button" role="radio" aria-checked={captureKind === "relationship"} onClick={() => onCaptureKind("relationship")} disabled={saving}><Heart size={14} />和 TA</button>
      </div>
      <div className="composer-toolbar">
        <button type="button" className="source-toggle" onClick={onSourceToggle} disabled={saving} aria-expanded={sourceOpen} aria-controls="capture-source-details"><Plus size={16} className={sourceOpen ? "rotated" : ""} />{sourceOpen ? "收起来源" : "添加来源"}{!sourceOpen && (capture.sourceUrl || capture.sourceName || capture.sourceExcerpt || capture.sourceTimestamp) ? <span className="source-dot" aria-label="已有来源" /> : null}</button>
        <span className="character-count">{capture.userText.length > 0 && capture.userText.length.toLocaleString() + " 字"}</span>
      </div>
      <div id="capture-source-details" className="source-form" hidden={!sourceOpen}>
        <SourceVoiceIntake onChange={onChange} onOrganize={onOrganizeSource} disabled={saving} preview={preview} />
        <details className="source-more"><summary><span>检查或微调</span><span className="source-summary-value">{capture.sourceName || capture.sourceType}</span><ChevronDown size={13} /></summary>
          <div className="source-type-field"><span>这条灵感来自</span><div className="source-type-grid" role="radiogroup" aria-label="来源类型">{sourceOptions.map(({ value, icon: Icon }) => <button key={value} type="button" role="radio" aria-checked={capture.sourceType === value} onClick={() => onChange({ sourceType: value })} disabled={saving}><Icon size={15} strokeWidth={1.6} /><span>{value}</span></button>)}</div></div>
          <div className="capture-source-row"><div className="link-input"><Link2 size={16} /><label className="sr-only" htmlFor="capture-link">来源链接</label><input id="capture-link" placeholder={linkPlaceholder} value={capture.sourceUrl} onChange={event => onChange({ sourceUrl: event.target.value })} disabled={saving} maxLength={2048} type="url" /></div><span className="source-current">{capture.sourceType}</span></div>
          <div className="form-grid"><label className="field"><span className="field-label">来源名称</span><input className="input" placeholder="节目名或文章标题" maxLength={200} value={capture.sourceName} onChange={event => onChange({ sourceName: event.target.value })} disabled={saving} /></label><label className="field"><span className="field-label">时间点</span><input className="input" placeholder="例如 18:20" maxLength={80} value={capture.sourceTimestamp} onChange={event => onChange({ sourceTimestamp: event.target.value })} disabled={saving} /></label></div>
          <label className="field"><span className="field-label">原文或转写片段</span><textarea className="textarea" rows={4} placeholder="粘贴想保留的原文片段" maxLength={40000} value={capture.sourceExcerpt} onChange={event => onChange({ sourceExcerpt: event.target.value })} disabled={saving} /></label>
        </details><p className="small-note">AI 只整理你刚刚说出的内容，不读取链接正文。</p>
      </div>
    </div>
    <div className="capture-footer">
      <div className="capture-footer-left"><span className={"draft-state " + (draftState === "error" ? "danger-text" : "")} aria-live="polite">{preview ? "预览输入不会保存" : draftState === "saving" ? "正在保存本机草稿…" : draftState === "saved" ? <><Check size={13} />草稿已留在此设备</> : draftState === "error" ? "草稿保存失败，请先复制文字" : "保存后会进入你的回声屿"}</span></div>
      <button type="button" className="btn btn-primary capture-submit" disabled={saving || !hasContent} onClick={() => onSave(true)}>{saving ? <LoaderCircle className="spin" size={16} /> : null}{saving ? "正在收好…" : "记下"}{!saving && <ArrowUpRight size={17} />}</button>
    </div>
  </section>;
}
