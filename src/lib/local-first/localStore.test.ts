import { describe, expect, it } from "vitest";
import { offlineCacheBannerText } from "./localStore";

describe("offlineCacheBannerText", () => {
  it("describes a previous query cache on web", () => {
    expect(offlineCacheBannerText(false)).toBe("当前显示上次缓存，恢复网络后会自动刷新");
  });

  it("describes the local-first store on desktop and native", () => {
    expect(offlineCacheBannerText(true)).toBe("当前显示离线缓存，恢复网络后会自动刷新");
  });
});
