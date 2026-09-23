import { sourceIntakeRequestSchema } from "@/lib/schema";
import { checkSameOrigin, consumeRateLimit } from "@/lib/server/access";
import { ApiError, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { organizeSourceWithAi } from "@/lib/server/organize";
import { requirePrivateUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const { user } = await requirePrivateUser(request);
    consumeRateLimit(`source-intake:${user.id}`, 12, 60_000);
    const parsed = sourceIntakeRequestSchema.safeParse(await readJsonBody(request, 16 * 1024));
    if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", parsed.error.issues[0]?.message || "请检查语音内容。");
    const source = await organizeSourceWithAi(parsed.data, request.signal);
    return jsonResponse({ source });
  } catch (error) {
    return errorResponse(error);
  }
}
