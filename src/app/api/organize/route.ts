import { z } from "zod";
import type { DataClient } from "@/lib/server/data-client";
import { checkSameOrigin, requireAiAccess } from "@/lib/server/access";
import { cloudNotes } from "@/lib/server/cloud-notes";
import { ApiError, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { organizeWithAi } from "@/lib/server/organize";
import { requirePrivateUser } from "@/lib/server/supabase";
import type { EchoNote } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
const requestSchema = z.object({ id: z.string().uuid(), revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict();

export async function POST(request: Request) {
  let lease: { client: DataClient; id: string; token: string } | undefined;
  try {
    checkSameOrigin(request);
    const { client } = await requirePrivateUser(request);
    requireAiAccess();
    const parsed = requestSchema.safeParse(await readJsonBody(request, 4096));
    if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", "记录信息不正确，请刷新页面后重试。");
    // Database owns the revision check, quota and lease; never trust client text.
    const { note, token } = await cloudNotes.beginAi(client, parsed.data.id, parsed.data.revision);
    lease = { client, id: note.id, token };
    const result = await organizeWithAi(note, request.signal);
    const applied = await cloudNotes.finishAi(client, note.id, token, parsed.data.revision, result);
    if (!applied) throw new ApiError(409, "CONTENT_CHANGED", "这条记录已在其他设备修改，本次整理未应用，请刷新后重新整理。");
    lease = undefined;
    let saved: EchoNote;
    try { saved = await cloudNotes.get(client, note.id); }
    catch (error) {
      if (error instanceof ApiError && error.status === 404) throw new ApiError(409, "CONTENT_CHANGED", "记录已在其他设备删除，请刷新回声屿。");
      throw new ApiError(503, "AI_SAVED_REFRESH_FAILED", "整理结果已提交到云端，但暂时无法读取最新记录。请刷新回声屿确认，不必立即重复整理。");
    }
    if (saved.revision !== parsed.data.revision || saved.aiInputRevision !== parsed.data.revision || saved.aiStatus !== "done") {
      throw new ApiError(409, "CONTENT_CHANGED", "记录在整理完成后又有变化，请刷新后核对最新内容。");
    }
    return jsonResponse({ applied: true, note: saved });
  } catch (error) {
    if (lease) {
      try { await cloudNotes.failAi(lease.client, lease.id, lease.token, error instanceof ApiError ? error.message : "本次整理未完成，请重试。"); }
      catch { /* Durable lease expires; never replace the original error. */ }
    }
    return errorResponse(error);
  }
}
