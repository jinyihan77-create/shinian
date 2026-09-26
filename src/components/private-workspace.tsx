"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Cloud, KeyRound, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, UserPlus } from "lucide-react";
import { repository } from "@/lib/repository";
import type { PrivateSession } from "@/lib/types";
import { EchoApp } from "./echo-app";
import { EchoHeading } from "./echo-heading";
import { EchoAura, EchoSymbol } from "./studio-ui";


export function PrivateWorkspace() {
  const [session, setSession] = useState<PrivateSession | null>(null);
  const [activeUser, setActiveUser] = useState<PrivateSession["user"]>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const acceptSession = useCallback((next: PrivateSession) => {
    if (next.authenticated && next.user?.id && next.user.email) {
      repository.setUser(next.user.id); setActiveUser(next.user);
    } else { repository.setUser(null); }
    setSession(next);
  }, []);

  const checkSession = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "暂时无法验证登录状态，请稍后再试。");
      if (typeof body.configured !== "boolean" || typeof body.authenticated !== "boolean") throw new Error("账号服务返回异常，暂时无法登录。");
      acceptSession(body);
    } catch (err) { setError(err instanceof Error ? err.message : "连接账号服务失败，请检查网络。"); }
    finally { setLoading(false); }
  }, [acceptSession]);

  useEffect(() => { void checkSession(); }, [checkSession]);
  useEffect(() => {
    const expired = () => {
      repository.setUser(null);
      setSession({ configured: true, authenticated: false, user: null, message: "登录已过期，请重新登录。" });
      setError("登录已过期。此页面尚未保存的输入会保留，请重新登录原账号后继续。");
    };
    window.addEventListener("echo:session-expired", expired);
    return () => window.removeEventListener("echo:session-expired", expired);
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault(); if (submitting) return;
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password }), signal: AbortSignal.timeout(20000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "登录未成功，请稍后重试。");
      if (body.authenticated !== true || !body.user?.id || !body.user?.email) throw new Error("账号服务尚未确认登录成功，请重试。");
      acceptSession(body); setPassword(""); setConfirmPassword("");
    } catch (err) { setError(err instanceof Error ? err.message : "登录未确认成功，请检查网络后重试。"); }
    finally { setSubmitting(false); }
  }

  async function register(event: React.FormEvent) {
    event.preventDefault(); if (submitting) return;
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password, confirmPassword }), signal: AbortSignal.timeout(20000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "注册未成功，请稍后重试。");
      if (body.authenticated === true && body.user?.id && body.user?.email) {
        acceptSession(body); setPassword(""); setConfirmPassword(""); return;
      }
      setSession(body); setPassword(""); setConfirmPassword(""); setError(body.message || "注册成功，请查收邮箱完成验证。");
    } catch (err) { setError(err instanceof Error ? err.message : "注册未确认成功，请检查网络后重试。"); }
    finally { setSubmitting(false); }
  }

  async function logout() {
    const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json", ...(activeUser ? { "x-echo-user-id": activeUser.id } : {}) }, body: "{}", signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    if (!response.ok || body.success !== true) throw new Error(body.error || "退出尚未确认成功，请重试。");
    repository.setUser(null); setActiveUser(null); setPassword(""); setError("");
    setSession({ configured: true, authenticated: false, user: null, message: "已退出登录。" });
    window.history.replaceState(null, "", "#capture");
  }

  const signedIn = Boolean(session?.authenticated && activeUser);
  return <>
    {activeUser && <div hidden={!signedIn}><EchoApp key={activeUser.id} user={activeUser} paused={!signedIn} onLogout={logout} /></div>}
    {!signedIn && <main className="auth-page">
      <div className="auth-brand"><EchoSymbol /><span>拾念</span></div>
      <div className="auth-layout">
      <EchoAura />
       <section className="panel auth-card" aria-label={mode === "login" ? "账号登录" : "注册账号"}>
         {loading ? <div className="auth-loading"><LoaderCircle className="spin" size={29} /><h1>正在打开你的空间</h1><p>验证账号与云端连接…</p></div> : <>
          <span className="auth-emblem">{session?.configured === false ? <Cloud size={27} /> : mode === "register" ? <UserPlus size={25} /> : <LockKeyhole size={25} />}</span>
          
          <h1 className="kinetic-heading"><EchoHeading>{session?.configured === false ? "你的空间正在准备中" : mode === "register" ? "创建你的灵感空间" : "回到你的灵感空间"}</EchoHeading></h1>
          <p className="auth-description">{session?.configured === false ? "账号和云端资料库尚未接通，当前还不能保存或同步正式资料。" : mode === "register" ? "注册后，你的记录会保存在自己的云端空间，只有你能看到。" : "登录同一个账号，在手机和电脑上继续你的思考。"}</p>
          {session?.configured && <form onSubmit={e => void (mode === "register" ? register(e) : login(e))}>
            <label className="field"><span className="field-label">邮箱</span><input className="input" type="email" autoComplete="username" placeholder="你的私人登录邮箱" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={submitting} /></label>
             <label className="field"><span className="field-label">密码</span><input className="input" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder="输入账号密码" required maxLength={256} value={password} onChange={e => setPassword(e.target.value)} disabled={submitting} /></label>
             {mode === "register" && <label className="field"><span className="field-label">再次输入密码</span><input className="input" type="password" autoComplete="new-password" placeholder="再次输入密码" required minLength={12} maxLength={256} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} disabled={submitting} /></label>}
            {error && <p className="inline-notice error-notice" role="alert">{error}</p>}
             <button className="btn btn-primary auth-submit" disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={17} /> : mode === "register" ? <UserPlus size={17} /> : <ArrowRight size={17} />}{submitting ? (mode === "register" ? "正在创建账号…" : "正在验证账号…") : mode === "register" ? "创建我的空间" : "进入我的空间"}</button>
             {mode === "register" && <p className="auth-account-note"><KeyRound size={13} />密码至少 12 位。注册后请按邮件提示完成验证。</p>}
             <button type="button" className="text-button auth-mode-toggle" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "还没有账号？现在注册" : "已经有账号？返回登录"}</button>
          </form>}
          {!session?.configured && <>
            {error && <p className="inline-notice error-notice" role="alert">{error}</p>}
            
            <button className="btn btn-secondary auth-submit" onClick={() => void checkSession()}><RefreshCw size={16} />重新检查连接</button>
            <a className="auth-preview-link" href="/design-preview">先看看灵感空间<ArrowRight size={14} /></a>
          </>}
        </>}
      </section>
      </div>
       <p className="auth-footer"><ShieldCheck size={14} />每个账号只能访问自己的资料。</p>
    </main>}
  </>;
}
