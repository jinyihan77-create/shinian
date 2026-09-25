import { ApiError, errorResponse, jsonResponse } from "@/lib/server/http";
import { isCloudConfigured, localMode, requirePrivateUser } from "@/lib/server/supabase";
import type { PrivateSession } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (localMode()) return jsonResponse({ configured: true, authenticated: true, user: { id: "00000000-0000-4000-8000-000000000001", email: "local@localhost" }, message: "本地模式已就绪，数据保存在本机。" } satisfies PrivateSession);
  if (!isCloudConfigured()) return jsonResponse({ configured: false, authenticated: false, user: null, message: "私人账号与云端保存尚未配置，暂时无法使用。" } satisfies PrivateSession);
  try {
    const { user } = await requirePrivateUser();
    return jsonResponse({ configured: true, authenticated: true, user, message: "已登录私人账号。" } satisfies PrivateSession);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return jsonResponse({ configured: true, authenticated: false, user: null, message: "请登录你的私人账号。" } satisfies PrivateSession);
    return errorResponse(error);
  }
}
