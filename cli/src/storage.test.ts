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
    const { FileAuthStorage, setDefaultWorkspace } = await import("./storage.js");
    await new FileAuthStorage().setItem("session", "secret");
    await setDefaultWorkspace("user", "workspace");

    if (process.platform !== "win32") {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(directory, "auth.json"))).mode & 0o777).toBe(0o600);
      expect((await stat(join(directory, "settings.json"))).mode & 0o777).toBe(0o600);
    }
    expect(JSON.parse(await readFile(join(directory, "auth.json"), "utf8"))).toEqual({ session: "secret" });
    await expect((await import("node:fs/promises")).readdir(directory).then((files) => files.some((file) => file.endsWith(".tmp"))))
      .resolves.toBe(false);
  });

  it("keeps authentication files isolated by service", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anttodo-cli-service-storage-"));
    temporaryDirectories.push(directory);
    process.env.ANTTODO_STATE_DIR = directory;
    const { FileAuthStorage, setActiveServiceKey } = await import("./storage.js");

    setActiveServiceKey("service-a");
    await new FileAuthStorage("service-a").setItem("session", "a");
    setActiveServiceKey("service-b");
    await new FileAuthStorage("service-b").setItem("session", "b");

    await expect(new FileAuthStorage("service-a").getItem("session")).resolves.toBe("a");
    await expect(new FileAuthStorage("service-b").getItem("session")).resolves.toBe("b");
  });
});
