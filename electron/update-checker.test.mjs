import { describe, expect, it } from "vitest";
import {
  checkForDesktopUpdate,
  compareVersions,
  isAllowedDownloadUrl,
  parseUpdateManifest,
  parseVersionParts,
  resolveMacArch,
  safeDownloadUrl,
} from "./update-checker.mjs";

const arm64Url = "https://download.anttodo.com/macos/AntTodo-arm64-latest.dmg";
const x64Url = "https://download.anttodo.com/macos/AntTodo-x64-latest.dmg";

function sampleManifest(version = "1.2.3") {
  return {
    schemaVersion: 1,
    product: "蚂蚁待办",
    version,
    publishedAt: "2026-08-02T00:00:00.000Z",
    downloads: {
      macos: {
        arm64: {
          dmg: { url: arm64Url, fileName: "AntTodo-1.2.3-arm64.dmg" },
        },
        x64: {
          dmg: { url: x64Url, fileName: "AntTodo-1.2.3-x64.dmg" },
        },
      },
    },
  };
}

describe("desktop update checker", () => {
  it("allows only https download.anttodo.com urls", () => {
    expect(safeDownloadUrl(arm64Url)).toBe(arm64Url);
    expect(isAllowedDownloadUrl(arm64Url)).toBe(true);
    expect(isAllowedDownloadUrl("http://download.anttodo.com/macos/x.dmg")).toBe(false);
    expect(isAllowedDownloadUrl("https://evil.example/macos/x.dmg")).toBe(false);
    expect(isAllowedDownloadUrl("not-a-url")).toBe(false);
  });

  it("parses and compares semver cores", () => {
    expect(parseVersionParts("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersionParts("1.2.3-beta.1")).toEqual([1, 2, 3]);
    expect(parseVersionParts("1.2")).toBeNull();
    expect(compareVersions("1.2.3", "1.2.4")).toBeLessThan(0);
    expect(compareVersions("1.3.0", "1.2.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3-rc.1")).toBe(0);
  });

  it("resolves mac arch and picks the matching dmg", () => {
    expect(resolveMacArch("arm64")).toBe("arm64");
    expect(resolveMacArch("x64")).toBe("x64");
    expect(resolveMacArch("ia32")).toBe("x64");
    expect(parseUpdateManifest(sampleManifest(), "arm64")).toEqual({
      version: "1.2.3",
      downloadUrl: arm64Url,
    });
    expect(parseUpdateManifest(sampleManifest(), "x64")).toEqual({
      version: "1.2.3",
      downloadUrl: x64Url,
    });
    expect(parseUpdateManifest({ version: "1.0.0" }, "arm64")).toBeNull();
  });

  it("reports available, up-to-date, and error results", async () => {
    const available = await checkForDesktopUpdate({
      currentVersion: "1.0.0",
      arch: "arm64",
      fetchImpl: async () => ({
        ok: true,
        json: async () => sampleManifest("1.2.3"),
      }),
    });
    expect(available).toEqual({
      status: "available",
      currentVersion: "1.0.0",
      latestVersion: "1.2.3",
      downloadUrl: arm64Url,
    });

    const current = await checkForDesktopUpdate({
      currentVersion: "1.2.3",
      arch: "x64",
      fetchImpl: async () => ({
        ok: true,
        json: async () => sampleManifest("1.2.3"),
      }),
    });
    expect(current).toEqual({
      status: "up-to-date",
      currentVersion: "1.2.3",
      latestVersion: "1.2.3",
    });

    const failed = await checkForDesktopUpdate({
      currentVersion: "1.0.0",
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    expect(failed.status).toBe("error");
  });
});
