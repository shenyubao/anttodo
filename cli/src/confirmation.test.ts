import { describe, expect, it } from "vitest";
import { requireConfirmation } from "./confirmation.js";

describe("destructive confirmation", () => {
  it("allows an explicit --yes bypass", async () => {
    await expect(requireConfirmation("delete", {}, true)).resolves.toBeUndefined();
  });

  it("returns the documented confirmation envelope metadata outside a TTY", async () => {
    if (process.stdin.isTTY || process.stderr.isTTY) return;
    await expect(requireConfirmation("tag delete", { descendantCount: 2, affectedTaskCount: 3 }, false))
      .rejects.toMatchObject({
        type: "confirmation_required",
        code: "confirmation_required",
        exitCode: 10,
        details: {
          risk: "high-risk-write",
          preview: { descendantCount: 2, affectedTaskCount: 3 },
        },
      });
  });
});
