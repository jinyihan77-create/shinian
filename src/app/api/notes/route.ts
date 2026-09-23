import { z } from "zod";
import { captureInputSchema } from "@/lib/schema";
import { checkSameOrigin } from "@/lib/server/access";
import { cloudNotes } from "@/lib/server/cloud-notes";
import { ApiError, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { requirePrivateUser } from "@/lib/server/supabase";
import { CAPTURE_CONTEXT_TAGS } from "@/lib/note-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client } = await requirePrivateUser(request);
    const cursor = new URL(request.url).searchParams.get("cursor");
    return jsonResponse(await cloudNotes.listPage(client, cursor));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const { client } = await requirePrivateUser(request);
    const parsed = z.object({ id: z.string().uuid(), input: captureInputSchema, tags: z.array(z.enum(CAPTURE_CONTEXT_TAGS)).max(2).default([]) }).strict().safeParse(await readJsonBody(request));
    if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", "记录内容格式不正确，请检查后重试。输入仍为你保留。");
    const note = await cloudNotes.create(client, parsed.data.id, parsed.data.input, parsed.data.tags);
    return jsonResponse({ note }, 201);
  } catch (error) { return errorResponse(error); }
}
