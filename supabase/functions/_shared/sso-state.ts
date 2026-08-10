const encoder = new TextEncoder();

export type SsoClient = "web" | "desktop" | "mobile";

export type SsoStateClaims = {
  workspaceId: string;
  client: SsoClient;
};

export function isSsoClient(value: unknown): value is SsoClient {
  return value === "web" || value === "desktop" || value === "mobile";
}

export function usesSsoAuthHandoff(client: SsoClient) {
  return client === "desktop" || client === "mobile";
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hmacSign(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

export async function createSsoState(
  workspaceId: string,
  secret: string,
  client: SsoClient = "web",
) {
  if (!secret) throw new Error("SSO_STATE_SECRET is not configured");
  const issuedAt = Date.now().toString(36);
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const payload = `${workspaceId}.${client}.${issuedAt}.${nonce}`;
  const signature = await hmacSign(secret, payload);
  return `${payload}.${signature}`;
}

export async function verifySsoStateClaims(
  state: string,
  workspaceId: string,
  secret: string,
  maxAgeMs = 10 * 60 * 1000,
) {
  if (!secret) return null;
  const parts = state.split(".");
  if (parts.length !== 4 && parts.length !== 5) return null;
  const legacy = parts.length === 4;
  const [stateWorkspaceId, clientRaw, issuedAtRaw, nonce, signature] = legacy
    ? [parts[0], "web", parts[1], parts[2], parts[3]]
    : parts;
  if (!stateWorkspaceId || !clientRaw || !issuedAtRaw || !nonce || !signature) {
    return null;
  }
  if (stateWorkspaceId !== workspaceId) return null;
  if (!isSsoClient(clientRaw)) return null;
  const issuedAt = Number.parseInt(issuedAtRaw, 36);
  const ageMs = Date.now() - issuedAt;
  if (!Number.isFinite(issuedAt) || ageMs > maxAgeMs || ageMs < -60_000) return null;
  const payload = legacy
    ? `${stateWorkspaceId}.${issuedAtRaw}.${nonce}`
    : `${stateWorkspaceId}.${clientRaw}.${issuedAtRaw}.${nonce}`;
  const expected = await hmacSign(secret, payload);
  if (expected.length !== signature.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (mismatch !== 0) return null;
  return { workspaceId: stateWorkspaceId, client: clientRaw } satisfies SsoStateClaims;
}

export async function verifySsoState(
  state: string,
  workspaceId: string,
  secret: string,
  maxAgeMs = 10 * 60 * 1000,
) {
  return Boolean(await verifySsoStateClaims(state, workspaceId, secret, maxAgeMs));
}
