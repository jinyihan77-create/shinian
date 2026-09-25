import { z } from "zod";
import { checkSameOrigin, consumeAuthAttempt } from "@/lib/server/access";
import { ApiError, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { authProviderError, createPrivateClient, localMode, requireMatchingUser, requirePrivateUser } from "@/lib/server/supabase";
import { cloudbaseChangePassword, passwordCapability, requireCloudbaseIdentity, usesCloudbase } from "@/lib/server/tencent-auth";

export const runtime = "nodejs";
const passwordSchema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(12).max(256), verificationCode: z.string().trim().regex(/^\d{4,8}$/).optional() }).strict();

export async function GET(request: Request) {
  try {
    if (localMode()) return jsonResponse({ requiresVerification: false, verificationAvailable: false, verificationMethod: null, message: "本地模式不需要账号密码。" });
    if (usesCloudbase()) {
      const identity = await requireCloudbaseIdentity();
      requireMatchingUser(request, identity.user.id);
      return jsonResponse(passwordCapability(identity.profile));
    }
    await requirePrivateUser(request);
    return jsonResponse({ requiresVerification: false, verificationAvailable: true, verificationMethod: null, message: "验证当前密码后即可修改密码。" });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    if (localMode()) throw new ApiError(400, "LOCAL_MODE_NO_PASSWORD", "本地模式不需要修改账号密码。数据只保存在当前电脑。",);
    const identity = usesCloudbase() ? await requireCloudbaseIdentity() : null;
    if (identity) requireMatchingUser(request, identity.user.id);
    const user = identity?.user || (await requirePrivateUser(request)).user;
    const parsed = passwordSchema.safeParse(await readJsonBody(request, 4096));
    if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", "请填写当前密码，新密码至少需要 12 个字符。");
    consumeAuthAttempt(user.email, "password");
    if (parsed.data.currentPassword === parsed.data.newPassword) throw new ApiError(400, "SAME_PASSWORD", "新密码需要与当前密码不同。");
    if (identity) {
      await cloudbaseChangePassword(identity, parsed.data.currentPassword, parsed.data.newPassword, parsed.data.verificationCode);
      return jsonResponse({ success: true });
    }
    const client = await createPrivateClient();
    const verified = await client.auth.signInWithPassword({ email: user.email, password: parsed.data.currentPassword });
    authProviderError(verified.error);
    if (verified.error || verified.data.user?.id !== user.id || !verified.data.session) throw new ApiError(400, "WRONG_PASSWORD", "当前密码不正确，密码未修改。");
    const changed = await client.auth.updateUser({ password: parsed.data.newPassword });
    authProviderError(changed.error, "密码服务暂不可用，请稍后重试。");
    if (changed.error || !changed.data.user) throw new ApiError(400, "PASSWORD_REJECTED", "密码未修改，请使用至少 12 位、包含字母和数字的新密码后重试。");
    return jsonResponse({ success: true });
  } catch (error) { return errorResponse(error); }
}
