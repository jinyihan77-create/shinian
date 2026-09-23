import { checkinInputSchema, checkinUpdateSchema } from "@/lib/checkin";
import { checkSameOrigin } from "@/lib/server/access";
import { cloudCheckins } from "@/lib/server/cloud-checkins";
import { ApiError, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { requirePrivateUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client } = await requirePrivateUser(request);
    return jsonResponse(await cloudCheckins.get(client));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const { client } = await requirePrivateUser(request);
    const parsed = checkinInputSchema.safeParse(await readJsonBody(request, 2048));
    if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", "心情最多 24 字，金句最多 100 字；请检查内容和打卡日期后重试。");
    return jsonResponse(await cloudCheckins.create(client, parsed.data));
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    checkSameOrigin(request);
    const { client } = await requirePrivateUser(request);
    const parsed = checkinUpdateSchema.safeParse(await readJsonBody(request, 2048));
    if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", "请检查星笺日期、文字和版本后重试。");
    return jsonResponse(await cloudCheckins.update(client, parsed.data));
  } catch (error) { return errorResponse(error); }
}
