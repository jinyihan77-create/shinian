import { jsonResponse } from "@/lib/server/http";

// The old shared AI passcode is not an account and no longer grants access.
export async function POST() {
  return jsonResponse({ code: "RETIRED_ENDPOINT", error: "私人口令入口已停用，请使用邮箱和密码登录私人账号。" }, 410);
}
