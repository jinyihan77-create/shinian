import { serviceStatus } from "@/lib/server/access";
import { errorResponse, jsonResponse } from "@/lib/server/http";
import { requirePrivateUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePrivateUser();
    return jsonResponse(serviceStatus());
  } catch (error) { return errorResponse(error); }
}
