import { describe, expect, it } from "vitest";
import {
  FALLBACK_MAC_DOWNLOADS,
  fallbackMacDownloads,
  parseMacDownloads,
} from "./downloadManifest";

describe("parseMacDownloads", () => {
  it("reads the current version and stable DMG URLs", () => {
    expect(parseMacDownloads({
      version: "0.1.0",
      downloads: {
        macos: {
          arm64: { dmg: { url: FALLBACK_MAC_DOWNLOADS.arm64 } },
          x64: { dmg: { url: FALLBACK_MAC_DOWNLOADS.x64 } },
        },
      },
    })).toEqual({ version: "0.1.0", ...FALLBACK_MAC_DOWNLOADS });
  });

  it("rejects incomplete or untrusted download URLs", () => {
    expect(parseMacDownloads({})).toBeNull();
    expect(parseMacDownloads({
      downloads: {
        macos: {
          arm64: { dmg: { url: "https://example.com/not-anttodo.dmg" } },
          x64: { dmg: { url: FALLBACK_MAC_DOWNLOADS.x64 } },
        },
      },
    })).toBeNull();
  });

  it("provides stable links without claiming a version on failure", () => {
    expect(fallbackMacDownloads()).toEqual({ version: null, ...FALLBACK_MAC_DOWNLOADS });
  });
});
