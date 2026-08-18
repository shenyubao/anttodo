import { describe, expect, it, vi } from "vitest";
import { loadLocalFirstSnapshot, offlineCacheBannerText } from "./localStore";

describe("offlineCacheBannerText", () => {
  it("describes a previous query cache on web", () => {
    expect(offlineCacheBannerText(false)).toBe("当前显示上次缓存，恢复网络后会自动刷新");
  });

  it("describes the local-first store on desktop and native", () => {
    expect(offlineCacheBannerText(true)).toBe("当前显示离线缓存，恢复网络后会自动刷新");
  });
});

describe("loadLocalFirstSnapshot", () => {
  it("hydrates the first desktop read from the local task bundle", async () => {
    const readRemote = vi.fn(async () => ({ tasks: ["remote"] }));
    const value = await loadLocalFirstSnapshot({
      localEnabled: true,
      online: true,
      preferLocal: true,
      readLocal: async () => ({ tasks: ["local"] }),
      readRemote,
      writeLocal: vi.fn(),
    });

    expect(value).toEqual({ tasks: ["local"] });
    expect(readRemote).not.toHaveBeenCalled();
  });

  it("reads remote data on an online refetch and refreshes the local snapshot", async () => {
    const writeLocal = vi.fn(async () => undefined);
    const value = await loadLocalFirstSnapshot({
      localEnabled: true,
      online: true,
      preferLocal: false,
      readLocal: async () => ({ tasks: ["local"] }),
      readRemote: async () => ({ tasks: ["remote"] }),
      writeLocal,
    });

    expect(value).toEqual({ tasks: ["remote"] });
    expect(writeLocal).toHaveBeenCalledWith({ tasks: ["remote"] });
  });

  it("keeps local tasks authoritative while outbox writes are pending", async () => {
    const readRemote = vi.fn(async () => ({ tasks: ["remote"] }));
    const value = await loadLocalFirstSnapshot({
      localEnabled: true,
      online: true,
      preferLocal: false,
      pendingLocalWrites: true,
      readLocal: async () => ({ tasks: ["pending-local-task"] }),
      readRemote,
      writeLocal: vi.fn(),
    });

    expect(value).toEqual({ tasks: ["pending-local-task"] });
    expect(readRemote).not.toHaveBeenCalled();
  });

  it("uses local data offline and as a fallback for a failed online refetch", async () => {
    const local = { tasks: ["local"] };
    await expect(loadLocalFirstSnapshot({
      localEnabled: true,
      online: false,
      preferLocal: false,
      readLocal: async () => local,
      readRemote: vi.fn(),
      writeLocal: vi.fn(),
    })).resolves.toEqual(local);

    await expect(loadLocalFirstSnapshot({
      localEnabled: true,
      online: true,
      preferLocal: false,
      readLocal: async () => local,
      readRemote: async () => { throw new Error("network"); },
      writeLocal: vi.fn(),
    })).resolves.toEqual(local);
  });
});
