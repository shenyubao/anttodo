import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const directories: string[] = [];

function manifest(appUrl: string, suffix: string) {
  return {
    schemaVersion: 1,
    instanceId: `8e78719f-8d1f-4d0d-90fc-b18c7f99fd${suffix}1`,
    displayName: `Service ${suffix}`,
    appUrl,
    supabaseUrl: appUrl,
    publishableKey: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
    deviceAuthorizationEndpoint: `${appUrl}/functions/v1/cli-device-auth`,
  };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.ANTTODO_STATE_DIR;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("custom service selection", () => {
  it("supports one-shot discovery without changing the saved service", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anttodo-cli-service-"));
    directories.push(directory);
    process.env.ANTTODO_STATE_DIR = directory;
    const config = await import("./config.js");
    const storage = await import("./storage.js");
    const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(manifest("https://one.example.com", "1"))));

    const selected = await config.loadPublicConfig({ serviceUrl: "https://one.example.com" });

    expect(selected.appUrl).toBe("https://one.example.com");
    await expect(storage.getSelectedServiceKey()).resolves.toBeUndefined();
  });

  it("persists a service and can recover its cached manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anttodo-cli-service-"));
    directories.push(directory);
    process.env.ANTTODO_STATE_DIR = directory;
    const config = await import("./config.js");
    const storage = await import("./storage.js");
    const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const fetchMock = vi.fn().mockResolvedValueOnce(response(manifest("https://saved.example.com", "2")));
    vi.stubGlobal("fetch", fetchMock);

    const saved = await config.useService("https://saved.example.com");
    expect(await storage.getSelectedServiceKey()).toBe(saved.serviceKey);

    fetchMock.mockRejectedValue(new TypeError("offline"));
    const recovered = await config.loadPublicConfig();
    expect(recovered).toMatchObject({ appUrl: "https://saved.example.com", source: "cache" });
  });
});
