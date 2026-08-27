import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.resetModules();
  delete process.env.ANTTODO_STATE_DIR;
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("credential storage", () => {
  it("uses private directory and file modes with atomic JSON writes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anttodo-cli-storage-"));
    temporaryDirectories.push(directory);
    process.env.ANTTODO_STATE_DIR = directory;
    const { saveCliCredential, setDefaultWorkspace } = await import("./storage.js");
    await saveCliCredential({ schemaVersion: 2, deviceId: "device", secret: "secret", user: { id: "user", email: null, phone: null }, credentialExpiresAt: null });
    await setDefaultWorkspace("user", "workspace");

    if (process.platform !== "win32") {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(directory, "auth.json"))).mode & 0o777).toBe(0o600);
      expect((await stat(join(directory, "settings.json"))).mode & 0o777).toBe(0o600);
    }
    expect(JSON.parse(await readFile(join(directory, "auth.json"), "utf8"))).toMatchObject({ schemaVersion: 2, deviceId: "device", secret: "secret" });
    await expect((await import("node:fs/promises")).readdir(directory).then((files) => files.some((file) => file.endsWith(".tmp"))))
      .resolves.toBe(false);
  });

  it("keeps authentication files isolated by service", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anttodo-cli-service-storage-"));
    temporaryDirectories.push(directory);
    process.env.ANTTODO_STATE_DIR = directory;
    const { readCliCredential, saveCliCredential, setActiveServiceKey } = await import("./storage.js");

    setActiveServiceKey("service-a");
    await saveCliCredential({ schemaVersion: 2, deviceId: "a", secret: "a", user: { id: "user-a", email: null, phone: null }, credentialExpiresAt: null }, "service-a");
    setActiveServiceKey("service-b");
    await saveCliCredential({ schemaVersion: 2, deviceId: "b", secret: "b", user: { id: "user-b", email: null, phone: null }, credentialExpiresAt: null }, "service-b");

    await expect(readCliCredential("service-a")).resolves.toMatchObject({ credential: { deviceId: "a" }, legacy: false });
    await expect(readCliCredential("service-b")).resolves.toMatchObject({ credential: { deviceId: "b" }, legacy: false });
  });

  it("detects the retired Supabase session format", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anttodo-cli-legacy-storage-"));
    temporaryDirectories.push(directory);
    process.env.ANTTODO_STATE_DIR = directory;
    const { FileAuthStorage, readCliCredential } = await import("./storage.js");
    await new FileAuthStorage().setItem("supabase-session", "legacy-token");
    await expect(readCliCredential()).resolves.toEqual({ credential: null, legacy: true });
  });
});
