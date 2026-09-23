/**
 * Real HTTP acceptance only. Run after deployment:
 *   npm run verify:live -- --origin https://your-site.example
 * Configuration only, without requests or AI charges:
 *   npm run verify:live -- --check-config
 * Credentials come from .env.tencent-owner.local / environment variables;
 * OWNER_PASSWORD overrides OWNER_INITIAL_PASSWORD after a password change.
 * A live run invokes AI three times (source extraction, deletion planning and note organization) and
 * deletes only its own uniquely marked record.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { searchNotes } from "../src/lib/search.ts";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(project, "test-results/live-acceptance.json");
const stepNames = ["configuration", "anonymous_access", "login", "session", "source_intake", "create", "mark_test_title", "list", "delete_plan", "second_login", "cross_session_read", "ai", "reflection", "search", "delete", "second_logout", "logout", "logout_verified"];
const labels = { configuration: "配置", anonymous_access: "未登录访问保护", login: "登录", session: "会话", source_intake: "语音来源 AI 整理", create: "保存测试记录", mark_test_title: "标注验收记录", list: "资料库读取", delete_plan: "AI 清理候选", second_login: "独立会话登录", cross_session_read: "跨会话读取", ai: "真实 AI 整理", reflection: "保存自己的理解", search: "检索云端内容", delete: "清理测试记录", second_logout: "退出独立会话", logout: "退出登录", logout_verified: "退出后访问保护" };

class CheckFailure extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
function requireValue(condition, code) { if (!condition) throw new CheckFailure(code); }
function failureCode(error) {
  // Never serialize provider messages, response bodies, headers, credentials or stacks.
  return error instanceof CheckFailure ? error.code : "UNEXPECTED_FAILURE_DETAILS_REDACTED";
}

class Session {
  cookies = new Map();
  userId = null;
  constructor(origin, audit) { this.origin = origin; this.audit = audit; }

  async request(route, { method = "GET", body, expected = [200], timeout = 25_000 } = {}) {
    const url = new URL(route, this.origin);
    requireValue(url.origin === this.origin, "CROSS_ORIGIN_REQUEST_REFUSED");
    const headers = { Accept: "application/json", Origin: this.origin, "Sec-Fetch-Site": "same-origin" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.userId) headers["x-echo-user-id"] = this.userId;
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    let response;
    try {
      response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeout) });
    } catch (error) {
      const code = error?.name === "TimeoutError" || error?.name === "AbortError" ? "HTTP_TIMEOUT_OUTCOME_UNCERTAIN" : "HTTP_NETWORK_OR_REDIRECT_FAILURE";
      this.audit({ method, route: url.pathname.replace(/\/notes\/[0-9a-f-]+$/i, "/notes/:test-id"), code });
      throw new CheckFailure(code);
    }
    this.audit({ method, route: url.pathname.replace(/\/notes\/[0-9a-f-]+$/i, "/notes/:test-id"), status: response.status });
    requireValue(typeof response.headers.getSetCookie === "function", "NODE_COOKIE_SUPPORT_REQUIRED");
    // This jar is intentionally scoped to exactly one HTTPS origin. Cookies
    // remain in process memory and are updated even when a request fails.
    for (const line of response.headers.getSetCookie()) {
      const parts = line.split(";").map(item => item.trim());
      const equal = parts[0].indexOf("=");
      if (equal < 1) continue;
      const name = parts[0].slice(0, equal), value = parts[0].slice(equal + 1);
      const attributes = new Map(parts.slice(1).map(item => { const at = item.indexOf("="); return at < 0 ? [item.toLowerCase(), ""] : [item.slice(0, at).toLowerCase(), item.slice(at + 1)]; }));
      requireValue(!attributes.has("domain") || attributes.get("domain").replace(/^\./, "").toLowerCase() === url.hostname, "UNEXPECTED_COOKIE_DOMAIN");
      requireValue(!attributes.has("path") || attributes.get("path") === "/", "UNEXPECTED_COOKIE_PATH");
      const expired = attributes.has("max-age") ? Number(attributes.get("max-age")) <= 0 : attributes.has("expires") && Date.parse(attributes.get("expires")) <= Date.now();
      if (!value || expired) this.cookies.delete(name); else this.cookies.set(name, value);
    }
    let json;
    try { json = await response.json(); } catch { throw new CheckFailure("NON_JSON_HTTP_RESPONSE", response.status); }
    if (!expected.includes(response.status)) {
      // Only API's short uppercase machine codes may enter the report.
      const code = typeof json?.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(json.code) ? json.code : "UNEXPECTED_HTTP_STATUS";
      throw new CheckFailure(code, response.status);
    }
    return json;
  }
}

function checkedNote(body, id) {
  const note = body?.note;
  requireValue(note?.id === id && Number.isSafeInteger(note.storageVersion) && note.storageVersion > 0 && Number.isSafeInteger(note.revision) && note.revision > 0, "INVALID_NOTE_ACK");
  return note;
}

async function listAll(session) {
  const notes = [], seen = new Set();
  let cursor = null;
  for (;;) {
    const body = await session.request(`/api/notes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    requireValue(Array.isArray(body.notes) && body.notes.length <= 10 && (body.nextCursor === null || typeof body.nextCursor === "string"), "INVALID_LIST_RESPONSE");
    for (const note of body.notes) {
      requireValue(typeof note?.id === "string" && !seen.has(note.id) && (!cursor || note.id > cursor), "INVALID_LIST_PAGINATION");
      seen.add(note.id); notes.push(note);
    }
    requireValue(notes.length <= 10_000, "LIST_LIMIT_EXCEEDED");
    if (body.nextCursor === null) return notes;
    requireValue(/^[0-9a-f-]{36}$/i.test(body.nextCursor) && body.notes.length > 0 && body.nextCursor === body.notes.at(-1).id && (!cursor || body.nextCursor > cursor), "INVALID_LIST_CURSOR");
    cursor = body.nextCursor;
  }
}

async function login(session, email, password) {
  const body = await session.request("/api/auth/login", { method: "POST", body: { email, password } });
  requireValue(body.configured === true && body.authenticated === true && typeof body.user?.id === "string" && body.user.id && body.user.email?.toLowerCase() === email && session.cookies.size > 0, "LOGIN_NOT_CONFIRMED");
  session.userId = body.user.id;
}

export async function verifyLiveDeployment({ env = process.env, origin, readLocal = true, checkOnly = false } = {}) {
  const started = Date.now(), testId = randomUUID();
  const report = { schemaVersion: 1, kind: "real-deployment-http-acceptance", mode: checkOnly ? "configuration-only" : "live", startedAt: new Date(started).toISOString(), completedAt: null, passed: false, status: "running", origin: null, testRecordId: null, cleanup: "not-needed", ai: "not-called", limitations: ["HTTP 验收不能替代浏览器交互、移动设备或动画性能验收。", "检索使用正式客户端 searchNotes 算法处理真实 API 返回值；没有独立搜索 API。", "独立 cookie 会话验证跨会话读取，不声称已完成两台物理设备验收。"], steps: [] };
  let activeStep = null, primary, secondary, createAttempted = false, config;
  const persist = async () => { await mkdir(path.dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); };
  const audit = value => activeStep?.requests.push(value);
  async function step(name, action) {
    const entry = { name, status: "running", durationMs: 0, requests: [] };
    report.steps.push(entry); activeStep = entry;
    const began = Date.now();
    await persist();
    try { await action(); entry.status = "passed"; console.log(`${labels[name]}：通过`); return true; }
    catch (error) { entry.status = "failed"; entry.code = failureCode(error); if (error instanceof CheckFailure && error.status) entry.httpStatus = error.status; console.error(`${labels[name]}：未通过（${entry.code}）`); return false; }
    finally { entry.durationMs = Date.now() - began; activeStep = null; await persist(); }
  }
  const input = { userText: `【验收测试】${testId} 这是一条部署验收合成记录，不是真实私人资料。先用自己的话解释一个概念，有助于发现理解中的空白。`, sourceType: "其他", sourceName: `验收测试来源 ${testId}`, sourceUrl: "", sourceTimestamp: "", sourceExcerpt: "" };
  const title = `【验收测试・可删除】${testId}`;
  const reflection = `【验收测试理解】${testId} 我会先尝试解释，再核对原始记录；这是自动验收合成文字。`;
  const owns = note => note.id === testId && note.userText === input.userText && note.sourceName === input.sourceName;
  let note;
  try {
    if (!await step("configuration", async () => {
      const local = {};
      if (readLocal) for (const file of [".env.local", ".env.tencent-owner.local"]) {
        try { Object.assign(local, parseEnv(await readFile(path.join(project, file), "utf8"))); }
        catch (error) { if (error.code !== "ENOENT") throw new CheckFailure("LOCAL_CONFIG_UNREADABLE"); }
      }
      const values = { ...local, ...env };
      const missing = [];
      const rawOrigin = origin ?? values.APP_ORIGIN;
      const email = values.OWNER_EMAIL?.trim().toLowerCase();
      const password = values.OWNER_PASSWORD || values.OWNER_INITIAL_PASSWORD;
      if (!rawOrigin) missing.push("APP_ORIGIN_OR_--origin");
      if (!email) missing.push("OWNER_EMAIL");
      if (!password) missing.push("OWNER_PASSWORD_OR_OWNER_INITIAL_PASSWORD");
      if (missing.length) { activeStep.missingConfiguration = missing; throw new CheckFailure("MISSING_CONFIGURATION"); }
      let url;
      try { url = new URL(rawOrigin); } catch { throw new CheckFailure("INVALID_ORIGIN"); }
      requireValue(url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash, "INVALID_HTTPS_ORIGIN");
      requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && password.length <= 256, "INVALID_CREDENTIAL_FORMAT");
      report.origin = url.origin;
      config = { origin: url.origin, email, password };
    })) return report;
    if (checkOnly) { report.status = "configuration-checked-live-not-run"; return report; }
    primary = new Session(config.origin, audit); secondary = new Session(config.origin, audit);
    if (!await step("anonymous_access", async () => { await primary.request("/api/notes", { expected: [401] }); })) return report;
    if (!await step("login", () => login(primary, config.email, config.password))) return report;
    if (!await step("session", async () => {
      const body = await primary.request("/api/auth/session");
      requireValue(body.authenticated === true && body.user?.id === primary.userId, "SESSION_NOT_CONFIRMED");
    })) return report;
    if (!await step("source_intake", async () => {
      const marker = `来源验收${testId}`;
      const body = await primary.request("/api/source-intake", { method: "POST", body: {
        transcript: `这是播客，节目名叫${marker}，时间点十八分二十秒，原话是${marker}原文。`, currentSourceType: "文章",
      }, timeout: 75_000 });
      const source = body?.source;
      requireValue(source?.sourceType === "播客" && source.sourceName?.includes(testId)
        && /18\D*20/.test(source.sourceTimestamp ?? "") && source.sourceExcerpt?.includes(testId), "SOURCE_INTAKE_NOT_CONFIRMED");
    })) return report;
    if (!await step("create", async () => {
      // Record the unique ID before the request: a timeout may still commit.
      report.testRecordId = testId; report.cleanup = "pending"; createAttempted = true; await persist();
      note = checkedNote(await primary.request("/api/notes", { method: "POST", body: { id: testId, input }, expected: [201] }), testId);
      requireValue(owns(note) && note.title.startsWith("【验收测试】") && note.isExample === false, "CAPTURE_NOT_PRESERVED");
    })) return report;
    if (!await step("mark_test_title", async () => {
      note = checkedNote(await primary.request(`/api/notes/${testId}`, { method: "PATCH", body: { action: "meta", expectedVersion: note.storageVersion, input: { title, tags: ["验收测试"] } } }), testId);
      requireValue(note.title === title && owns(note), "TEST_MARKER_NOT_PRESERVED");
    })) return report;
    if (!await step("list", async () => {
      const found = (await listAll(primary)).find(item => item.id === testId);
      requireValue(found && owns(found) && found.title === title, "SAVED_RECORD_MISSING_FROM_LIST");
    })) return report;
    if (!await step("delete_plan", async () => {
      const body = await primary.request("/api/delete-plan", { method: "POST", body: { command: `找出标题中含有验收测试编号 ${testId} 的记录` }, timeout: 75_000 });
      requireValue(typeof body?.plan?.interpretation === "string" && body.plan.interpretation.length > 0
        && Array.isArray(body.plan.matches) && body.plan.matches.length === 1
        && body.plan.matches[0]?.id === testId && typeof body.plan.matches[0]?.reason === "string", "DELETE_PLAN_NOT_CONFIRMED");
      const stored = checkedNote(await primary.request(`/api/notes/${testId}`), testId);
      requireValue(owns(stored) && stored.storageVersion === note.storageVersion, "DELETE_PLAN_CHANGED_RECORD");
    })) return report;
    if (!await step("second_login", async () => { await login(secondary, config.email, config.password); requireValue(secondary.userId === primary.userId, "SECOND_SESSION_IDENTITY_MISMATCH"); })) return report;
    if (!await step("cross_session_read", async () => {
      const found = checkedNote(await secondary.request(`/api/notes/${testId}`), testId);
      requireValue(owns(found) && found.storageVersion === note.storageVersion, "CROSS_SESSION_SAVE_NOT_VISIBLE");
    })) return report;
    const aiPassed = await step("ai", async () => {
      report.ai = "requested-once"; await persist();
      const body = await primary.request("/api/organize", { method: "POST", body: { id: testId, revision: note.revision }, timeout: 75_000 });
      note = checkedNote(body, testId);
      requireValue(body.applied === true && note.aiStatus === "done" && note.aiInputRevision === note.revision && note.aiResult && owns(note) && note.title === title, "AI_RESULT_NOT_CONFIRMED");
      requireValue(note.aiResult.sourceSummary === null && Array.isArray(note.aiResult.keyPoints) && note.aiResult.keyPoints.every(point => point.origin === "用户记录") && note.aiResult.reflectionQuestions?.length > 0, "AI_SOURCE_BOUNDARY_FAILED");
      const stored = checkedNote(await secondary.request(`/api/notes/${testId}`), testId);
      requireValue(stored.aiStatus === "done" && JSON.stringify(stored.aiResult) === JSON.stringify(note.aiResult), "AI_RESULT_NOT_PERSISTED");
      report.ai = "real-result-persisted";
    });
    if (!aiPassed) report.ai = "failed-or-unconfirmed";
    // A provider failure should not hide whether original text/reflections work.
    const reflectionPassed = await step("reflection", async () => {
      note = checkedNote(await primary.request(`/api/notes/${testId}`), testId);
      requireValue(owns(note), "TEST_RECORD_OWNERSHIP_MISMATCH");
      const version = note.storageVersion;
      note = checkedNote(await primary.request(`/api/notes/${testId}`, { method: "PATCH", body: { action: "reflection", expectedVersion: version, input: { text: reflection, prompt: "现在，你会怎样解释它？" } } }), testId);
      requireValue(owns(note) && note.reflectionText === reflection && note.storageVersion > version, "REFLECTION_NOT_SAVED");
      const stored = checkedNote(await secondary.request(`/api/notes/${testId}`), testId);
      requireValue(stored.reflectionText === reflection && stored.storageVersion === note.storageVersion, "REFLECTION_NOT_SYNCED");
    });
    if (reflectionPassed) await step("search", async () => {
      const notes = await listAll(secondary);
      const matches = searchNotes(notes, `${testId} 验收测试理解`);
      requireValue(matches.length === 1 && matches[0].note.id === testId && matches[0].matchedField === "我自己的理解", "SEARCH_DID_NOT_FIND_SAVED_REFLECTION");
    });
  } finally {
    if (createAttempted && primary?.userId) {
      const cleaned = await step("delete", async () => {
        const body = await primary.request(`/api/notes/${testId}`, { expected: [200, 404] });
        if (body.code === "NOT_FOUND") { report.cleanup = "confirmed-absent"; return; }
        const current = checkedNote(body, testId);
        requireValue(owns(current), "CLEANUP_REFUSED_MARKER_MISMATCH");
        const deleted = await primary.request(`/api/notes/${testId}`, { method: "DELETE", body: { expectedVersion: current.storageVersion } });
        requireValue(deleted.success === true, "DELETE_NOT_CONFIRMED");
        const missing = await primary.request(`/api/notes/${testId}`, { expected: [404] });
        requireValue(missing.code === "NOT_FOUND", "DELETED_RECORD_STILL_VISIBLE");
        report.cleanup = "confirmed-deleted";
      });
      if (!cleaned) report.cleanup = "failed-or-unconfirmed-only-test-id-may-remain";
    }
    if (secondary?.cookies.size) await step("second_logout", async () => {
      const body = await secondary.request("/api/auth/logout", { method: "POST", body: {} });
      requireValue(body.success === true, "SECOND_LOGOUT_NOT_CONFIRMED");
    });
    if (primary?.cookies.size) {
      await step("logout", async () => {
        const body = await primary.request("/api/auth/logout", { method: "POST", body: {} });
        requireValue(body.success === true, "LOGOUT_NOT_CONFIRMED");
      });
      await step("logout_verified", async () => {
        const body = await primary.request("/api/auth/session");
        requireValue(body.authenticated === false && body.user === null, "SESSION_STILL_AUTHENTICATED");
        await primary.request("/api/notes", { expected: [401] });
      });
    }
    for (const name of stepNames) if (!report.steps.some(step => step.name === name)) report.steps.push({ name, status: "not-run", reason: checkOnly ? "configuration-only" : "prerequisite-not-met" });
    report.completedAt = new Date().toISOString();
    report.durationMs = Date.now() - started;
    report.passed = !checkOnly && report.steps.every(step => step.status === "passed") && report.ai === "real-result-persisted";
    if (report.status === "running") report.status = report.passed ? "passed" : "failed";
    primary?.cookies.clear(); secondary?.cookies.clear(); config = null;
    await persist();
    console.log(report.passed ? "真实 HTTP 验收通过；移动端和浏览器交互仍需单独验收。" : "真实 HTTP 验收未通过或尚未执行；结果见 test-results/live-acceptance.json。");
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const originIndex = args.indexOf("--origin");
  const allowed = new Set(["--check-config", "--no-env"]);
  if (args.some((arg, index) => !allowed.has(arg) && !(arg === "--origin" && args[index + 1] && !args[index + 1].startsWith("--")) && !(index > 0 && args[index - 1] === "--origin"))) {
    console.error("参数无效。用法：npm run verify:live -- [--origin HTTPS网址] [--check-config] [--no-env]"); process.exitCode = 1; return;
  }
  try {
    const report = await verifyLiveDeployment({ origin: originIndex >= 0 ? args[originIndex + 1] : undefined, checkOnly: args.includes("--check-config"), readLocal: !args.includes("--no-env") });
    process.exitCode = report.passed || report.status === "configuration-checked-live-not-run" ? 0 : 1;
  } catch {
    console.error("验收程序未能完整结束或写入报告；未输出敏感响应，也未确认通过。请检查报告中的测试记录 ID。" ); process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
