import { z } from "zod";
import { aiResultSchema, captureInputSchema } from "@/lib/schema";
import { checkSameOrigin } from "@/lib/server/access";
import { cloudNotes, validateNoteId } from "@/lib/server/cloud-notes";
import { ApiError, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { requirePrivateUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const expectedVersion = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("content"), expectedVersion, input: captureInputSchema }).strict(),
  z.object({ action: z.literal("meta"), expectedVersion, input: z.object({ title: z.string(), tags: z.array(z.string()) }).strict() }).strict(),
  z.object({ action: z.literal("reflection"), expectedVersion, input: z.object({ text: z.string(), prompt: z.string().optional() }).strict() }).strict(),
  z.object({ action: z.literal("aiResult"), expectedVersion, input: aiResultSchema }).strict(),
]);

export async function GET(request: Request, context: Context) {
  try {
    const { client } = await requirePrivateUser(request);
    const { id } = await context.params;
    return jsonResponse({ note: await cloudNotes.get(client, validateNoteId(id)) });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    checkSameOrigin(request);
    const { client } = await requirePrivateUser(request);
    const id = validateNoteId((await context.params).id);
    const parsed = patchSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", "修改内容或记录版本无效，请检查后重试。输入仍为你保留。");
    const value = parsed.data;
    const note = value.action === "content" ? await cloudNotes.updateContent(client, id, value.expectedVersion, value.input)
      : value.action === "meta" ? await cloudNotes.updateMeta(client, id, value.expectedVersion, value.input)
        : value.action === "reflection" ? await cloudNotes.saveReflection(client, id, value.expectedVersion, value.input.text, value.input.prompt)
          : await cloudNotes.updateAiResult(client, id, value.expectedVersion, value.input);
    return jsonResponse({ note });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    checkSameOrigin(request);
    const { client } = await requirePrivateUser(request);
    const id = validateNoteId((await context.params).id);
    const parsed = z.object({ expectedVersion }).strict().safeParse(await readJsonBody(request, 1024));
    if (!parsed.success) throw new ApiError(400, "VERSION_REQUIRED", "缺少记录版本，请刷新后再删除。");
    await cloudNotes.remove(client, id, parsed.data.expectedVersion);
    return jsonResponse({ success: true });
  } catch (error) { return errorResponse(error); }
}
