import { NextResponse } from "next/server";
import { createPrivateClient } from "@/lib/server/supabase";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const client = await createPrivateClient();
    await client.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/workspace", url.origin));
}
