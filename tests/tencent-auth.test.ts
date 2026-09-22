import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "../src/app/api/auth/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { GET as session } from "../src/app/api/auth/session/route";
import { GET as passwordStatus, POST as password } from "../src/app/api/auth/password/route";
import { POST as verify } from "../src/app/api/auth/password/verify/route";
import { isCloudConfigured, requirePrivateUser } from "../src/lib/server/supabase";

const mocks = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn(), fetch: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  getAll: () => Array.from(mocks.values, ([name, value]) => ({ name, value })),
  set: mocks.set,
}) }));
const origin = "http://localhost:3000";
const environment = "echo-demo-123456";
const baseUrl = `https://${environment}.api.tcloudbasegateway.com`;
const owner = { sub: "cloudbase-string-uid", username: "echo-owner", status: "ACTIVE", email: "owner@example.com" };
const tokens = { token_type: "Bearer", access_token: "private-access-token", refresh_token: "private-refresh-token", expires_in: 7200, sub: owner.sub };
function post(path: string, body: unknown = {}, requestOrigin = origin, expectedId?: string) {
  return new Request(origin + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: requestOrigin, ...(expectedId ? { "x-echo-user-id": expectedId } : {}) }, body: JSON.stringify(body) });
}
function seedSession(overrides: Record<string, string> = {}) {
  const value = Buffer.from(JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, sub: owner.sub, environment, ...overrides })).toString("base64url");
  mocks.values.clear();
  for (let index = 0; index * 3000 < value.length; index++) mocks.values.set("echo-tencent-session." + index, value.slice(index * 3000, (index + 1) * 3000));
}
function reply(data: unknown, status = 200) { return Response.json(data, { status }); }
const callsTo = (path: string) => mocks.fetch.mock.calls.filter(([url]) => String(url) === baseUrl + path);
beforeEach(() => {
  vi.resetAllMocks(); mocks.values.clear();
  vi.stubEnv("CLOUD_PROVIDER", "cloudbase"); vi.stubEnv("CLOUDBASE_ENV_ID", environment); vi.stubEnv("OWNER_USERNAME", owner.username);
  vi.stubEnv("OWNER_EMAIL", owner.email); vi.stubEnv("APP_ORIGIN", ""); vi.stubEnv("NODE_ENV", "test");
  vi.stubGlobal("fetch", mocks.fetch);
  delete (globalThis as { __echoRateLimits?: unknown }).__echoRateLimits;
  delete (globalThis as { __echoTencentRefreshes?: unknown }).__echoTencentRefreshes;
  mocks.set.mockImplementation((name: string, value: string, options: { maxAge: number }) => {
    if (options.maxAge === 0) mocks.values.delete(name); else mocks.values.set(name, value);
  });
  mocks.fetch.mockImplementation(async (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/auth/v1/signin") return reply(tokens);
    if (path === "/auth/v1/user/me") return reply(owner);
    if (path === "/auth/v1/token") return reply({ ...tokens, access_token: "refreshed-access", refresh_token: "refreshed-refresh" });
    if (path.startsWith("/v1/rdb/rest/")) return reply([]);
    return reply({});
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Tencent CloudBase Auth v2 (simulated provider, no live cloud account)", () => {
  it("requires a safe environment and username configuration and makes no unconfigured calls", async () => {
    expect(isCloudConfigured()).toBe(true);
    vi.stubEnv("CLOUDBASE_ENV_ID", "malicious.example/path");
    expect(isCloudConfigured()).toBe(false);
    expect(await (await session()).json()).toMatchObject({ configured: false, authenticated: false });
    expect((await login(post("/api/auth/login", { email: owner.email, password: "secret" }))).status).toBe(503);
    expect(mocks.fetch).not.toHaveBeenCalled();
    vi.stubEnv("CLOUDBASE_ENV_ID", environment); vi.stubEnv("OWNER_USERNAME", "不支持的用户名");
    expect(isCloudConfigured()).toBe(false);
    vi.stubEnv("CLOUD_PROVIDER", "unknown-provider"); expect(isCloudConfigured()).toBe(false);
  });
  it("logs in through the documented username endpoint, verifies the owner, and keeps tokens out of JSON", async () => {
    const response = await login(post("/api/auth/login", { email: "OWNER@example.com", password: "CorrectPrivatePassword!1" }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ authenticated: true, user: { id: owner.sub, email: owner.email } });
    expect(body).not.toContain("token");
    const [, options] = callsTo("/auth/v1/signin")[0];
    expect(JSON.parse(options.body)).toEqual({ username: owner.username, password: "CorrectPrivatePassword!1" });
    expect(options).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    expect(callsTo("/auth/v1/user/me")[0][1].headers.Authorization).toBe("Bearer private-access-token");
    expect(mocks.set).toHaveBeenCalledWith("echo-tencent-session.0", expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
  });
  it("rejects unregistered email aliases, unexpected owner identity, and malformed token responses", async () => {
    expect((await login(post("/api/auth/login", { email: "someone@example.com", password: "secret" }))).status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValueOnce(reply(tokens)).mockResolvedValueOnce(reply({ ...owner, username: "another-owner" }));
    expect((await login(post("/api/auth/login", { email: owner.email, password: "secret" }))).status).toBe(401);
    expect(mocks.set).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValueOnce(reply({ access_token: "alone-is-not-a-session" }));
    expect((await login(post("/api/auth/login", { email: owner.email, password: "secret" }))).status).toBe(503);
  });
  it("uses verified user tokens for PostgREST and preserves the string user ID", async () => {
    seedSession();
    const { client, user } = await requirePrivateUser();
    expect(user).toEqual({ id: owner.sub, email: owner.email });
    await client.from("echo_notes").select("*");
    const [url, options] = mocks.fetch.mock.calls.find(([url]) => String(url).includes("/v1/rdb/rest/"))!;
    expect(String(url)).toBe(baseUrl + "/v1/rdb/rest/echo_notes?select=*");
    expect(new Headers(options.headers).get("authorization")).toBe("Bearer private-access-token");
    expect(new Headers(options.headers).get("apikey")).toBeNull();
    expect(options.cache).toBe("no-store");
  });
  it("never authorizes missing, cross-environment, forged-sub, or different-owner cookies", async () => {
    expect(await (await session()).json()).toMatchObject({ configured: true, authenticated: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
    seedSession({ environment: "different-env" });
    await expect(requirePrivateUser()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    seedSession({ sub: "forged-sub" });
    await expect(requirePrivateUser()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    seedSession(); mocks.fetch.mockResolvedValueOnce(reply({ ...owner, username: "different-owner" }));
    await expect(requirePrivateUser()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
  it("refreshes expired tokens once for concurrent requests and verifies the new user before authorizing", async () => {
    seedSession();
    mocks.fetch.mockImplementation(async (url: string, options: RequestInit) => {
      if (url.endsWith("/token")) return reply({ ...tokens, access_token: "refreshed-access", refresh_token: "refreshed-refresh" });
      return new Headers(options.headers).get("Authorization") === "Bearer private-access-token" ? reply({ error: "invalid_token" }, 401) : reply(owner);
    });
    const results = await Promise.all([requirePrivateUser(), requirePrivateUser()]);
    expect(results.every(result => result.user.id === owner.sub)).toBe(true);
    expect(callsTo("/auth/v1/token")).toHaveLength(1);
    expect(JSON.parse(callsTo("/auth/v1/token")[0][1].body)).toEqual({ client_id: environment, grant_type: "refresh_token", refresh_token: tokens.refresh_token });
    const stored = JSON.parse(Buffer.from([...mocks.values.values()].join(""), "base64url").toString());
    expect(stored.access_token).toBe("refreshed-access");
  });
  it("does not clear a potentially newer session when rotating refresh tokens race across instances", async () => {
    seedSession();
    mocks.fetch.mockResolvedValueOnce(reply({ error: "invalid_token" }, 401)).mockResolvedValueOnce(reply({ error: "invalid_grant" }, 400));
    const response = await session();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "SESSION_REFRESH_RETRY" });
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.set.mock.calls[0][0]).toBe("echo-tencent-refresh-retry");
    expect(mocks.values.get("echo-tencent-session.0")).toBeTruthy();
  });
  it("returns a login-ready session after repeated invalid_grant while preserving cookies against delayed responses", async () => {
    seedSession();
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.fetch.mockImplementation(async (url: string) => url.endsWith("/token") ? reply({ error: "invalid_grant" }, 400) : reply({ error: "invalid_token" }, 401));
    expect((await session()).status).toBe(503);
    now += 31_000;
    const response = await session();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ configured: true, authenticated: false, user: null });
    expect(mocks.set.mock.calls.every(([name]) => name === "echo-tencent-refresh-retry")).toBe(true);
    mocks.fetch.mockImplementation(async (url: string) => reply(url.endsWith("/signin") ? tokens : owner));
    expect((await login(post("/api/auth/login", { email: owner.email, password: "CorrectPrivatePassword!1" }))).status).toBe(200);
    expect(mocks.values.has("echo-tencent-refresh-retry")).toBe(false);
  });
  it("allows explicit logout of confirmed expired sessions but never revokes another live identity", async () => {
    seedSession();
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.fetch.mockImplementation(async (url: string) => url.endsWith("/token") ? reply({ error: "invalid_grant" }, 400) : reply({ error: "invalid_token" }, 401));
    expect((await logout(post("/api/auth/logout", {}, origin, owner.sub))).status).toBe(503);
    now += 31_000;
    expect(await (await logout(post("/api/auth/logout", {}, origin, owner.sub))).json()).toEqual({ success: true });
    expect(mocks.values.size).toBe(0);
    expect(callsTo("/auth/v1/user/signout")).toHaveLength(0);
    seedSession({ sub: "new-live-user", access_token: "new-live-access", refresh_token: "new-live-refresh" });
    mocks.fetch.mockResolvedValue(reply({ ...owner, sub: "new-live-user" }));
    expect((await logout(post("/api/auth/logout", {}, origin, owner.sub))).status).toBe(401);
    expect(callsTo("/auth/v1/user/signout")).toHaveLength(0);
    expect(mocks.values.has("echo-tencent-session.0")).toBe(true);
  });
  it("preserves rotated tokens through verification outages and still requires verification after an instance restart", async () => {
    seedSession();
    mocks.fetch.mockResolvedValueOnce(reply({ error: "invalid_token" }, 401))
      .mockResolvedValueOnce(reply({ ...tokens, access_token: "rotated-access", refresh_token: "rotated-refresh" }))
      .mockResolvedValueOnce(reply({ error: "temporary_outage" }, 503));
    await expect(requirePrivateUser()).rejects.toMatchObject({ status: 503 });
    const stored = JSON.parse(Buffer.from([...mocks.values.values()].join(""), "base64url").toString());
    expect(stored).toMatchObject({ access_token: "rotated-access", refresh_token: "rotated-refresh" });
    expect(mocks.set.mock.calls.every(([, , options]) => options.httpOnly === true)).toBe(true);
    expect(mocks.fetch.mock.calls.some(([url]) => String(url).includes("/v1/rdb/rest"))).toBe(false);
    delete (globalThis as { __echoTencentRefreshes?: unknown }).__echoTencentRefreshes;
    const identity = await requirePrivateUser();
    expect(identity.user.id).toBe(owner.sub);
    expect(callsTo("/auth/v1/token")).toHaveLength(1);
    expect(callsTo("/auth/v1/user/me").at(-1)?.[1].headers.Authorization).toBe("Bearer rotated-access");
  });
  it("does not mistake transient or unrecognized refresh errors for expired sessions", async () => {
    seedSession();
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.fetch.mockImplementation(async (url: string) => url.endsWith("/token") ? reply({ error: "invalid_grant" }, 400) : reply({ error: "invalid_token" }, 401));
    expect((await session()).status).toBe(503);
    now += 31_000;
    mocks.fetch.mockImplementation(async (url: string) => url.endsWith("/token") ? reply({ error: "temporarily_unavailable" }, 400) : reply({ error: "invalid_token" }, 401));
    const response = await session();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "AUTH_UNAVAILABLE" });
    expect(mocks.values.has("echo-tencent-session.0")).toBe(true);
  });
  it("reports malformed responses, provider outages, and timeouts without leaking provider detail or declaring logout", async () => {
    seedSession();
    for (const result of [new Response("private HTML error", { status: 403 }), reply({ error: "private backend detail" }, 500)]) {
      mocks.fetch.mockResolvedValueOnce(result);
      const response = await session();
      expect(response.status).toBe(503); expect(await response.text()).not.toContain("private");
    }
    mocks.fetch.mockRejectedValueOnce(new DOMException("private timeout", "TimeoutError"));
    expect((await session()).status).toBe(503);
  });
  it("chunks long session cookies securely and reassembles them for verified sessions", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("APP_ORIGIN", "https://echo.example.com");
    mocks.fetch.mockResolvedValueOnce(reply({ ...tokens, access_token: "a".repeat(6000) }));
    const request = new Request("https://echo.example.com/api/auth/login", { method: "POST", headers: { Origin: "https://echo.example.com", "Content-Type": "application/json" }, body: JSON.stringify({ email: owner.email, password: "private password" }) });
    expect((await login(request)).status).toBe(200);
    expect(mocks.values.size).toBeGreaterThan(1);
    for (const [, value, options] of mocks.set.mock.calls) {
      expect(value.length).toBeLessThanOrEqual(3000);
      expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    }
    expect(await (await session()).json()).toMatchObject({ authenticated: true });
  });
  it("protects mutation origins and stale tabs before password changes or logout", async () => {
    seedSession();
    expect((await logout(post("/api/auth/logout", {}, "https://evil.example"))).status).toBe(403);
    expect((await verify(post("/api/auth/password/verify", {}, "https://evil.example"))).status).toBe(403);
    expect((await password(post("/api/auth/password", {}, origin, "other-id"))).status).toBe(401);
    expect((await logout(post("/api/auth/logout", {}, origin, "other-id"))).status).toBe(401);
    expect(callsTo("/auth/v1/user/signout")).toHaveLength(0);
    expect(callsTo("/auth/v1/user/password")).toHaveLength(0);
    expect(callsTo("/auth/v1/user/reauthenticate")).toHaveLength(0);
  });
  it("only confirms logout after a successful provider response and clears local cookies", async () => {
    seedSession(); mocks.fetch.mockResolvedValueOnce(reply({ error: "server_problem" }, 500));
    expect((await logout(post("/api/auth/logout"))).status).toBe(503);
    expect(mocks.values.size).toBe(1);
    expect(await (await logout(post("/api/auth/logout"))).json()).toEqual({ success: true });
    expect(callsTo("/auth/v1/user/signout").at(-1)?.[1]).toMatchObject({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer private-access-token" }) });
    expect(mocks.values.size).toBe(0);
  });
  it("describes required second verification and refuses to send a code without a bound contact", async () => {
    seedSession();
    const status = await passwordStatus(new Request(origin + "/api/auth/password"));
    expect(await status.json()).toMatchObject({ requiresVerification: true, verificationAvailable: true, verificationMethod: "email" });
    mocks.fetch.mockResolvedValueOnce(reply({ ...owner, email: "" }));
    const response = await verify(post("/api/auth/password/verify"));
    expect(response.status).toBe(409); expect(callsTo("/auth/v1/user/reauthenticate")).toHaveLength(0);
  });
  it("sends password verification through the documented endpoint and throttles repeated sends", async () => {
    seedSession();
    const response = await verify(post("/api/auth/password/verify"));
    expect(await response.json()).toMatchObject({ success: true, method: "email" });
    expect(JSON.parse(callsTo("/auth/v1/user/reauthenticate")[0][1].body)).toEqual({ verify_opt: "email_code" });
    expect((await verify(post("/api/auth/password/verify"))).status).toBe(429);
    expect(callsTo("/auth/v1/user/reauthenticate")).toHaveLength(1);
  });
  it("requires verification and strong passwords and never confirms an unsuccessful password mutation", async () => {
    seedSession();
    const body = { currentPassword: "OldPrivatePassword!1", newPassword: "NewPrivatePassword!2" };
    expect((await password(post("/api/auth/password", body))).status).toBe(400);
    expect((await password(post("/api/auth/password", { ...body, newPassword: "weakbutlongpassword", verificationCode: "123456" }))).status).toBe(400);
    expect(callsTo("/auth/v1/user/password")).toHaveLength(0);
    mocks.fetch.mockResolvedValueOnce(reply(owner)).mockResolvedValueOnce(reply({ error: "invalid_password" }, 400));
    expect((await password(post("/api/auth/password", { ...body, verificationCode: "123456" }))).status).toBe(400);
    mocks.fetch.mockResolvedValueOnce(reply(owner)).mockResolvedValueOnce(reply({ success: false }));
    expect((await password(post("/api/auth/password", { ...body, verificationCode: "123456" }))).status).toBe(503);
    expect(await (await password(post("/api/auth/password", { ...body, verificationCode: "123456" }))).json()).toEqual({ success: true });
    const [, options] = callsTo("/auth/v1/user/password").at(-1)!;
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(options.body)).toEqual({ old_password: body.currentPassword, new_password: body.newPassword, confirm_password: body.newPassword, verify_code: "123456" });
  });
});
