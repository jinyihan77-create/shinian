import { reflectionRefineRequestSchema } from "@/lib/schema";
import { checkSameOrigin, consumeRateLimit } from "@/lib/server/access";
import { cloudNotes } from "@/lib/server/cloud-notes";
import { ApiError, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { refineReflectionWithAi } from "@/lib/server/organize";
import { requirePrivateUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const { client, user } = await requirePrivateUser(request);
    consumeRateLimit(`reflection-refine:${user.id}`, 12, 60_000);
    const parsed = reflectionRefineRequestSchema.safeParse(await readJsonBody(request, 48 * 1024));
    if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", parsed.error.issues[0]?.message || "请先写下自己的理解。");
    const note = await cloudNotes.get(client, parsed.data.id);
    if (note.storageVersion !== parsed.data.version) {
      throw new ApiError(409, "CONFLICT", "这条记录已在另一处更新。你的原话没有改变，请刷新后再提炼。");
    }
    const reflection = await refineReflectionWithAi({
      title: note.title,
      reflectionText: parsed.data.text,
    }, request.signal);
    return jsonResponse({ reflection });
  } catch (error) {
    return errorResponse(error);
  }
}
