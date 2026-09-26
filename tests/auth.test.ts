import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as session } from "../src/app/api/auth/session/route";
import { POST as login } from "../src/app/api/auth/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { POST as password } from "../src/app/api/auth/password/route";
import { createPrivateClient, isCloudConfigured, requirePrivateUser } from "../src/lib/server/supabase";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), getAll: vi.fn(), set: vi.fn(), getUser: vi.fn(), signInWithPassword: vi.fn(),
  signOut: vi.fn(), updateUser: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.create }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: mocks.getAll, set: mocks.set }) }));

const origin = "http://localhost:3000";
const user = { id: "22a3de4f-3453-4fa7-b465-b1a305e18b18", email: "owner@example.com" };
const client = { auth: { getUser: mocks.getUser, signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut, updateUser: mocks.updateUser } };
function post(path: string, data: unknown = {}, requestOrigin = origin, expectedUser?: string) {
  return new Request(origin + path, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: requestOrigin, ...(expectedUser ? { "x-echo-user-id": expectedUser } : {}) },
    body: JSON.stringify(data),
  });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("CLOUD_PROVIDER", "supabase"); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("SUPABASE_URL", "https://testproject.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "sb_publishable_mock"); vi.stubEnv("OWNER_EMAIL", user.email); vi.stubEnv("APP_ORIGIN", "");
  delete (globalThis as { __echoRateLimits?: unknown }).__echoRateLimits;
  mocks.create.mockReturnValue(client); mocks.getAll.mockReturnValue([]);
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.signInWithPassword.mockResolvedValue({ data: { user, session: { access_token: "private-access-token" } }, error: null });
  mocks.signOut.mockResolvedValue({ error: null }); mocks.updateUser.mockResolvedValue({ data: { user }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("private account routes (mocked auth provider)", () => {
  it("shows missing configuration without attempting provider calls or claiming authentication", async () => {
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    expect(isCloudConfigured()).toBe(false);
    expect(await (await session()).json()).toMatchObject({ configured: false, authenticated: false, user: null });
    expect((await login(post("/api/auth/login", { email: user.email, password: "anything" }))).status).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("refuses runtime service-role/secret keys and insecure production endpoints", () => {
    vi.stubEnv("SUPABASE_ANON_KEY", "sb_secret_test"); expect(isCloudConfigured()).toBe(false);
    const token = "header." + Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url") + ".sig";
    vi.stubEnv("SUPABASE_ANON_KEY", token); expect(isCloudConfigured()).toBe(false);
    vi.stubEnv("SUPABASE_ANON_KEY", "sb_publishable_mock"); vi.stubEnv("SUPABASE_URL", "http://testproject.supabase.co");
    expect(isCloudConfigured()).toBe(false);
  });
  it("uses fresh verified identity and never returns session tokens", async () => {
    const response = await session();
    expect(await response.json()).toEqual({ configured: true, authenticated: true, user, message: "已登录账号。" });
    expect(mocks.getUser).toHaveBeenCalledTimes(1); expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const loggedIn = await login(post("/api/auth/login", { email: "OWNER@example.com", password: "a-private-password" }));
    const text = await loggedIn.text();
    expect(loggedIn.status).toBe(200); expect(text).not.toContain("access_token"); expect(text).not.toContain("private-access-token");
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: user.email, password: "a-private-password" });
  });
  it("treats expired cookies as unauthenticated and accepts another registered account", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 401, code: "session_not_found" } });
    expect(await (await session()).json()).toMatchObject({ configured: true, authenticated: false, user: null });
    mocks.getUser.mockResolvedValueOnce({ data: { user: { ...user, email: "someone@example.com" } }, error: null });
    await expect(requirePrivateUser()).resolves.toMatchObject({ user: { email: "someone@example.com" } });
  });
  it("does not turn provider outages into logged-out or successful states", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 503, message: "private provider detail" } });
    const response = await session();
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private provider detail");
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: { name: "AuthUnknownError", message: "HTML proxy error" } });
    expect((await session()).status).toBe(503);
    mocks.signOut.mockResolvedValueOnce({ error: { status: 500 } });
    expect((await logout(post("/api/auth/logout"))).status).toBe(503);
  });
  it("allows any registered account and returns generic credential failures", async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({ data: { user: { ...user, email: "someone@example.com" }, session: { access_token: "other-access-token" } }, error: null });
    const response = await login(post("/api/auth/login", { email: "someone@example.com", password: "unknown-password" }));
    expect(response.status).toBe(200); expect((await response.json()).user.email).toBe("someone@example.com");
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "someone@example.com", password: "unknown-password" });
    mocks.signInWithPassword.mockResolvedValueOnce({ data: { user: null, session: null }, error: { status: 400 } });
    expect((await login(post("/api/auth/login", { email: user.email, password: "wrong-password" }))).status).toBe(401);
  });
  it("applies same-origin and body bounds before sensitive account changes", async () => {
    expect((await login(post("/api/auth/login", {}, "https://evil.example"))).status).toBe(403);
    expect((await logout(post("/api/auth/logout", {}, "https://evil.example"))).status).toBe(403);
    expect((await password(post("/api/auth/password", {}, "https://evil.example"))).status).toBe(403);
    expect((await login(post("/api/auth/login", { email: user.email, password: "x".repeat(5000) }))).status).toBe(413);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled(); expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it("accepts the browser host when Next dev binds to 0.0.0.0", async () => {
    const request = new Request("http://0.0.0.0:3000/api/auth/login", {
      method: "POST", headers: { Host: "localhost:3000", Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: "a-private-password" }),
    });
    expect((await login(request)).status).toBe(200);
  });
  it("protects a stale tab from acting as a different user", async () => {
    await expect(requirePrivateUser(post("/api/notes", {}, origin, "another-user"))).rejects.toMatchObject({ status: 401, code: "SESSION_CHANGED" });
    expect((await password(post("/api/auth/password", { currentPassword: "old-private-password", newPassword: "new-private-password" }, origin, "another-user"))).status).toBe(401);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled(); expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it("throttles password guessing before repeated provider attempts", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { status: 400 } });
    for (let i = 0; i < 15; i++) expect((await login(post("/api/auth/login", { email: user.email, password: "wrong-password" }))).status).toBe(401);
    expect((await login(post("/api/auth/login", { email: user.email, password: "wrong-password" }))).status).toBe(429);
    expect(mocks.signInWithPassword).toHaveBeenCalledTimes(15);
  });
  it("verifies the current password before changing it and reports rejected changes", async () => {
    const data = { currentPassword: "old-private-password", newPassword: "new-private-password" };
    mocks.signInWithPassword.mockResolvedValueOnce({ data: { user: null, session: null }, error: { status: 400 } });
    expect((await password(post("/api/auth/password", data))).status).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
    mocks.updateUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 422 } });
    expect((await password(post("/api/auth/password", data))).status).toBe(400);
    expect((await password(post("/api/auth/password", data))).status).toBe(200);
    expect(mocks.updateUser).toHaveBeenLastCalledWith({ password: "new-private-password" });
  });
  it("uses HttpOnly secure cookies and supports refreshed/chunked cookies in route handlers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await createPrivateClient();
    const options = mocks.create.mock.calls[0][2];
    expect(options.cookieOptions).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    options.cookies.setAll([
      { name: "sb-test-auth-token.0", value: "refreshed-part-0", options: { httpOnly: false, maxAge: 123 } },
      { name: "sb-test-auth-token.1", value: "", options: { maxAge: 0 } },
    ]);
    expect(mocks.set).toHaveBeenNthCalledWith(1, "sb-test-auth-token.0", "refreshed-part-0", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 123 });
    expect(mocks.set).toHaveBeenNthCalledWith(2, "sb-test-auth-token.1", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  });
  it("only confirms logout after provider completion", async () => {
    let finish!: (result: { error: null }) => void;
    let started!: () => void;
    const pendingSignal = new Promise<void>(resolve => { started = resolve; });
    mocks.signOut.mockImplementationOnce(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    let complete = false;
    const pending = logout(post("/api/auth/logout")).then(value => { complete = true; return value; });
    await pendingSignal; expect(complete).toBe(false);
    finish({ error: null });
    expect(await (await pending).json()).toEqual({ success: true });
  });
});
