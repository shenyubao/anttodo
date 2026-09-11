import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_URL, loadPublicConfig, normalizeServiceOrigin, parseServiceManifest, setRuntimeServiceUrl } from "./config.js";

vi.mock("./storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage.js")>();
  return {
    ...actual,
    cachePublicConfig: vi.fn(),
    readCachedPublicConfig: vi.fn().mockResolvedValue(null),
    getSelectedServiceKey: vi.fn().mockResolvedValue(undefined),
    getStoredService: vi.fn().mockResolvedValue(undefined),
    listStoredServices: vi.fn().mockResolvedValue([]),
  };
});

const original = {
  url: process.env.ANTTODO_SUPABASE_URL,
  key: process.env.ANTTODO_SUPABASE_PUBLISHABLE_KEY,
  app: process.env.ANTTODO_APP_URL,
  device: process.env.ANTTODO_DEVICE_AUTH_URL,
};

afterEach(() => {
  vi.unstubAllGlobals();
  setRuntimeServiceUrl(undefined);
  for (const [name, value] of Object.entries({
    ANTTODO_SUPABASE_URL: original.url,
    ANTTODO_SUPABASE_PUBLISHABLE_KEY: original.key,
    ANTTODO_APP_URL: original.app,
    ANTTODO_DEVICE_AUTH_URL: original.device,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("public configuration", () => {
  it("normalizes service origins and rejects unsafe addresses", () => {
    expect(normalizeServiceOrigin("todo.example.com")).toBe("https://todo.example.com");
    expect(normalizeServiceOrigin("https://todo.example.com/")).toBe("https://todo.example.com");
    expect(() => normalizeServiceOrigin("https://user:pass@todo.example.com")).toThrow();
    expect(() => normalizeServiceOrigin("https://todo.example.com/path")).toThrow();
    expect(() => normalizeServiceOrigin("http://todo.example.com")).toThrow();
    expect(normalizeServiceOrigin("http://localhost:54321", true)).toBe("http://localhost:54321");
  });

  it("validates the full instance manifest and matching service origins", () => {
    const manifest = {
      schemaVersion: 1,
      instanceId: "8e78719f-8d1f-4d0d-90fc-b18c7f99fd84",
      displayName: "Example AntTodo",
      appUrl: "https://todo.example.com",
      supabaseUrl: "https://supabase.example.com",
      publishableKey: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
      deviceAuthorizationEndpoint: "https://supabase.example.com/functions/v1/cli-device-auth",
      cliAuthProtocol: 2,
    };
    expect(parseServiceManifest(manifest, manifest.appUrl)).toMatchObject({
      appUrl: manifest.appUrl,
      displayName: "Example AntTodo",
    });
    expect(() => parseServiceManifest({ ...manifest, appUrl: "https://other.example.com" }, manifest.appUrl)).toThrow();
    expect(() => parseServiceManifest({ ...manifest, cliAuthProtocol: undefined }, manifest.appUrl)).toThrow(/protocol v2/);
    expect(() => parseServiceManifest({ ...manifest, deviceAuthorizationEndpoint: "https://evil.example.com/functions/v1/cli-device-auth" }, manifest.appUrl)).toThrow();
  });

  it("uses the AntTodo production host without environment variables", async () => {
    delete process.env.ANTTODO_SUPABASE_URL;
    delete process.env.ANTTODO_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.ANTTODO_APP_URL;
    delete process.env.ANTTODO_DEVICE_AUTH_URL;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: 1,
      instanceId: "00000000-0000-4000-8000-000000000001",
      displayName: "AntTodo.com",
      appUrl: DEFAULT_APP_URL,
      supabaseUrl: "https://supabase.example.com",
      publishableKey: "sb_publishable_production_key",
      deviceAuthorizationEndpoint: "https://supabase.example.com/functions/v1/cli-device-auth",
      cliAuthProtocol: 2,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadPublicConfig()).resolves.toMatchObject({ appUrl: DEFAULT_APP_URL });
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_APP_URL}/.well-known/anttodo.json`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("uses a complete local override", async () => {
    process.env.ANTTODO_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.ANTTODO_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
    process.env.ANTTODO_APP_URL = "http://127.0.0.1:5173";
    await expect(loadPublicConfig()).resolves.toMatchObject({
      supabaseUrl: "http://127.0.0.1:54321",
      deviceAuthorizationEndpoint: "http://127.0.0.1:54321/functions/v1/cli-device-auth",
      cliAuthProtocol: 2,
    });
  });

  it("rejects a partial override instead of silently using production", async () => {
    process.env.ANTTODO_SUPABASE_URL = "http://127.0.0.1:54321";
    delete process.env.ANTTODO_SUPABASE_PUBLISHABLE_KEY;
    await expect(loadPublicConfig()).rejects.toMatchObject({ code: "incomplete_environment_config" });
  });
});
