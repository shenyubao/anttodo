import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSsoState,
  verifySsoState,
  verifySsoStateClaims,
} from "../../supabase/functions/_shared/sso-state";

const workspaceId = "21000000-0000-0000-0000-000000000001";
const secret = "test-state-secret";

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function legacyState(issuedAt: number) {
  const issuedAtRaw = issuedAt.toString(36);
  const payload = `${workspaceId}.${issuedAtRaw}.legacynonce`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

describe("DingTalk SSO state", () => {
  afterEach(() => vi.useRealTimers());

  it("signs the desktop client into new states", async () => {
    const state = await createSsoState(workspaceId, secret, "desktop");
    await expect(verifySsoStateClaims(state, workspaceId, secret)).resolves.toEqual({
      workspaceId,
      client: "desktop",
    });
  });

  it("signs the mobile client into new states", async () => {
    const state = await createSsoState(workspaceId, secret, "mobile");
    await expect(verifySsoStateClaims(state, workspaceId, secret)).resolves.toEqual({
      workspaceId,
      client: "mobile",
    });
  });

  it("accepts legacy states as web logins", async () => {
    const state = await legacyState(Date.now());
    await expect(verifySsoStateClaims(state, workspaceId, secret)).resolves.toEqual({
      workspaceId,
      client: "web",
    });
  });

  it("rejects tampered, expired, and far-future states", async () => {
    const now = Date.now();
    const state = await createSsoState(workspaceId, secret, "desktop");
    await expect(
      verifySsoState(`${state.slice(0, -1)}x`, workspaceId, secret),
    ).resolves.toBe(false);

    vi.useFakeTimers();
    vi.setSystemTime(now + 11 * 60 * 1_000);
    await expect(verifySsoState(state, workspaceId, secret)).resolves.toBe(false);

    vi.setSystemTime(now - 12 * 60 * 1_000);
    await expect(verifySsoState(state, workspaceId, secret)).resolves.toBe(false);
  });
});
