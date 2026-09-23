import { deletePlanRequestSchema } from "@/lib/schema";
import { checkSameOrigin, consumeRateLimit, requireAiAccess } from "@/lib/server/access";
import { cloudNotes } from "@/lib/server/cloud-notes";
import { ApiError, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { planDeletionWithAi } from "@/lib/server/organize";
import { requirePrivateUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const { client, user } = await requirePrivateUser(request);
    requireAiAccess();
    consumeRateLimit(`delete-plan:${user.id}`, 10, 60_000);
    const parsed = deletePlanRequestSchema.safeParse(await readJsonBody(request, 8 * 1024));
    if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", parsed.error.issues[0]?.message || "请说清楚想删除哪类记录。");
    // The server supplies the current private records. The browser cannot ask
    // the model to approve arbitrary IDs or turn a suggestion into a deletion.
    const notes = await cloudNotes.list(client);
    const plan = await planDeletionWithAi(parsed.data.command, notes, request.signal);
    return jsonResponse({ plan });
  } catch (error) {
    return errorResponse(error);
  }
}
