import { z } from "zod";
import { checkSameOrigin, consumeRateLimit } from "@/lib/server/access";
import { ApiError, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { requireMatchingUser } from "@/lib/server/supabase";
import { cloudbaseSendPasswordCode, requireCloudbaseIdentity, usesCloudbase } from "@/lib/server/tencent-auth";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    if (!usesCloudbase()) throw new ApiError(400, "VERIFICATION_NOT_REQUIRED", "当前账号无需验证码，请验证当前密码后修改。");
    const identity = await requireCloudbaseIdentity();
    requireMatchingUser(request, identity.user.id);
    if (!z.object({}).strict().safeParse(await readJsonBody(request, 1024)).success) throw new ApiError(400, "INVALID_INPUT", "验证码请求不正确。");
    consumeRateLimit("auth:verify:" + identity.user.id, 1, 60_000);
    consumeRateLimit("auth:verify:global", 5, 60 * 60_000);
    return jsonResponse(await cloudbaseSendPasswordCode(identity));
  } catch (error) { return errorResponse(error); }
}
