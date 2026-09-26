import { z } from "zod";
import { checkSameOrigin, consumeAuthAttempt } from "@/lib/server/access";
import { ApiError, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { authProviderError, createPrivateClient, isCloudConfigured, localMode } from "@/lib/server/supabase";
import { usesCloudbase } from "@/lib/server/tencent-auth";
import type { PrivateSession } from "@/lib/types";

export const runtime = "nodejs";
const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(256),
  confirmPassword: z.string().min(12).max(256),
}).strict();

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    if (localMode()) throw new ApiError(400, "LOCAL_MODE_NO_REGISTRATION", "本地模式不需要注册账号。");
    if (usesCloudbase()) throw new ApiError(400, "REGISTRATION_UNAVAILABLE", "当前部署暂不开放注册。");
    if (!isCloudConfigured()) throw new ApiError(503, "CLOUD_NOT_CONFIGURED", "账号与云端保存尚未配置，暂时无法注册。");
    const parsed = registerSchema.safeParse(await readJsonBody(request, 8192));
    if (!parsed.success || parsed.data.password !== parsed.data.confirmPassword) {
      throw new ApiError(400, "INVALID_INPUT", "请输入相同的邮箱和两次密码；密码至少需要 12 个字符。");
    }
    const email = parsed.data.email.toLowerCase();
    consumeAuthAttempt(email, "register");
    const client = await createPrivateClient();
    const redirectOrigin = process.env.APP_ORIGIN?.trim() || new URL(request.url).origin;
    const { data, error } = await client.auth.signUp({
      email,
      password: parsed.data.password,
      options: { emailRedirectTo: new URL("/auth/callback", redirectOrigin).toString() },
    });
    authProviderError(error, "注册服务暂时不可用，请稍后重试。");
    if (error || !data.user) throw new ApiError(400, "REGISTRATION_FAILED", "注册未完成，请检查邮箱和密码后重试。");
    if (!data.session) {
      return jsonResponse({ configured: true, authenticated: false, user: null, confirmationRequired: true, message: "注册成功。请查收邮箱并点击验证链接，验证后即可登录。" } satisfies PrivateSession);
    }
    return jsonResponse({ configured: true, authenticated: true, user: { id: data.user.id, email: data.user.email ?? email }, message: "注册成功，已进入你的空间。" } satisfies PrivateSession, 201);
  } catch (error) { return errorResponse(error); }
}
