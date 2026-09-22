import { createHash } from "node:crypto";
import type { AiServiceStatus } from "../types";
import { ApiError } from "./http";

interface RateWindow { count: number; resetAt: number }
const globalState = globalThis as typeof globalThis & { __echoRateLimits?: Map<string, RateWindow> };

export function getServerConfig() {
  const provider = process.env.CLOUD_PROVIDER?.trim() === "cloudbase" ? "cloudbase" : "openai";
  return {
    provider,
    apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
    model: (provider === "cloudbase" ? process.env.CLOUDBASE_AI_MODEL : process.env.AI_MODEL)?.trim() ?? "",
    cloudbaseEnv: process.env.CLOUDBASE_ENV_ID?.trim() ?? "",
    cloudbaseRegion: process.env.CLOUDBASE_REGION?.trim() || "ap-shanghai",
    production: process.env.NODE_ENV === "production",
    appOrigin: process.env.APP_ORIGIN?.trim() ?? "",
  };
}

export function checkSameOrigin(request: Request) {
  const { appOrigin, production } = getServerConfig();
  let expectedOrigin: string;
  try {
    // Production uses its canonical configured origin, never a forwarded header.
    if (production && !appOrigin) throw new Error("Missing origin");
    const incoming = new URL(request.url);
    // next dev binds 0.0.0.0, while the browser opens localhost or a LAN host.
    // Honor the browser Host only for local development; production stays fixed.
    const developmentOrigin = incoming.protocol + "//" + (request.headers.get("host") || incoming.host);
    const configured = new URL(appOrigin || developmentOrigin);
    if ((production && configured.protocol !== "https:") || !["https:", "http:"].includes(configured.protocol)) throw new Error("Invalid origin");
    expectedOrigin = configured.origin;
  } catch {
    throw new ApiError(503, "INVALID_ORIGIN_CONFIGURATION", "网站访问地址尚未正确配置，请联系管理员。");
  }
  if (request.headers.get("sec-fetch-site") === "cross-site" || request.headers.get("origin") !== expectedOrigin) {
    throw new ApiError(403, "ORIGIN_REJECTED", "请在本站页面中使用这个操作。");
  }
}

// Only expose after authentication. Configured is not a successful health check.
export function serviceStatus(): AiServiceStatus {
  const { provider, apiKey, model, cloudbaseEnv } = getServerConfig();
  const configured = Boolean(model && (provider === "cloudbase" ? cloudbaseEnv : apiKey));
  return {
    configured, available: configured, requiresUnlock: false,
    message: configured
      ? `${provider === "cloudbase" ? "腾讯云 AI" : "AI"} 整理已配置，实际权限、额度和调用结果以每次整理为准。点击整理后，会发送当前记录的想法、来源片段及名称、链接等来源信息。`
      : "AI 服务尚未配置，暂时不能整理。你仍可保存记录、搜索并写下自己的理解。",
  };
}

export function requireAiAccess() {
  const status = serviceStatus();
  if (!status.available) throw new ApiError(503, "AI_UNAVAILABLE", status.message);
}

export function consumeRateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const rates = globalState.__echoRateLimits ??= new Map();
  for (const [entryKey, entry] of rates) if (entry.resetAt <= now) rates.delete(entryKey);
  const entry = rates.get(key);
  if (entry && entry.count >= max) throw new ApiError(429, "RATE_LIMITED", "操作有些频繁，请稍后再试。");
  rates.set(key, entry ? { ...entry, count: entry.count + 1 } : { count: 1, resetAt: now + windowMs });
}

// Warm-instance defense only; Supabase Auth also enforces account throttling.
// An arbitrary X-Forwarded-For value is never trusted as an identity.
export function consumeAuthAttempt(email: string, operation = "login") {
  consumeRateLimit("auth:" + operation + ":global", 30, 15 * 60_000);
  consumeRateLimit("auth:" + operation + ":" + createHash("sha256").update(email.toLowerCase()).digest("hex"), 15, 15 * 60_000);
}
