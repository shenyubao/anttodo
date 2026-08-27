import { createHash, randomBytes } from "node:crypto";

export function base64Url(buffer: Uint8Array) {
  return Buffer.from(buffer).toString("base64url");
}

export function newDeviceCode() {
  return base64Url(randomBytes(32));
}

export function hashDeviceCode(deviceCode: string) {
  return createHash("sha256").update(deviceCode).digest("hex");
}
