import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCliVersion } from "./version.js";

describe("getCliVersion", () => {
  it("reads the version from the CLI package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(getCliVersion()).toBe(pkg.version);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
