import { z } from "zod";
import { checkSameOrigin, consumeAuthAttempt } from "@/lib/server/access";
import { ApiError, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { authProviderError, createPrivateClient, isCloudConfigured, localMode, ownerEmail } from "@/lib/server/supabase";
import { cloudbaseLogin, usesCloudbase } from "@/lib/server/tencent-auth";
import type { PrivateSession } from "@/lib/types";

export const runtime = "nodejs";
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(256) }).strict();

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    if (localMode()) return jsonResponse({ configured: true, authenticated: true, user: { id: "00000000-0000-4000-8000-000000000001", email: "local@localhost" }, message: "本地模式无需登录，已进入私人空间。" } satisfies PrivateSession);
    if (!isCloudConfigured()) throw new ApiError(503, "CLOUD_NOT_CONFIGURED", "私人账号与云端保存尚未配置，暂时无法登录或保存记录。");
    const parsed = loginSchema.safeParse(await readJsonBody(request, 4096));
    if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", "请输入有效邮箱和密码。");
    const email = parsed.data.email.toLowerCase();
    consumeAuthAttempt(email);
    if (email !== ownerEmail()) throw new ApiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确。");
    if (usesCloudbase()) {
      const user = await cloudbaseLogin(parsed.data.password);
      return jsonResponse({ configured: true, authenticated: true, user, message: "已登录私人账号。" } satisfies PrivateSession);
    }
    const client = await createPrivateClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password: parsed.data.password });
    authProviderError(error);
    if (error || !data.user || !data.session) throw new ApiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确。");
    if (data.user.email?.toLowerCase() !== ownerEmail()) {
      await client.auth.signOut({ scope: "local" });
      throw new ApiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确。");
    }
    return jsonResponse({ configured: true, authenticated: true, user: { id: data.user.id, email: data.user.email }, message: "已登录私人账号。" } satisfies PrivateSession);
  } catch (error) { return errorResponse(error); }
}
