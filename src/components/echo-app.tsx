"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCircle2, ChevronDown, CircleHelp, FileJson, FileText, Headphones, Leaf, Library, Link2, LoaderCircle, LockKeyhole, MessageCircle, Plus, Search, ShieldCheck, Sparkles, Upload, X } from "lucide-react";
import { repository, RepositoryError } from "@/lib/repository";
import { createBackup, inspectBackup, MAX_BACKUP_BYTES, parseBackup, splitBackup, toMarkdown } from "@/lib/backup";
import { InspirationCollection } from "./inspiration-collection";
import { createExamples } from "@/lib/examples";
import { emptyCapture, SOURCE_TYPES, type AiServiceStatus, type Backup, type CaptureInput, type EchoNote, type TicketAnalysis, type TicketPool, type TicketSuggestion } from "@/lib/types";
import { NoteDetail } from "./note-detail";
import { CaptureComposer, CaptureSpace, MobileNav, SpaceHeader } from "./studio-ui";
import { CheckinPanel } from "./checkin-panel";
import type { LibraryFilter } from "@/lib/search";
import { taskStatus, ticketPool, type TaskAction } from "@/lib/task-tickets";
import { captureContextTags, isCaptureKind, type CaptureKind } from "@/lib/note-context";

type View = "capture" | "library" | "settings" | "note";
type Tone = "success" | "error" | "info";
type Filter = LibraryFilter;
const storageMessage = "点击保存后，资料写入你的私人回声屿。手机和电脑登录同一账号即可同步；未提交的草稿只留在当前设备。";
const aiDefault: AiServiceStatus = { configured: false, available: false, requiresUnlock: false, message: "正在检查 AI 服务…" };
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "操作暂时失败，请再试一次。"; }
function hasContent(input: CaptureInput) { return [input.userText, input.sourceName, input.sourceUrl, input.sourceTimestamp, input.sourceExcerpt].some(v => v.trim()); }
function downloadFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function EchoMark({ small = false }: { small?: boolean }) {
  return <span className={`echo-mark ${small ? "small" : ""}`} aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M14 12c-10 4-10 12 0 16M21 7C4 13 4 27 21 33M27 12c10 4 10 12 0 16M21 16v8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></span>;
}

