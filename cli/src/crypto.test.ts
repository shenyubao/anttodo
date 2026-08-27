import { describe, expect, it } from "vitest";
import { hashDeviceCode, newDeviceCode } from "./crypto.js";

describe("device credentials", () => {
  it("creates a 32-byte base64url secret and only derives a SHA-256 hash", () => {
    const secret = newDeviceCode();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(secret, "base64url")).toHaveLength(32);
    expect(hashDeviceCode(secret)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces distinct credentials", () => {
    expect(newDeviceCode()).not.toBe(newDeviceCode());
  });
});
