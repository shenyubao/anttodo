import { describe, expect, it } from "vitest";
import { isTrayHash } from "./traySurface";

describe("isTrayHash", () => {
  it("detects tray surface hashes", () => {
    expect(isTrayHash("#/tray")).toBe(true);
    expect(isTrayHash("#tray")).toBe(true);
    expect(isTrayHash("#/tray?x=1")).toBe(true);
  });

  it("rejects other hashes", () => {
    expect(isTrayHash("#/workspaces/1/views/inbox")).toBe(false);
    expect(isTrayHash("")).toBe(false);
    expect(isTrayHash("#/")).toBe(false);
  });
});
