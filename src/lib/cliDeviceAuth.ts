import type { Session, SupabaseClient } from "@supabase/supabase-js";

export type CliAuthorizationRequest = {
  requestId: string;
  publicKey: JsonWebKey;
  client: {
    name?: string;
    version?: string;
    hostname?: string | null;
  };
  status: string;
  expiresAt: string;
};

const DEVICE_AUTH_INFO = "anttodo-cli-device-auth-v1";

function base64Url(value: Uint8Array) {
  let binary = "";
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function cliAuthorizationUserCode(pathname: string, search: string) {
  if (pathname !== "/auth/cli") return null;
  return new URLSearchParams(search).get("user_code")?.toUpperCase() ?? "";
}

export function cliAuthorizationAad(requestId: string, userId: string) {
  return `${DEVICE_AUTH_INFO}:${requestId}:${userId}`;
}

export async function encryptCliSession(
  publicKey: JsonWebKey,
  session: Session,
  requestId: string,
) {
  const recipientKey = await crypto.subtle.importKey(
    "jwk",
    publicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: recipientKey },
    ephemeral.privateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: new TextEncoder().encode(DEVICE_AUTH_INFO),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const plaintext = new TextEncoder().encode(JSON.stringify({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    userId: session.user.id,
  }));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(cliAuthorizationAad(requestId, session.user.id)),
    },
    encryptionKey,
    plaintext,
  );
  return {
    ephemeralPublicKey: await crypto.subtle.exportKey("jwk", ephemeral.publicKey),
    salt: base64Url(salt),
    iv: base64Url(iv),
    ciphertext: base64Url(new Uint8Array(ciphertext)),
  };
}

export async function inspectCliAuthorization(client: SupabaseClient, userCode: string) {
  const { data, error } = await client.functions.invoke("cli-device-auth", {
    body: { action: "inspect", userCode },
  });
  if (error) throw error;
  return data as CliAuthorizationRequest;
}

export async function decideCliAuthorization(
  client: SupabaseClient,
  input: {
    decision: "approve" | "deny";
    userCode: string;
    requestId: string;
    encryptedSession?: Awaited<ReturnType<typeof encryptCliSession>>;
  },
) {
  const { data, error } = await client.functions.invoke("cli-device-auth", {
    body: {
      action: input.decision,
      requestId: input.requestId,
      userCode: input.userCode,
      ...(input.encryptedSession ? { encryptedSession: input.encryptedSession } : {}),
    },
  });
  if (error) throw error;
  return data as { status: "approved" | "denied" };
}
