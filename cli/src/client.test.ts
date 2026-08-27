import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceConfig } from "./types.js";

const temporaryDirectories: string[] = [];
const config: ServiceConfig = {
  schemaVersion: 1,
  instanceId: "00000000-0000-4000-8000-000000000001",
  displayName: "Test",
  appUrl: "https://app.example.com",
  supabaseUrl: "https://supabase.example.com",
  publishableKey: "sb_publishable_test_key_long_enough",
  deviceAuthorizationEndpoint: "https://supabase.example.com/functions/v1/cli-device-auth",
  cliAuthProtocol: 2,
  serviceKey: "test",
  official: false,
  source: "network",
};

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.ANTTODO_STATE_DIR;
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setupCredential() {
  const directory = await mkdtemp(join(tmpdir(), "anttodo-cli-client-"));
  temporaryDirectories.push(directory);
  process.env.ANTTODO_STATE_DIR = directory;
  const storage = await import("./storage.js");
  await storage.saveCliCredential({
    schemaVersion: 2, deviceId: "85000000-0000-4000-8000-000000000001",
    secret: "s".repeat(43), user: { id: "user", email: null, phone: null }, credentialExpiresAt: null,
  }, config.serviceKey);
}

describe("CLI access token provider", () => {
  it("exchanges once and reuses the cached short-lived JWT", async () => {
    await setupCredential();
    let exchanges = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === config.deviceAuthorizationEndpoint) {
        exchanges += 1;
        return Response.json({ accessToken: `token-${exchanges}`, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), credentialExpiresAt: null });
      }
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }));
    const { createClientContext } = await import("./client.js");
    const { client } = await createClientContext({ config });
    await client.from("workspaces").select("id");
    await client.from("workspaces").select("id");
    expect(exchanges).toBe(1);
  });

  it("forces one new exchange and retries a Data API 401", async () => {
    await setupCredential();
    let exchanges = 0;
    let dataCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === config.deviceAuthorizationEndpoint) {
        exchanges += 1;
        return Response.json({ accessToken: `token-${exchanges}`, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), credentialExpiresAt: null });
      }
      dataCalls += 1;
      return dataCalls === 1
        ? Response.json({ message: "expired" }, { status: 401 })
        : new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { createClientContext } = await import("./client.js");
    const { client } = await createClientContext({ config });
    const result = await client.from("workspaces").select("id");
    expect(result.error).toBeNull();
    expect(exchanges).toBe(2);
    expect(dataCalls).toBe(2);
  });
});
