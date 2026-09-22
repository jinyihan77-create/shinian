import { z } from "zod";
import { noteSchema } from "@/lib/schema";
import { checkSameOrigin } from "@/lib/server/access";
import { cloudNotes } from "@/lib/server/cloud-notes";
import { ApiError, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { requirePrivateUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const { client } = await requirePrivateUser(request);
    const parsed = z.object({ notes: z.array(noteSchema).max(10000) }).strict().safeParse(await readJsonBody(request, 4 * 1024 * 1024));
    if (!parsed.success) throw new ApiError(400, "INVALID_BACKUP", "备份包含无效记录，本次没有导入任何记录。");
    return jsonResponse({ added: await cloudNotes.importNotes(client, parsed.data.notes) });
  } catch (error) { return errorResponse(error); }
}
