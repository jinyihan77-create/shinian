import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { ApiError } from "./http";
import type { DataClient } from "./data-client";
import { cloudbaseConfigured, requireCloudbaseUser, usesCloudbase } from "./tencent-auth";

export function ownerEmail() { return process.env.OWNER_EMAIL?.trim().toLowerCase() ?? ""; }

export function isCloudConfigured(): boolean {
  if (usesCloudbase()) return cloudbaseConfigured();
  if (process.env.CLOUD_PROVIDER?.trim() && process.env.CLOUD_PROVIDER.trim() !== "supabase") return false;
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  const email = ownerEmail();
  try {
    const url = new URL(process.env.SUPABASE_URL?.trim() ?? "");
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return false;
    if (!key || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
    // Runtime must never use a secret/service-role key that bypasses RLS.
    if (key.startsWith("sb_secret_")) return false;
    if (key.split(".").length === 3) {
      try { if (JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role !== "anon") return false; }
      catch { return false; }
    }
    return true;
  } catch { return false; }
}

export async function createPrivateClient(): Promise<SupabaseClient> {
  if (usesCloudbase() || !isCloudConfigured()) throw new ApiError(503, "CLOUD_NOT_CONFIGURED", "私人账号与云端保存尚未配置，暂时无法登录或保存记录。");
  const store = await cookies();
  return createServerClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_ANON_KEY!.trim(), {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 },
    cookies: {
      getAll: () => store.getAll(),
      // jsonResponse() unconditionally applies all required private/no-cache
      // headers, including responses without a cookie write on this request.
      setAll: values => {
        for (const { name, value, options } of values) {
          store.set(name, value, { ...options, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
        }
      },
    },
  });
}

export function authProviderError(error: { status?: number; code?: string } | null, fallback = "登录服务暂不可用，请稍后重试。") {
  if (error?.status === 429 || error?.code === "over_request_rate_limit") throw new ApiError(429, "AUTH_RATE_LIMITED", "登录尝试过于频繁，请稍后再试。");
  if (error && (typeof error.status !== "number" || error.status < 400 || error.status >= 500 || error.code === "unexpected_failure")) {
    throw new ApiError(503, "AUTH_UNAVAILABLE", fallback);
  }
}

export function requireMatchingUser(request: Request, userId: string) {
  const expectedUser = request.headers.get("x-echo-user-id");
  if (expectedUser && expectedUser !== userId) throw new ApiError(401, "SESSION_CHANGED", "登录账号已改变，请重新登录后再操作。");
}

export async function requirePrivateUser(request?: Request): Promise<{ client: DataClient; user: { id: string; email: string } }> {
  if (usesCloudbase()) {
    const result = await requireCloudbaseUser();
    if (request) requireMatchingUser(request, result.user.id);
    return result;
  }
  const client = await createPrivateClient();
  // Verify at Auth; cookie contents/getSession alone never authorize access.
  const { data, error } = await client.auth.getUser();
  authProviderError(error);
  const user = data.user;
  if (error || !user?.id || user.email?.toLowerCase() !== ownerEmail()) {
    throw new ApiError(401, "AUTH_REQUIRED", "请先登录私人账号，再查看或保存你的资料。");
  }
  if (request) requireMatchingUser(request, user.id);
  return { client, user: { id: user.id, email: user.email } };
}
