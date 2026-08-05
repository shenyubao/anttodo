import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLatestMacYml, sha512Base64 } from "./mac-update-feed.mjs";

describe("mac update feed", () => {
  it("builds latest-mac.yml with arm64 as the primary path", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anttodo-mac-feed-"));
    const arm64 = path.join(dir, "AntTodo-1.2.3-arm64.zip");
    const x64 = path.join(dir, "AntTodo-1.2.3-x64.zip");
    writeFileSync(arm64, "arm64-bytes");
    writeFileSync(x64, "x64-bytes-longer");

    const yml = buildLatestMacYml(
      [
        { fileName: "AntTodo-1.2.3-x64.zip", file: x64, size: 15 },
        { fileName: "AntTodo-1.2.3-arm64.zip", file: arm64, size: 11 },
      ],
      "1.2.3",
      { now: () => new Date("2026-08-05T00:00:00.000Z") },
    );

    expect(yml).toContain("version: 1.2.3");
    expect(yml).toContain("url: AntTodo-1.2.3-arm64.zip");
    expect(yml).toContain("url: AntTodo-1.2.3-x64.zip");
    expect(yml).toContain(`sha512: ${sha512Base64(arm64)}`);
    expect(yml).toContain("path: AntTodo-1.2.3-arm64.zip");
    expect(yml).toContain("releaseDate: '2026-08-05T00:00:00.000Z'");
  });

  it("rejects empty zip lists", () => {
    expect(() => buildLatestMacYml([], "1.0.0")).toThrow(/requires at least one ZIP/);
  });
});
