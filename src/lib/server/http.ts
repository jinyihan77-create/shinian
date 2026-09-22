export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonResponse(data: unknown, status = 200, headers?: HeadersInit) {
  const outputHeaders = new Headers(headers);
  outputHeaders.set("Content-Type", "application/json; charset=utf-8");
  outputHeaders.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  outputHeaders.set("Pragma", "no-cache");
  outputHeaders.set("Expires", "0");
  outputHeaders.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers: outputHeaders });
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return jsonResponse({ error: error.message, code: error.code }, error.status);
  }
  // Do not log errors containing request bodies, provider responses or private notes.
  return jsonResponse({ error: "操作未能完成，请稍后重试。请保留尚未确认保存的内容。", code: "INTERNAL_ERROR" }, 500);
}

export async function readJsonBody(request: Request, maxBytes = 512 * 1024): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "INVALID_CONTENT_TYPE", "请求格式不正确，请刷新页面后重试。");
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > maxBytes) {
    throw new ApiError(413, "BODY_TOO_LARGE", "这次提交的内容太长，尚未提交，请缩短后重试。");
  }
  if (!request.body) throw new ApiError(400, "EMPTY_BODY", "提交内容为空，请刷新页面后重试。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "BODY_TOO_LARGE", "这次提交的内容太长，尚未提交，请缩短后重试。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "请求内容不完整，请刷新页面后重试。");
  }
}
