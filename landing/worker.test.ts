import { describe, expect, it } from "vitest";
import { canonicalLandingRedirect } from "./worker";

describe("landing worker", () => {
  it("redirects www to the canonical HTTPS origin while preserving path and query", () => {
    expect(canonicalLandingRedirect(
      new Request("http://www.anttodo.com/releases/mac?from=nav"),
    )).toBe("https://anttodo.com/releases/mac?from=nav");
  });

  it("does not redirect the apex domain", () => {
    expect(canonicalLandingRedirect(new Request("https://anttodo.com/"))).toBeNull();
  });
});
