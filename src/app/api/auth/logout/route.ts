import { checkSameOrigin } from "@/lib/server/access";
import { ApiError, errorResponse, jsonResponse } from "@/lib/server/http";
import { authProviderError, createPrivateClient, localMode, requireMatchingUser } from "@/lib/server/supabase";
import { cloudbaseLogout, usesCloudbase } from "@/lib/server/tencent-auth";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    if (localMode()) return jsonResponse({ success: true });
    if (usesCloudbase()) {
      await cloudbaseLogout(request.headers.get("x-echo-user-id"));
      return jsonResponse({ success: true });
    }
    const client = await createPrivateClient();
    if (request.headers.has("x-echo-user-id")) {
      const { data, error } = await client.auth.getUser();
      authProviderError(error);
      if (data.user) requireMatchingUser(request, data.user.id);
    }
    const { error } = await client.auth.signOut({ scope: "local" });
    authProviderError(error);
    if (error) throw new ApiError(503, "LOGOUT_FAILED", "退出登录未完成，请稍后重试。");
    return jsonResponse({ success: true });
  } catch (error) { return errorResponse(error); }
}
