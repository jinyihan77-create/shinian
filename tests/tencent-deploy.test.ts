import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { prepareTencentStaging, runtimeConfigReport, runtimeUpdateBody, SOURCE_FILES, verifyTencentStaging } from "../scripts/prepare-tencent-deploy.mjs";

const fixtures: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "echo-tencent-staging-test-"));
  fixtures.push(root);
  for (const filename of SOURCE_FILES) await writeFile(path.join(root, filename), "safe source " + filename);
  await mkdir(path.join(root, "src", "app"), { recursive: true });
  await mkdir(path.join(root, "public"));
  await writeFile(path.join(root, "src", "app", "page.tsx"), "export default function Page() { return '灵感'; }");
  await writeFile(path.join(root, "public", "icon.svg"), "<svg></svg>");
  return root;
}

afterEach(async () => {
  for (const root of fixtures.splice(0)) {
    // Every target is the exact fresh path returned by mkdtemp above.
    if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith("echo-tencent-staging-test-")) throw new Error("Unexpected test cleanup path");
    await rm(root, { recursive: true, force: true });
  }
});

const runtime = {
  CLOUD_PROVIDER: "cloudbase", CLOUDBASE_ENV_ID: "echo-test-123", CLOUDBASE_REGION: "ap-shanghai",
  CLOUDBASE_AI_MODEL: "configured-model", CLOUDBASE_APIKEY: "test-api-key-not-a-real-credential",
  OWNER_USERNAME: "echo-owner", OWNER_EMAIL: "owner@example.com", APP_ORIGIN: "https://echo.example.com",
};

describe("Tencent deployment source isolation", () => {
  it("uploads only allowed build sources, excluding nested dotenv, credentials, backups and test fixtures", async () => {
    const root = await fixture();
    for (const relative of [".env.local", ".env.tencent-owner.local", "src/.env.production", "src/credentials.json", "public/秘密备份.json", "src/page.test.ts", "src/key.pem"]) {
      await writeFile(path.join(root, relative), "NEVER UPLOAD THIS SECRET");
    }
    for (const relative of ["private-data", "tests", ".cloudbase", "src/private-data", "public/backups"]) {
      await mkdir(path.join(root, relative), { recursive: true });
      await writeFile(path.join(root, relative, "secret.json"), "NEVER UPLOAD THIS SECRET");
    }
    const prepared = await prepareTencentStaging(root, runtime);
    expect(prepared.manifest.files.map((file: { path: string }) => file.path)).toEqual(expect.arrayContaining(["src/app/page.tsx", "public/icon.svg", "Dockerfile", "package-lock.json"]));
    expect(prepared.manifest.files).toHaveLength(SOURCE_FILES.length + 2);
    for (const file of prepared.manifest.files) expect(await readFile(path.join(prepared.staging, file.path), "utf8")).not.toContain("NEVER UPLOAD");
    const verified = await verifyTencentStaging(root);
    expect(verified.fileCount).toBe(SOURCE_FILES.length + 2);
    expect(prepared.manifest.runtime.ready).toBe(true);
    expect(prepared.manifest.deployment).toMatchObject({ minNum: 0, maxNum: 1, port: 3000, openAccessTypes: ["PUBLIC"] });
    expect(await readdir(prepared.staging)).not.toContain("tencent-deploy-staging.manifest.json");
  });

  it("detects added or changed upload files, and regenerates a clean reusable snapshot", async () => {
    const root = await fixture();
    const prepared = await prepareTencentStaging(root, runtime);
    await writeFile(path.join(prepared.staging, ".env.production"), "PRIVATE_PASSWORD=secret");
    await expect(verifyTencentStaging(root)).rejects.toThrow("STAGING_CHANGED");
    await prepareTencentStaging(root, runtime);
    await expect(readFile(path.join(prepared.staging, ".env.production"))).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(path.join(prepared.staging, "src", "app", "page.tsx"), "changed after preparation");
    await expect(verifyTencentStaging(root)).rejects.toThrow("STAGING_CHANGED");
    await prepareTencentStaging(root, runtime);
    await expect(verifyTencentStaging(root)).resolves.toMatchObject({ fileCount: SOURCE_FILES.length + 2 });
    expect(await readFile(path.join(root, "src", "app", "page.tsx"), "utf8")).toContain("灵感");
  });

  it("rejects source links and preserves the last complete snapshot on preparation failure", async () => {
    const root = await fixture();
    const prepared = await prepareTencentStaging(root, runtime);
    await mkdir(path.join(root, "private-data"));
    await writeFile(path.join(root, "private-data", "real-secret.json"), "do not upload");
    await symlink(path.join(root, "private-data"), path.join(root, "src", "escape"), process.platform === "win32" ? "junction" : "dir");
    await expect(prepareTencentStaging(root, runtime)).rejects.toThrow("SYMLINK_SOURCE");
    await expect(verifyTencentStaging(root)).resolves.toMatchObject({ fileCount: SOURCE_FILES.length + 2 });
    expect(await readdir(prepared.staging)).not.toContain("private-data");
  });

  it("refuses a staging directory junction before deletion and leaves its destination intact", async () => {
    const root = await fixture();
    await mkdir(path.join(root, "private-data"));
    await writeFile(path.join(root, "private-data", "keep.txt"), "keep this");
    await mkdir(path.join(root, "test-results"));
    await symlink(path.join(root, "private-data"), path.join(root, "test-results", "tencent-deploy-staging"), process.platform === "win32" ? "junction" : "dir");
    await expect(prepareTencentStaging(root, runtime)).rejects.toThrow("UNSAFE_PATH");
    expect(await readFile(path.join(root, "private-data", "keep.txt"), "utf8")).toBe("keep this");
  });
});

