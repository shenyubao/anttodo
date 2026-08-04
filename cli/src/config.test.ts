import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_URL, loadPublicConfig } from "./config.js";

vi.mock("./storage.js", () => ({
  cachePublicConfig: vi.fn(),
  readCachedPublicConfig: vi.fn().mockResolvedValue(null),
}));

const original = {
  url: process.env.ANTTODO_SUPABASE_URL,
  key: process.env.ANTTODO_SUPABASE_PUBLISHABLE_KEY,
  app: process.env.ANTTODO_APP_URL,
  device: process.env.ANTTODO_DEVICE_AUTH_URL,
};

afterEach(() => {
  vi.unstubAllGlobals();
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
  it("uses the AntTodo production host without environment variables", async () => {
    delete process.env.ANTTODO_SUPABASE_URL;
    delete process.env.ANTTODO_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.ANTTODO_APP_URL;
    delete process.env.ANTTODO_DEVICE_AUTH_URL;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      supabaseUrl: "https://example.supabase.co",
      publishableKey: "sb_publishable_production_key",
      appUrl: DEFAULT_APP_URL,
      deviceAuthorizationEndpoint: "https://example.supabase.co/functions/v1/cli-device-auth",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadPublicConfig()).resolves.toMatchObject({ appUrl: DEFAULT_APP_URL });
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_APP_URL}/.well-known/anttodo-cli.json`,
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
    });
  });

  it("rejects a partial override instead of silently using production", async () => {
    process.env.ANTTODO_SUPABASE_URL = "http://127.0.0.1:54321";
    delete process.env.ANTTODO_SUPABASE_PUBLISHABLE_KEY;
    await expect(loadPublicConfig()).rejects.toMatchObject({ code: "incomplete_environment_config" });
  });
});
