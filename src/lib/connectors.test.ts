import { describe, expect, it } from "vitest";
import { hasBidirectionalConflict } from "./connectors";

describe("hasBidirectionalConflict", () => {
  it("detects when both copies changed after the last sync", () => {
    expect(
      hasBidirectionalConflict(
        "2026-07-25T10:00:00.000Z",
        "2026-07-25T10:05:00.000Z",
        "2026-07-25T10:06:00.000Z",
      ),
    ).toBe(true);
  });

  it("allows a one-sided change to sync normally", () => {
    expect(
      hasBidirectionalConflict(
        "2026-07-25T10:00:00.000Z",
        "2026-07-25T09:59:00.000Z",
        "2026-07-25T10:06:00.000Z",
      ),
    ).toBe(false);
  });
});
