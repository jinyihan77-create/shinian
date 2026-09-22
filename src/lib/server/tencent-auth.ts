import { createHash } from "node:crypto";
import { PostgrestClient } from "@supabase/postgrest-js";
import { cookies } from "next/headers";
import { z } from "zod";
import type { DataClient } from "./data-client";
import { ApiError } from "./http";

// Official Auth v2 REST contracts: docs.cloudbase.net/http-api/auth/.
// The Node SDK's administrative credential must never authorize a user's data.
const tokenSchema = z.object({
  token_type: z.literal("Bearer"),
  access_token: z.string().min(1).max(8192), refresh_token: z.string().min(1).max(4096),
  expires_in: z.number().int().positive().max(31_536_000), sub: z.string().min(1).max(128),
});
const storedSchema = tokenSchema.omit({ expires_in: true, token_type: true }).extend({ environment: z.string() });
const profileSchema = z.object({
  sub: z.string().min(1).max(128), username: z.string().max(256),
  email: z.string().max(254).optional(), phone_number: z.string().max(64).optional(),
  status: z.string().optional(),
});
type Tokens = z.infer<typeof tokenSchema>;
type StoredSession = z.infer<typeof storedSchema>;
type Profile = z.infer<typeof profileSchema>;
type CookieStore = Awaited<ReturnType<typeof cookies>>;
const cookiePrefix = "echo-tencent-session.";
const refreshRetryCookie = "echo-tencent-refresh-retry";
const refreshRaceGraceMs = 30_000;
const chunkSize = 3000;
const maximumChunks = 6;
const unavailable = () => new ApiError(503, "AUTH_UNAVAILABLE", "登录服务暂不可用，请稍后重试。");
const required = () => new ApiError(401, "AUTH_REQUIRED", "请先登录私人账号，再查看或保存你的资料。");

export function usesCloudbase() { return process.env.CLOUD_PROVIDER?.trim() === "cloudbase"; }
export function cloudbaseUsername() { return process.env.OWNER_USERNAME?.trim() || process.env.OWNER_EMAIL?.trim().toLowerCase() || ""; }
export function cloudbaseConfigured() {
  return /^[a-z0-9][a-z0-9-]{2,62}$/.test(process.env.CLOUDBASE_ENV_ID?.trim() || "")
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.OWNER_EMAIL?.trim() || "")
    && /^[A-Za-z0-9][A-Za-z0-9_.:+ @-]{1,47}$/.test(cloudbaseUsername());
}
function endpoint() {
  if (!cloudbaseConfigured()) throw new ApiError(503, "CLOUD_NOT_CONFIGURED", "私人账号与云端保存尚未配置，暂时无法登录或保存记录。");
  return `https://${process.env.CLOUDBASE_ENV_ID!.trim()}.api.tcloudbasegateway.com`;
}
function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}
function clearSession(store: CookieStore) {
  for (const entry of store.getAll()) if (entry.name.startsWith(cookiePrefix) || entry.name === refreshRetryCookie) store.set(entry.name, "", cookieOptions(0));
}
function writeSession(store: CookieStore, token: Tokens) {
  const value = Buffer.from(JSON.stringify({
    access_token: token.access_token, refresh_token: token.refresh_token, sub: token.sub,
    environment: process.env.CLOUDBASE_ENV_ID!.trim(),
  } satisfies StoredSession)).toString("base64url");
  const count = Math.ceil(value.length / chunkSize);
  if (count > maximumChunks) throw unavailable();
  clearSession(store);
  for (let index = 0; index < count; index++) {
    store.set(cookiePrefix + index, value.slice(index * chunkSize, (index + 1) * chunkSize), cookieOptions(30 * 24 * 60 * 60));
  }
}
function readSession(store: CookieStore): StoredSession | null {
  try {
    const entries = store.getAll().filter(entry => entry.name.startsWith(cookiePrefix));
    if (!entries.length || entries.length > maximumChunks) return null;
    const chunks: string[] = [];
    for (let index = 0; index < entries.length; index++) {
      const entry = entries.find(item => item.name === cookiePrefix + index);
      if (!entry || entry.value.length > chunkSize) return null;
      chunks.push(entry.value);
    }
    const parsed = storedSchema.safeParse(JSON.parse(Buffer.from(chunks.join(""), "base64url").toString("utf8")));
    return parsed.success && parsed.data.environment === process.env.CLOUDBASE_ENV_ID?.trim() ? parsed.data : null;
  } catch { return null; }
}