export function EchoApp({ user, paused, onLogout }: { user: { id: string; email: string }; paused: boolean; onLogout: () => Promise<void> }) {
  const [view, setView] = useState<View>("capture");
  const [noteId, setNoteId] = useState<string | null>(null);
  const [notes, setNotes] = useState<EchoNote[]>([]);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState("");
  const [capture, setCapture] = useState<CaptureInput>(emptyCapture());
  const [captureKind, setCaptureKind] = useState<CaptureKind>("thought");
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: Tone } | null>(null);
  const [aiStatus, setAiStatus] = useState<AiServiceStatus>(aiDefault);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [passwordCapability, setPasswordCapability] = useState<{ requiresVerification: boolean; verificationAvailable: boolean; message: string } | null>(null);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [syncState, setSyncState] = useState<"loading" | "synced" | "error">("loading");
  const [lastSync, setLastSync] = useState("");
  const [backupParts, setBackupParts] = useState<Backup[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<"created" | "updated">("created");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [importPreview, setImportPreview] = useState<Backup | null>(null);
  const [importError, setImportError] = useState("");
  const [invalidCount, setInvalidCount] = useState(0);
  const saveLock = useRef(false);
  const draftWrites = useRef<Promise<void>>(Promise.resolve());
  const draftTimer = useRef<number | null>(null);
  const pendingDraft = useRef<CaptureInput | null>(null);
  const draftVersion = useRef(0);
  const inFlight = useRef(new Set<string>());
  const currentHash = useRef("");
  const importRef = useRef<HTMLInputElement>(null);
  const syncSequence = useRef(0);
  const selectedSnapshot = useRef<EchoNote | null>(null);
  const booted = useRef(false);
  const booting = useRef(false);

  const notify = useCallback((message: string, tone: Tone = "success") => setToast({ message, tone }), []);
  const reload = useCallback(async () => {
    const sequence = ++syncSequence.current;
    setSyncState("loading");
    try {
      const latest = await repository.list();
      if (sequence !== syncSequence.current) return;
      setNotes(latest); setLastSync(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })); setSyncState("synced");
    } catch (error) { if (sequence === syncSequence.current) setSyncState("error"); throw error; }
  }, []);
  const onUpdated = useCallback(async (note?: EchoNote, deletedId?: string) => {
    ++syncSequence.current;
    if (note) setNotes(current => [note, ...current.filter(item => item.id !== note.id)]);
    if (deletedId) { setNotes(current => current.filter(item => item.id !== deletedId)); if (selectedSnapshot.current?.id === deletedId) selectedSnapshot.current = null; }
    void reload().catch(() => notify(note || deletedId ? "操作已由云端确认，但列表暂未刷新。请稍后点击同步。" : "列表暂未刷新，请稍后点击同步。", "info"));
  }, [reload, notify]);
  const refreshAi = useCallback(async () => {
    try {
      const response = await fetch("/api/status", { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error();
      const next = await response.json() as AiServiceStatus; setAiStatus(next); return next;
    } catch {
      const unavailable = { configured: false, available: false, requiresUnlock: false, message: "AI 服务暂不可用，仍可记录和检索。" };
      setAiStatus(unavailable); return unavailable;
    }
  }, []);
  async function transitionTask(note: EchoNote, action: TaskAction) {
    if (paused) throw new Error("账号当前暂停写入，请稍后再试。");
    const saved = await repository.updateTask(note, action);
    await onUpdated(saved);
    setFilter(action === "complete" ? "arrival" : action === "dismiss" ? "all" : "departure");
    notify(action === "complete" ? "这张行动票已经盖章。" : action === "reopen" ? "已重新放回行动票。" : action === "dismiss" ? "已经改回普通记录，不再作为行动提醒。" : action === "queue" ? "已经收进行动票。" : "已经开始这一步，进度已保存。");
  }
  async function queueRecommendation(note: EchoNote, analysis: TicketAnalysis, suggestion: TicketSuggestion, pool: TicketPool) {
    if (paused) throw new Error("账号当前暂停写入，请稍后再试。");
    if (pool === "recurring" && ticketPool(note) !== "recurring" && notes.filter(item => ticketPool(item) === "recurring" && ["pending", "active"].includes(taskStatus(item))).length >= 3) {
      throw new Error("周期行动池每天最多保留 3 张，先完成或移出一张再加入新的。");
    }
    const saved = await repository.updateTicket(note, pool === "waiting" ? "hold" : "queue", {
      pool, durationMinutes: suggestion.durationMinutes, resistance: suggestion.resistance,
      cadence: analysis.cadence, prerequisite: analysis.prerequisite,
    });
    await onUpdated(saved);
    setFilter(pool === "waiting" ? "all" : "departure");
    notify(pool === "waiting" ? "已放入等待清单，前置条件满足后再回来。" : pool === "recurring" ? "已加入周期行动池，之后可以重复抽取。" : "已加入单次行动池，准备好时再抽一张。", "success");
  }
  const deleteNotes = useCallback(async (targets: EchoNote[]) => {
    if (paused) throw new Error("账号当前暂停写入，请稍后再试。");
    const deletedIds: string[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const note of targets) {
      try {
        await repository.remove(note.id, note.storageVersion);
        deletedIds.push(note.id);
      } catch (error) {
        failed.push({ id: note.id, message: errorMessage(error) });
      }
    }
    if (deletedIds.length) {
      const deleted = new Set(deletedIds);
      ++syncSequence.current;
      setNotes(current => current.filter(note => !deleted.has(note.id)));
      if (selectedSnapshot.current && deleted.has(selectedSnapshot.current.id)) selectedSnapshot.current = null;
      void reload().catch(() => notify("删除已由云端确认，但列表暂未刷新。请稍后点击同步。", "info"));
      notify(failed.length ? `已删除 ${deletedIds.length} 条，另有 ${failed.length} 条被保留。` : `已删除 ${deletedIds.length} 条记录。`);
    }
    return { deletedIds, failed };
  }, [paused, reload, notify]);
  const bootstrap = useCallback(async () => {
    if (booting.current) return;
    booting.current = true;
    setBootError("");
    try {
      await repository.init();
      const [allNotes, draft, seen, lastType, lastKind] = await Promise.all([repository.list(), repository.getDraft(), repository.getPreference("storageNoticeSeen"), repository.getPreference("sourceType"), repository.getPreference("captureKind")]);
      setNotes(allNotes); setSyncState("synced"); setLastSync(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
      const initial = draft ?? emptyCapture(SOURCE_TYPES.includes(lastType as typeof SOURCE_TYPES[number]) ? lastType as typeof SOURCE_TYPES[number] : "播客");
      setCapture(initial); setSourceOpen(Boolean(initial.sourceExcerpt || initial.sourceName || initial.sourceTimestamp));
      setCaptureKind(isCaptureKind(lastKind) ? lastKind : "thought");
      setDraftState(draft && hasContent(draft) ? "saved" : "idle"); setNoticeVisible(!seen); booted.current = true; setReady(true);
    } catch (error) { setSyncState("error"); setBootError(errorMessage(error)); }
    finally { booting.current = false; }
  }, []);

  useEffect(() => {
    if (paused) { ++syncSequence.current; return; }
    if (!booted.current) void bootstrap(); else void reload().catch(() => {});
    void refreshAi();
  }, [paused, bootstrap, refreshAi, reload]);
  useEffect(() => {
    function applyHash(hash: string) {
      currentHash.current = hash;
      if (hash.startsWith("note/")) { setView("note"); setNoteId(hash.slice(5)); }
      else { setView(hash === "library" || hash === "settings" ? hash : "capture"); setNoteId(null); }
    }
    function syncHash() {
      const hash = window.location.hash.slice(1);
      const proceed = () => { window.history.replaceState(null, "", `#${hash}`); applyHash(hash); };
      if (currentHash.current && hash !== currentHash.current && !window.dispatchEvent(new CustomEvent("echo:before-navigate", { cancelable: true, detail: { proceed } }))) {
        window.history.replaceState(null, "", `#${currentHash.current}`);
        return;
      }
      applyHash(hash);
    }
    syncHash(); window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.tone === "error" ? 9000 : 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => () => {
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
  }, []);
  useEffect(() => {
    if (!ready || paused) return;
    let refreshing = false;
    const refresh = () => { if (!document.hidden && !refreshing) { refreshing = true; void reload().catch(() => {}).finally(() => { refreshing = false; }); } };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [ready, paused, reload]);

  function navigate(next: View, id?: string) {
    const hash = next === "note" ? `note/${id}` : next;
    if (currentHash.current === hash) return;
    const proceed = () => {
      currentHash.current = hash;
      window.location.hash = hash; setView(next); setNoteId(id ?? null); window.scrollTo({ top: 0, behavior: "instant" });
      document.querySelector<HTMLElement>(".main-wrap")?.scrollTo({ top: 0, behavior: "instant" });
    };
    if (!window.dispatchEvent(new CustomEvent("echo:before-navigate", { cancelable: true, detail: { proceed } }))) return;
    proceed();
  }
  async function flushDraft() {
    if (draftTimer.current !== null) { window.clearTimeout(draftTimer.current); draftTimer.current = null; }
    const next = pendingDraft.current;
    if (!next) return draftWrites.current;
    pendingDraft.current = null;
    const version = draftVersion.current;
    draftWrites.current = draftWrites.current.catch(() => {}).then(() => repository.saveDraft(next)).then(() => {
      if (version === draftVersion.current) setDraftState(hasContent(next) ? "saved" : "idle");
    }).catch(() => { if (version === draftVersion.current) setDraftState("error"); });
    return draftWrites.current;
  }
  function updateCapture(patch: Partial<CaptureInput>) {
    const next = { ...capture, ...patch }; setCapture(next); setDraftState("saving");
    ++draftVersion.current;
    pendingDraft.current = next;
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => { void flushDraft(); }, 280);
  }
  function updateCaptureKind(next: CaptureKind) {
    setCaptureKind(next);
    void repository.setPreference("captureKind", next).catch(() => notify("记录去向会用于本次保存，但暂时无法记住这个偏好。", "info"));
  }
  async function dismissNotice() {
    setNoticeVisible(false);
    try { await repository.setPreference("storageNoticeSeen", "true"); } catch { /* This preference does not affect stored notes. */ }
  }
  async function organize(note: EchoNote) {
    if (inFlight.current.has(note.id)) return;
    if (!note.userText.trim() && !note.sourceExcerpt.trim()) { notify("只有来源信息，还需要补充一点想法或原文。", "info"); return; }
    inFlight.current.add(note.id);
    try {
      const status = await refreshAi();
      if (!status.available) { notify(status.message || "AI 整理尚未配置，你的记录已保存。", "info"); return; }
      setNotes(current => current.map(item => item.id === note.id ? { ...item, aiStatus: "processing" } : item));
      const result = await repository.organize(note.id, note.revision);
      await onUpdated(result.note);
      notify(result.applied ? taskStatus(result.note) === "pending" ? "已经收好，也从里面听见了一件可以做的事。行动票已放进回声屿。" : "已经收好。它会安静地留在回声屿，等你以后回来。" : "内容已更新，这次结果未覆盖新内容，请重新整理。", result.applied ? "success" : "info");
    } catch (error) {
      notify(errorMessage(error), error instanceof RepositoryError && error.code === "AI_SAVED_REFRESH_FAILED" ? "info" : "error");
    } finally { inFlight.current.delete(note.id); await reload().catch(() => {}); }
  }
  async function saveCapture(withAi: boolean) {
    if (saveLock.current || !hasContent(capture)) return;
    saveLock.current = true; setSaving(true);
    try {
      await flushDraft();
      await draftWrites.current;
      const note = await repository.create(capture, captureContextTags(captureKind));
      ++draftVersion.current; pendingDraft.current = null; setCapture(emptyCapture(capture.sourceType)); setDraftState("idle"); setSourceOpen(false);
      await onUpdated(note); notify(withAi ? "已经收好，正在听里面有没有一件想做的事…" : captureKind === "relationship" ? "已经收进今天，也留在你和 TA 的片刻里。" : captureKind === "moment" ? "已经收进今天的片刻。" : "已保存到云端，今天的星也在下方等你。");
      if (withAi) void organize(note);
    } catch (error) {
      const previousSaved = error instanceof RepositoryError && error.code === "PREVIOUS_SUBMISSION_SAVED";
      if (previousSaved) void reload().catch(() => {});
      notify(errorMessage(error), previousSaved ? "info" : "error");
    }
    finally { saveLock.current = false; setSaving(false); }
  }
  async function changePassword(event: React.FormEvent) {
    event.preventDefault(); if (accountBusy) return; setAccountBusy(true);
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json", "x-echo-user-id": user.id }, body: JSON.stringify({ currentPassword, newPassword, ...(passwordCapability?.requiresVerification ? { verificationCode } : {}) }), signal: AbortSignal.timeout(20000) });
      const body = await response.json();
      if (response.status === 401) window.dispatchEvent(new Event("echo:session-expired"));
      if (!response.ok || body.success !== true) throw new Error(body.error || "密码修改尚未确认成功，请重试。");
      setCurrentPassword(""); setNewPassword(""); setVerificationCode(""); notify("密码已修改，请使用新密码登录。");
    } catch (error) { notify(errorMessage(error), "error"); } finally { setAccountBusy(false); }
  }
  async function loadPasswordCapability() {
    setPasswordMessage(""); setPasswordCapability(null);
    try {
      const response = await fetch("/api/auth/password", { headers: { "x-echo-user-id": user.id }, cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (!response.ok || typeof body.requiresVerification !== "boolean" || typeof body.verificationAvailable !== "boolean") throw new Error(body.error || "暂时无法检查密码服务，请重试。");
      setPasswordCapability(body);
    } catch (error) { setPasswordMessage(errorMessage(error)); }
  }
  async function sendPasswordCode() {
    if (sendingCode) return;
    setSendingCode(true); setPasswordMessage("");
    try {
      const response = await fetch("/api/auth/password/verify", { method: "POST", headers: { "Content-Type": "application/json", "x-echo-user-id": user.id }, body: "{}", signal: AbortSignal.timeout(20000) });
      const body = await response.json();
      if (!response.ok || body.success !== true) throw new Error(body.error || "验证码发送尚未确认成功，请稍后再试。");
      setPasswordMessage(body.message);
    } catch (error) { setPasswordMessage(errorMessage(error)); }
    finally { setSendingCode(false); }
  }
  function requestLogout() {
    const proceed = () => {
      setAccountBusy(true);
      void (async () => {
        await flushDraft();
        await draftWrites.current;
        // Confirm the latest capture is recoverable before unmounting the page.
        if (hasContent(capture)) await repository.saveDraft(capture);
        await onLogout();
      })().catch(error => notify(errorMessage(error), "error")).finally(() => setAccountBusy(false));
    };
    if (window.dispatchEvent(new CustomEvent("echo:before-navigate", { cancelable: true, detail: { proceed } }))) proceed();
  }
  async function previewLegacy() {
    setSettingsBusy(true); setImportError(""); setInvalidCount(0);
    try {
      const legacy = await repository.getLegacyNotes();
      if (!legacy.length) { notify("当前浏览器没有旧版本资料。", "info"); return; }
      if (new TextEncoder().encode(JSON.stringify({ notes: legacy })).byteLength > 4 * 1024 * 1024) {
        setBackupParts(splitBackup(legacy)); setImportPreview(null);
        notify("旧版资料较多，已准备分份备份，请逐个下载后恢复到云端。", "info"); return;
      }
      setImportPreview(createBackup(legacy));
      notify(`找到 ${legacy.length} 条旧资料，确认后才会导入私人云端。`, "info");
    } catch (error) { notify(errorMessage(error), "error"); }
    finally { setSettingsBusy(false); }
  }
  async function exportData(markdown: boolean) {
    setSettingsBusy(true);
    try {
      const current = await repository.list(); const now = new Date();
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      if (!markdown) {
        const parts = splitBackup(current);
        if (parts.length > 1) { setBackupParts(parts); notify(`已准备 ${parts.length} 份备份，请逐个下载。`, "info"); return; }
        setBackupParts([]);
        downloadFile(`拾念-${stamp}.json`, JSON.stringify(parts[0]), "application/json;charset=utf-8");
      } else downloadFile(`拾念-${stamp}.md`, toMarkdown(current), "text/markdown;charset=utf-8");
      notify(markdown ? "已导出阅读版文件。" : "已导出完整备份，请妥善保存。");
    } catch (error) { notify(errorMessage(error), "error"); } finally { setSettingsBusy(false); }
  }
  async function previewImport(file?: File) {
    setImportPreview(null); setImportError(""); setInvalidCount(0); if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("备份文件超过 25MB，请使用较小的备份文件。");
      const parsed = parseBackup(await file.text());
      if (!parsed.backup) { setInvalidCount(parsed.invalidCount); throw new Error(parsed.error || "这个文件不是有效的拾念备份。"); }
      if (new TextEncoder().encode(JSON.stringify({ notes: parsed.backup.notes })).byteLength > 4 * 1024 * 1024) {
        setBackupParts(splitBackup(parsed.backup.notes));
        throw new Error("这份备份超过单次云端恢复上限，已在下方拆成较小的完整备份。请逐份下载后恢复，原有资料未修改。");
      }
      await reload(); setImportPreview(parsed.backup);
    } catch (error) { setImportError(errorMessage(error)); }
    finally { if (importRef.current) importRef.current.value = ""; }
  }
  async function confirmImport() {
    if (!importPreview || settingsBusy) return; setSettingsBusy(true);
    try {
      const count = await repository.importNotes(importPreview.notes); setImportPreview(null); await onUpdated();
      notify(`恢复完成，新增 ${count} 条记录，重复资料已跳过。`);
    } catch (error) { notify(errorMessage(error), "error"); } finally { setSettingsBusy(false); }
  }
  async function loadExamples() {
    if (settingsBusy) return; setSettingsBusy(true);
    try { const count = await repository.importNotes(createExamples()); await onUpdated(); notify(count ? `已加入 ${count} 条演示资料。` : "演示资料已经在回声屿里了。"); navigate("library"); }
    catch (error) { notify(errorMessage(error), "error"); } finally { setSettingsBusy(false); }
  }

  const cloudSelected = notes.find(note => note.id === noteId);
  if (cloudSelected) selectedSnapshot.current = cloudSelected;
  const selected = cloudSelected ?? (selectedSnapshot.current?.id === noteId ? selectedSnapshot.current : undefined);
  const syncLabel = syncState === "loading" ? "正在同步…" : syncState === "error" ? "同步中断，点此重试" : `已同步 ${lastSync}`;
  const recent = useMemo(() => [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), [notes]);
  const previewCounts = importPreview ? inspectBackup(importPreview, notes) : null;
  return <div className="app-shell">
    <SpaceHeader view={view} onNavigate={navigate} status={<button className={"sync-indicator " + (syncState === "error" ? "danger-text" : "")} title={syncLabel} aria-label={syncLabel} disabled={syncState === "loading"} onClick={() => void reload().catch(error => notify(errorMessage(error), "error"))}><span className={"sync-dot " + syncState} /><span>{syncState === "error" ? "同步中断" : syncState === "loading" ? "同步中" : "已同步"}</span></button>} />
    <div className="main-wrap">
      <main className={`main-content ${view === "capture" ? "capture-page" : ""}`}>
        {!ready ? <div className="panel loading-panel">{bootError ? <><CircleHelp size={32} /><h2>回声屿暂时无法打开</h2><p>{bootError}</p><button className="btn btn-primary" onClick={() => void bootstrap()}>重新尝试</button></> : <><LoaderCircle className="spin" size={28} /><p>正在打开你的回声屿…</p></>}</div> : <>
          {view === "capture" && <CaptureSpace>
            <CaptureComposer capture={capture} onChange={updateCapture} sourceOpen={sourceOpen} onSourceToggle={() => setSourceOpen(!sourceOpen)} saving={saving} draftState={draftState} onSave={organize => void saveCapture(organize)} captureKind={captureKind} onCaptureKind={updateCaptureKind} onOrganizeSource={transcript => repository.organizeSource({ transcript, currentSourceType: capture.sourceType })} />
            <CheckinPanel key={`capture-${user.id}`} userId={user.id} notes={notes} accountPaused={paused} compact />
            {recent[0] && <button className="last-thought" onClick={() => navigate("note", recent[0].id)}><span>上一次记下</span><span>{recent[0].title}</span><ArrowUpRight size={14} /></button>}
          </CaptureSpace>}

          {view === "library" && <InspirationCollection
            notes={notes} query={query} filter={filter} tag={tag} sort={sort}
            onQuery={setQuery} onFilter={setFilter} onTag={setTag} onSort={setSort}
            onCreate={() => navigate("capture")} onOpen={note => navigate("note", note.id)} onTransition={transitionTask}
            onDeletePlan={command => repository.planDeletion(command)} onBulkDelete={deleteNotes} deleteDisabled={paused}
          />}

          {view === "note" && (selected ? <>{!cloudSelected && <p className="inline-notice error-notice" role="alert">这条记录已不在最新云端列表中，可能已在另一设备删除。当前输入仍保留，请先复制需要的内容。</p>}<NoteDetail key={selected.id} note={selected} onBack={() => navigate("library")} onUpdated={onUpdated} onOrganize={organize} onQueueRecommendation={queueRecommendation} onNotify={notify} /></> : <div className="panel empty-state"><BookOpen size={30} /><h2>这条记录不在当前回声屿中</h2><p>它可能已被删除，请检查登录账号或刷新资料库。</p><button className="btn btn-secondary" onClick={() => navigate("library")}><ArrowLeft size={15} />返回回声屿</button></div>)}

          {view === "settings" && <>
            <div className="page-heading"><h1>账号与设置</h1></div>
            <section className="panel settings-panel settings-storage">
              <div className="settings-heading"><div className="settings-icon"><ShieldCheck size={22} /></div><div><h2>你的资料，安心保存</h2><p>云端已有 <strong>{notes.length}</strong> 条记录</p></div><span className="chip">已同步</span></div>
              <p className="settings-description">{storageMessage}</p>
              <button className="backup-action backup-primary" disabled={settingsBusy} onClick={() => void exportData(false)}><FileJson size={25} /><span><strong>导出完整备份</strong><small>下载一份可以恢复的完整资料</small></span><ArrowDownToLine size={18} /></button>
              <details className="backup-more"><summary>更多资料管理 <ChevronDown size={15} /></summary><div className="backup-actions"><button className="backup-action" disabled={settingsBusy} onClick={() => importRef.current?.click()}><Upload size={22} /><span><strong>从备份恢复</strong><small>先检查文件，不会覆盖已有记录</small></span><ArrowRight size={16} /></button><button className="backup-action" disabled={settingsBusy} onClick={() => void exportData(true)}><FileText size={22} /><span><strong>导出阅读版</strong><small>生成便于阅读的 Markdown 文件</small></span><ArrowDownToLine size={16} /></button></div><button className="text-button" disabled={settingsBusy} onClick={() => void previewLegacy()}>检查此浏览器的旧版资料<ArrowRight size={14} /></button><p className="small-note">单次恢复最多 4 MB；较大的资料库会自动拆分。</p></details>
              <input ref={importRef} className="sr-only" tabIndex={-1} type="file" accept=".json,application/json" aria-label="选择 JSON 备份" onChange={e => void previewImport(e.target.files?.[0])} />
              {backupParts.length > 0 && <div className="import-preview"><h3>完整备份共 {backupParts.length} 份</h3><p>请逐个下载并保留全部文件；每份都可以独立恢复。</p><div className="actions">{backupParts.map((part, index) => <button className="btn btn-secondary" key={index} onClick={() => downloadFile(`拾念-${part.exportedAt.slice(0, 10)}-${index + 1}共${backupParts.length}份.json`, JSON.stringify(part), "application/json;charset=utf-8")}>下载第 {index + 1} 份（{part.notes.length} 条）</button>)}</div></div>}
              {importError && <div className="inline-notice error-notice" role="alert"><strong>备份未导入</strong><p>{importError}</p><small>无效记录：{invalidCount} 条。已有资料未修改。</small></div>}
              {importPreview && previewCounts && <div className="import-preview"><h3>备份检查完成</h3><p>新增 <strong>{previewCounts.added}</strong> 条 · 重复 <strong>{previewCounts.duplicates}</strong> 条 · 无效 <strong>{previewCounts.invalid}</strong> 条</p><p className="small-note">同一编号的记录默认跳过，已有资料会保留。</p><div className="actions"><button className="btn btn-secondary" onClick={() => setImportPreview(null)} disabled={settingsBusy}>取消</button><button className="btn btn-primary" onClick={() => void confirmImport()} disabled={settingsBusy}>{settingsBusy && <LoaderCircle size={15} className="spin" />}确认恢复</button></div></div>}
            </section>
            <section className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><LockKeyhole size={21} /></div><div><h2>私人账号</h2><p className="account-email">{user.email}</p></div><button className="btn btn-secondary account-logout" disabled={accountBusy} onClick={requestLogout}>退出登录</button></div><p className="settings-description">手机和电脑使用同一邮箱及密码登录。退出后，云端资料仍在；当前设备的捕捉草稿会在原账号重新登录后恢复。</p><details className="password-settings" onToggle={event => { if (event.currentTarget.open) void loadPasswordCapability(); }}><summary>修改账号密码</summary><form onSubmit={e => void changePassword(e)}><p className="small-note">{passwordCapability?.message || "正在检查密码修改服务…"}</p><div className="form-grid"><label className="field"><span className="field-label">当前密码</span><input className="input" type="password" autoComplete="current-password" required maxLength={256} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label><label className="field"><span className="field-label">新密码（至少 12 位）</span><input className="input" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label></div>{passwordCapability?.requiresVerification && <><p className="small-note">新密码须为 12–64 位，含大写字母、小写字母、数字和特殊字符。</p><label className="field"><span className="field-label">验证码</span><input className="input" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{4,8}" maxLength={8} value={verificationCode} onChange={e => setVerificationCode(e.target.value)} /></label><button type="button" className="btn btn-secondary" disabled={sendingCode || !passwordCapability.verificationAvailable} onClick={() => void sendPasswordCode()}>{sendingCode ? "正在发送…" : "获取验证码"}</button></>}{passwordMessage && <p className="inline-notice" role="status">{passwordMessage}</p>}{!passwordCapability && <button type="button" className="btn btn-secondary" onClick={() => void loadPasswordCapability()}>重新检查</button>}<button className="btn btn-primary" disabled={accountBusy || !passwordCapability?.verificationAvailable}>{accountBusy && <LoaderCircle size={15} className="spin" />}保存新密码</button></form></details></section>
            <section className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><Sparkles size={21} /></div><div><h2>AI 整理</h2><p>{aiStatus.message}</p></div><span className={`chip ${aiStatus.available ? "chip-green" : ""}`}>{aiStatus.available ? "已配置" : aiStatus.configured ? "暂不可用" : "未配置"}</span></div><p className="settings-description">每次“记下”后，这条记录的文字会交给 AI 整理，并判断其中是否有明确想做的事。AI 只会生成行动建议或清理候选；来源链接不会自动读取正文，删除仍必须由你确认。</p><p className="small-note">AI 未配置时，记录、搜索、自己的输出和备份都能正常使用。服务配置方法见项目使用说明。</p><div className="actions settings-footer"><button className="btn btn-secondary" onClick={() => void refreshAi()}>重新检查</button></div></section>
            <section className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><Leaf size={22} /></div><div><h2>先看看一条灵感的样子</h2><p>加入 3 条明确标记的演示资料，体验记录与检索。</p></div></div><button className="btn btn-secondary" onClick={() => void loadExamples()} disabled={settingsBusy}><Plus size={16} />加载示例资料</button><p className="small-note demo-note">示例没有真实节目出处，也不代表实际 AI 生成；可以随时逐条删除。</p></section>
            <div className="page-footnote"><EchoMark small /><span>拾念 · 一个慢慢长大的第二大脑</span></div>
          </>}
        </>}
      </main>
    </div>
    <MobileNav view={view} onNavigate={next => navigate(next)} />
    {toast && <div className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.tone === "success" ? <CheckCircle2 size={18} /> : <CircleHelp size={18} />}<span>{toast.message}</span><button className="icon-button" onClick={() => setToast(null)} aria-label="关闭提示"><X size={15} /></button></div>}

  </div>;
}

