import {
  createCipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEVICE_AUTH_INFO,
  authorizationAad,
  base64Url,
  decryptSession,
  generateDeviceKeyPair,
} from "./crypto.js";

function encryptFor(publicJwk: JsonWebKey, requestId: string, userId: string) {
  const ephemeral = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: createPublicKey({ key: publicJwk, format: "jwk" }),
  });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = Buffer.from(hkdfSync("sha256", shared, salt, Buffer.from(DEVICE_AUTH_INFO), 32));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(authorizationAad(requestId, userId)));
  const body = Buffer.concat([
    cipher.update(JSON.stringify({ accessToken: "access", refreshToken: "refresh", userId })),
    cipher.final(),
  ]);
  return {
    ephemeralPublicKey: ephemeral.publicKey.export({ format: "jwk" }),
    salt: base64Url(salt),
    iv: base64Url(iv),
    ciphertext: base64Url(Buffer.concat([body, cipher.getAuthTag()])),
  };
}

describe("device authorization encryption", () => {
  it("decrypts a browser-compatible AES-GCM payload", () => {
    const recipient = generateDeviceKeyPair();
    const encrypted = encryptFor(recipient.publicKey, "request", "user");
    expect(decryptSession(recipient.privateKey, encrypted, "request", "user")).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      userId: "user",
    });
  });

  it("rejects AAD and ciphertext tampering", () => {
    const recipient = generateDeviceKeyPair();
    const encrypted = encryptFor(recipient.publicKey, "request", "user");
    expect(() => decryptSession(recipient.privateKey, encrypted, "other", "user")).toThrow();
    const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -1)}A` };
    expect(() => decryptSession(recipient.privateKey, tampered, "request", "user")).toThrow();
  });
});