class ProviderRejection extends Error {
  constructor(readonly status: number, readonly code: string) { super("Authentication request rejected"); }
}
async function requestAuth(path: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<unknown> {
  const url = endpoint() + "/auth/v1" + path;
  try {
    const response = await fetch(url, {
      method: options.method || "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json", ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    // Bound untrusted provider responses and never expose their error text.
    const reader = response.body?.getReader();
    if (!reader) throw unavailable();
    const chunks: Uint8Array[] = []; let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > 65_536) { await reader.cancel(); throw unavailable(); }
      chunks.push(part.value);
    }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw unavailable();
    const errorCode = "error" in result && typeof result.error === "string" ? result.error : "";
    if (response.status === 429 || ["captcha_required", "invalid_status", "rate_limit_exceeded"].includes(errorCode)) {
      throw new ApiError(429, "AUTH_RATE_LIMITED", "登录尝试过于频繁或账号暂时锁定，请稍后重试。");
    }
    if (response.status >= 500) throw unavailable();
    if (!response.ok || errorCode) throw new ProviderRejection(response.status, errorCode);
    return result;
  } catch (error) {
    if (error instanceof ApiError || error instanceof ProviderRejection) throw error;
    throw unavailable();
  }
}
function parseToken(value: unknown): Tokens {
  const parsed = tokenSchema.safeParse(value);
  if (!parsed.success) throw unavailable();
  return parsed.data;
}
function expectEmptySuccess(value: unknown) {
  if (!z.object({}).strict().safeParse(value).success) throw unavailable();
}
async function verifyToken(token: string): Promise<Profile> {
  const parsed = profileSchema.safeParse(await requestAuth("/user/me", { token }));
  if (!parsed.success) throw unavailable();
  if (parsed.data.username !== cloudbaseUsername() || (parsed.data.status && parsed.data.status !== "ACTIVE")) throw required();
  return parsed.data;
}

// CloudBase rotates refresh tokens once. Share a short-lived result for concurrent
// requests in one process. Across instances a rejected refresh is retryable and
// never clears the newer cookie another request may be setting.
type RefreshEntry = { expiresAt: number; promise: Promise<Tokens> };
const refreshState = globalThis as typeof globalThis & { __echoTencentRefreshes?: Map<string, RefreshEntry> };
function sessionFingerprint(session: StoredSession) {
  return createHash("sha256").update(session.environment + ":" + session.refresh_token).digest("hex");
}
function rejectedRefresh(store: CookieStore, session: StoredSession): never {
  const fingerprint = sessionFingerprint(session);
  const now = Date.now();
  const marker = store.getAll().find(entry => entry.name === refreshRetryCookie)?.value;
  if (marker) {
    try {
      const parsed = JSON.parse(Buffer.from(marker, "base64url").toString("utf8"));
      if (parsed.fingerprint === fingerprint && Number.isSafeInteger(parsed.at)
        && now - parsed.at >= refreshRaceGraceMs && now - parsed.at <= 120_000) {
        // Never expire the token cookies from a read request: its delayed response
        // could otherwise clear a newer session. The next login replaces them.
        throw new ApiError(401, "SESSION_EXPIRED", "登录已过期，请重新登录。尚未保存的输入仍为你保留。");
      }
      if (parsed.fingerprint === fingerprint && Number.isSafeInteger(parsed.at)
        && now - parsed.at >= 0 && now - parsed.at < refreshRaceGraceMs) {
        throw new ApiError(503, "SESSION_REFRESH_RETRY", "登录续期尚未确认，请等待约 30 秒后重新检查连接。");
      }
    } catch (error) { if (error instanceof ApiError) throw error; }
  }
  // Separate from the session cookie so a losing concurrent refresh cannot
  // overwrite the rotated tokens delivered by another request/instance.
  store.set(refreshRetryCookie, Buffer.from(JSON.stringify({ fingerprint, at: now })).toString("base64url"), cookieOptions(120));
  throw new ApiError(503, "SESSION_REFRESH_RETRY", "登录续期尚未确认，请等待约 30 秒后重新检查连接。");
}
async function refreshSession(session: StoredSession): Promise<Tokens> {
  const entries = refreshState.__echoTencentRefreshes ??= new Map();
  const now = Date.now();
  for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
  const key = sessionFingerprint(session);
  const previous = entries.get(key);
  if (previous) return previous.promise;
  if (entries.size >= 256) throw unavailable();
  const promise = (async () => {
      const token = parseToken(await requestAuth("/token", { method: "POST", body: {
        client_id: session.environment, grant_type: "refresh_token", refresh_token: session.refresh_token,
      } }));
      if (token.sub !== session.sub) throw required();
      return token;
  })();
  entries.set(key, { expiresAt: now + 15_000, promise });
  return promise;
}
export async function requireCloudbaseIdentity() {
  endpoint();
  const store = await cookies();
  const session = readSession(store);
  if (!session) throw required();
  let profile: Profile;
  let accessToken = session.access_token;
  try { profile = await verifyToken(accessToken); }
  catch (error) {
    if (!(error instanceof ProviderRejection) || ![400, 401, 403].includes(error.status)) throw error;
    let refreshed: Tokens;
    try { refreshed = await refreshSession(session); }
    catch (refreshError) {
      if (refreshError instanceof ProviderRejection) {
        if (refreshError.code === "invalid_grant") rejectedRefresh(store, session);
        throw unavailable();
      }
      throw refreshError;
    }
    // Rotation has already invalidated the old refresh token. Retain the new
    // tokens even if the following user lookup temporarily fails. These cookies
    // never authorize business requests without another provider verification.
    writeSession(store, refreshed);
    profile = await verifyToken(refreshed.access_token).catch(error => {
      if (error instanceof ProviderRejection) throw required();
      throw error;
    });
    if (profile.sub !== refreshed.sub) throw required();
    accessToken = refreshed.access_token;
  }
  if (profile.sub !== session.sub) throw required();
  return { accessToken, profile, user: { id: profile.sub, email: process.env.OWNER_EMAIL!.trim().toLowerCase() } };
}
export async function requireCloudbaseUser() {
  const identity = await requireCloudbaseIdentity();
  const client: DataClient = new PostgrestClient(endpoint() + "/v1/rdb/rest", {
    headers: { Authorization: `Bearer ${identity.accessToken}` },
    fetch: (url, options) => fetch(url, { ...options, cache: "no-store", redirect: "error", signal: options?.signal || AbortSignal.timeout(15_000) }),
  });
  return { client, user: identity.user };
}
export async function cloudbaseLogin(password: string) {
  try {
    const token = parseToken(await requestAuth("/signin", { method: "POST", body: { username: cloudbaseUsername(), password } }));
    const profile = await verifyToken(token.access_token);
    if (token.sub !== profile.sub) throw required();
    writeSession(await cookies(), token);
    return { id: profile.sub, email: process.env.OWNER_EMAIL!.trim().toLowerCase() };
  } catch (error) {
    if (error instanceof ProviderRejection || error instanceof ApiError && error.status === 401) throw new ApiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确。");
    throw error;
  }
}
export async function cloudbaseLogout(expectedId?: string | null) {
  endpoint();
  const store = await cookies();
  const session = readSession(store);
  if (!session) { clearSession(store); return; }
  // This cookie check is only an early stale-tab rejection; provider identity
  // verification below remains mandatory before revoking a live session.
  if (expectedId && expectedId !== session.sub) throw new ApiError(401, "SESSION_CHANGED", "登录账号已改变，请重新登录后再操作。");
  let identity: Awaited<ReturnType<typeof requireCloudbaseIdentity>>;
  try { identity = await requireCloudbaseIdentity(); }
  catch (error) {
    if (error instanceof ApiError && error.code === "SESSION_EXPIRED") {
      // Both provider credentials are now conclusively unusable. There is no
      // live provider session to revoke, and local logout can complete.
      clearSession(store);
      return;
    }
    throw error;
  }
  if (expectedId) {
    // Verify identity at the provider, never trust a cookie's sub claim.
    if (expectedId !== identity.user.id) throw new ApiError(401, "SESSION_CHANGED", "登录账号已改变，请重新登录后再操作。");
  }
  const accessToken = identity.accessToken;
  try {
    const result = await requestAuth("/user/signout", { method: "POST", token: accessToken, body: {} });
    if (!z.object({ redirect_uri: z.string().optional() }).strict().safeParse(result).success) throw unavailable();
  }
  catch (error) {
    if (error instanceof ProviderRejection) throw new ApiError(503, "LOGOUT_FAILED", "退出登录未完成，请稍后重试。");
    throw error;
  }
  refreshState.__echoTencentRefreshes?.clear();
  clearSession(store);
}
export function passwordCapability(profile: Profile) {
  const verificationMethod = profile.email ? "email" as const : profile.phone_number ? "phone" as const : null;
  return {
    requiresVerification: true, verificationAvailable: Boolean(verificationMethod), verificationMethod,
    message: verificationMethod ? `修改密码需要验证已绑定的${verificationMethod === "email" ? "邮箱" : "手机"}，验证码 5 分钟内有效。` : "这个账号尚未绑定验证邮箱或手机，请先在腾讯云身份认证中绑定，再修改密码。",
  };
}
export async function cloudbaseSendPasswordCode(identity: Awaited<ReturnType<typeof requireCloudbaseIdentity>>) {
  const capability = passwordCapability(identity.profile);
  if (!capability.verificationMethod) throw new ApiError(409, "VERIFICATION_UNAVAILABLE", capability.message);
  try { expectEmptySuccess(await requestAuth("/user/reauthenticate", { method: "POST", token: identity.accessToken, body: { verify_opt: capability.verificationMethod === "email" ? "email_code" : "phone_code" } })); }
  catch (error) {
    if (error instanceof ProviderRejection) throw new ApiError(400, "VERIFICATION_NOT_SENT", "验证码未发送，请确认账号的邮箱或手机已绑定且验证服务已开通。");
    throw error;
  }
  return { success: true, method: capability.verificationMethod, message: `验证服务已接受发送请求，请查看绑定的${capability.verificationMethod === "email" ? "邮箱" : "手机"}。验证码 5 分钟内有效。` };
}
export async function cloudbaseChangePassword(identity: Awaited<ReturnType<typeof requireCloudbaseIdentity>>, currentPassword: string, newPassword: string, verificationCode?: string) {
  if (!verificationCode) throw new ApiError(400, "VERIFICATION_REQUIRED", "请先获取验证码，再填写收到的验证码。");
  if (newPassword.length > 64 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
    throw new ApiError(400, "PASSWORD_REJECTED", "新密码须为 12–64 位，包含大写字母、小写字母、数字和特殊字符。");
  }
  try { expectEmptySuccess(await requestAuth("/user/password", { method: "PATCH", token: identity.accessToken, body: { old_password: currentPassword, new_password: newPassword, confirm_password: newPassword, verify_code: verificationCode } })); }
  catch (error) {
    if (error instanceof ProviderRejection) throw new ApiError(400, "PASSWORD_REJECTED", "密码未修改，请核对当前密码和验证码，并确认新密码符合要求。");
    throw error;
  }
}
