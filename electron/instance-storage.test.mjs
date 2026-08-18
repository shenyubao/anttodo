import path from "node:path";
import { describe, expect, it } from "vitest";
import { instanceUserDataPath, isValidInstanceNamespace } from "./instance-storage.mjs";

const userId = "123e4567-e89b-42d3-a456-426614174000";
const namespace = "a".repeat(32);

describe("desktop instance storage", () => {
  it("keeps the official legacy user directory", () => {
    expect(instanceUserDataPath("/data", "official", userId)).toBe(path.join("/data", "users", userId));
  });

  it("isolates custom instances before the user directory", () => {
    expect(instanceUserDataPath("/data", namespace, userId)).toBe(
      path.join("/data", "instances", namespace, "users", userId),
    );
  });

  it("rejects path traversal and malformed namespaces", () => {
    expect(isValidInstanceNamespace("../official")).toBe(false);
    expect(() => instanceUserDataPath("/data", "../official", userId)).toThrow();
  });
});
