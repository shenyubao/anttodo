import { describe, expect, it } from "vitest";
import { buildSentryTracePropagationTargets } from "./sentryTraceTargets";

describe("buildSentryTracePropagationTargets", () => {
  it("keeps same-origin targets and public app URL without Supabase", () => {
    const targets = buildSentryTracePropagationTargets({
      publicAppUrl: "https://app.anttodo.com",
    });

    expect(targets).toEqual(["localhost", /^\//, "https://app.anttodo.com"]);
    expect(
      targets.some(
        (target) =>
          typeof target === "string" && target.includes("supabase.co"),
      ),
    ).toBe(false);
  });

  it("ignores malformed public app URLs", () => {
    expect(
      buildSentryTracePropagationTargets({ publicAppUrl: "not a url" }),
    ).toEqual(["localhost", /^\//]);
  });
});
