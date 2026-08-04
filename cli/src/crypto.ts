import {
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import type { CliSessionPayload, DeviceCiphertext } from "./types.js";

export const DEVICE_AUTH_INFO = "anttodo-cli-device-auth-v1";

export function base64Url(buffer: Uint8Array) {
  return Buffer.from(buffer).toString("base64url");
}

export function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

export function newDeviceCode() {
  return base64Url(randomBytes(32));
}

export function hashDeviceCode(deviceCode: string) {
  return createHash("sha256").update(deviceCode).digest("hex");
}

export function generateDeviceKeyPair() {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKey: pair.privateKey.export({ format: "jwk" }),
    publicKey: pair.publicKey.export({ format: "jwk" }),
  };
}

export function authorizationAad(requestId: string, userId: string) {
  return `${DEVICE_AUTH_INFO}:${requestId}:${userId}`;
}

export function decryptSession(
  privateJwk: JsonWebKey,
  encrypted: DeviceCiphertext,
  requestId: string,
  userId: string,
): CliSessionPayload {
  const privateKey = createPrivateKey({ key: privateJwk, format: "jwk" });
  const publicKey = createPublicKey({ key: encrypted.ephemeralPublicKey, format: "jwk" });
  const shared = diffieHellman({ privateKey, publicKey });
  const key = Buffer.from(hkdfSync(
    "sha256",
    shared,
    fromBase64Url(encrypted.salt),
    Buffer.from(DEVICE_AUTH_INFO),
    32,
  ));
  const payload = fromBase64Url(encrypted.ciphertext);
  const tag = payload.subarray(payload.length - 16);
  const body = payload.subarray(0, payload.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, fromBase64Url(encrypted.iv));
  decipher.setAAD(Buffer.from(authorizationAad(requestId, userId)));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as CliSessionPayload;
}