describe("Tencent runtime configuration preparation", () => {
  it("reports missing or invalid names without exposing supplied values", () => {
    const report = runtimeConfigReport({ ...runtime, OWNER_EMAIL: "bad-secret-value", APP_ORIGIN: "http://bad.example.com", CLOUDBASE_AI_MODEL: "" });
    expect(report.ready).toBe(false);
    expect(report.missing).toEqual(["CLOUDBASE_AI_MODEL"]);
    expect(report.invalid).toEqual(["OWNER_EMAIL", "APP_ORIGIN"]);
    expect(JSON.stringify(report)).not.toContain("bad-secret-value");
    expect(runtimeConfigReport({ ...runtime, APP_ORIGIN: "https://echo.example.com/path" }).ready).toBe(false);
    expect(runtimeConfigReport({ ...runtime, APP_ORIGIN: "https://evil.example.com@echo.example.com" }).ready).toBe(false);
  });

  it("builds a runtime API body preserving prior variables without inheriting administration secrets", () => {
    const body = runtimeUpdateBody({ env: { ...runtime, OWNER_INITIAL_PASSWORD: "DO_NOT_INCLUDE_PASSWORD", SUPABASE_SERVICE_ROLE_KEY: "DO_NOT_INCLUDE_SERVICE_KEY", TENCENTCLOUD_SECRETKEY: "DO_NOT_INCLUDE_CLI_KEY" },
      serviceName: "echo-service", previousEnvParams: JSON.stringify({ EXISTING_SETTING: "keep=value&characters" }) });
    expect(body).toMatchObject({ EnvId: runtime.CLOUDBASE_ENV_ID, ServerName: "echo-service" });
    expect(body.Items).toHaveLength(1);
    expect(body.Items[0].Key).toBe("EnvParam");
    const env = JSON.parse(body.Items[0].Value);
    expect(env).toEqual({ ...runtime, EXISTING_SETTING: "keep=value&characters" });
    expect(JSON.stringify(body)).not.toContain("DO_NOT_INCLUDE");
    expect(() => runtimeUpdateBody({ env: runtime, previousEnvParams: "[]" })).toThrow("INVALID_PREVIOUS_RUNTIME");
    expect(() => runtimeUpdateBody({ env: { ...runtime, APP_ORIGIN: "" } })).toThrow("INVALID_RUNTIME_CONFIG");
  });
});
