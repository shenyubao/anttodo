import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapInstanceConfig,
  currentAuthBrandTitle,
  fetchInstanceConfig,
  isOnPremisesInstance,
  loginWelcomeTitle,
  normalizeServiceOrigin,
  parseInstanceManifest,
  rememberedInstanceConfigs,
  selectCustomService,
  setActiveInstanceConfig,
} from "./instanceConfig";

const manifest = {
  schemaVersion: 1,
  instanceId: "8e78719f-8d1f-4d0d-90fc-b18c7f99fd84",
  displayName: "宇策科技 AntTodo",
  deployMode: "onPremises" as const,
  workspaceSlug: "yucekj",
  appUrl: "https://todo.yuce-tech.cn",
  supabaseUrl: "https://supabase.yuce-tech.cn",
  publishableKey: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
  deviceAuthorizationEndpoint: "https://supabase.yuce-tech.cn/functions/v1/cli-device-auth",
};

describe("instance configuration", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() {
          return values.size;
        },
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, String(value)),
      } satisfies Storage,
    });
  });

  afterEach(() => {
    setActiveInstanceConfig(null);
    Object.defineProperty(window, "anttodoDesktop", {
      configurable: true,
      value: undefined,
    });
    vi.unstubAllGlobals();
  });

  it("normalizes a service root and adds https", () => {
    expect(normalizeServiceOrigin("todo.yuce-tech.cn", false)).toBe("https://todo.yuce-tech.cn");
    expect(normalizeServiceOrigin("https://todo.yuce-tech.cn/", false)).toBe("https://todo.yuce-tech.cn");
  });

  it("rejects credentials, paths, query strings, and production http", () => {
    expect(() => normalizeServiceOrigin("https://a:b@todo.yuce-tech.cn", false)).toThrow();
    expect(() => normalizeServiceOrigin("https://todo.yuce-tech.cn/path", false)).toThrow();
    expect(() => normalizeServiceOrigin("https://todo.yuce-tech.cn/?a=1", false)).toThrow();
    expect(() => normalizeServiceOrigin("http://todo.yuce-tech.cn", false)).toThrow(/HTTPS/);
  });

  it("allows localhost http only when explicitly enabled", () => {
    expect(normalizeServiceOrigin("http://localhost:5000", true)).toBe("http://localhost:5000");
    expect(() => normalizeServiceOrigin("http://localhost:5000", false)).toThrow(/HTTPS/);
  });

  it("validates the manifest and matching app origin", () => {
    expect(parseInstanceManifest(manifest, manifest.appUrl, false)).toEqual(manifest);
    expect(parseInstanceManifest({ ...manifest, enterpriseSlug: "yucekj", workspaceSlug: undefined }, manifest.appUrl, false))
      .toMatchObject({ workspaceSlug: "yucekj", deployMode: "onPremises" });
    expect(parseInstanceManifest({ ...manifest, deployMode: undefined }, manifest.appUrl, false))
      .toMatchObject({ deployMode: "onPremises", workspaceSlug: "yucekj" });
    expect(parseInstanceManifest({ ...manifest, deployMode: undefined, workspaceSlug: undefined }, manifest.appUrl, false))
      .toMatchObject({ deployMode: "saas" });
    expect(isOnPremisesInstance(manifest)).toBe(true);
    expect(currentAuthBrandTitle("预策科技")).toBe("蚂蚁待办 x 预策科技");
    expect(currentAuthBrandTitle()).toBe("蚂蚁待办");
    expect(loginWelcomeTitle("official")).toBe("蚂蚁待办");
    expect(loginWelcomeTitle("custom")).toBe("蚂蚁待办");
    expect(parseInstanceManifest({ ...manifest, custom_brand_name: "预策科技" }, manifest.appUrl, false))
      .toEqual(manifest);
    expect(() => parseInstanceManifest({ ...manifest, deployMode: "onPremises", workspaceSlug: undefined }, manifest.appUrl, false))
      .toThrow(/企业 Slug/);
    expect(() => parseInstanceManifest({ ...manifest, deployMode: "cloud" }, manifest.appUrl, false)).toThrow(/部署模式/);
    expect(() => parseInstanceManifest(manifest, "https://other.example.com", false)).toThrow(/appUrl/);
    expect(() => parseInstanceManifest({ ...manifest, schemaVersion: 2 }, manifest.appUrl, false)).toThrow(/版本/);
    expect(() => parseInstanceManifest({
      ...manifest,
      deviceAuthorizationEndpoint: "https://evil.example.com/functions/v1/cli-device-auth",
    }, manifest.appUrl, false)).toThrow(/Supabase/);
    expect(() => parseInstanceManifest({
      ...manifest,
      supabaseUrl: "https://supabase.yuce-tech.cn/rest/v1",
    }, manifest.appUrl, false)).toThrow(/根地址/);
    expect(() => parseInstanceManifest({
      ...manifest,
      displayName: " ",
    }, manifest.appUrl, false)).toThrow(/名称/);
    expect(() => parseInstanceManifest({
      ...manifest,
      workspaceSlug: "非法 Slug",
    }, manifest.appUrl, false)).toThrow(/Slug/);
  });

  it("uses a stable namespace and rejects redirects while discovering a service", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify(manifest),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchInstanceConfig(manifest.appUrl);
    const second = await fetchInstanceConfig(manifest.appUrl);
    expect(first.namespace).toMatch(/^[0-9a-f]{32}$/);
    expect(second.namespace).toBe(first.namespace);
    expect(fetchMock).toHaveBeenCalledWith(
      `${manifest.appUrl}/.well-known/anttodo.json`,
      expect.objectContaining({ redirect: "error", cache: "no-store" }),
    );
  });

  it("falls back to the last verified manifest for desktop offline startup", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "anttodoDesktop", {
      configurable: true,
      value: {},
    });

    const verified = await selectCustomService(manifest.appUrl);
    expect(rememberedInstanceConfigs()).toEqual([
      expect.objectContaining({
        appUrl: manifest.appUrl,
        displayName: manifest.displayName,
        deployMode: "onPremises",
        workspaceSlug: manifest.workspaceSlug,
      }),
    ]);
    const cached = await bootstrapInstanceConfig();
    expect(cached).toMatchObject({
      appUrl: manifest.appUrl,
      instanceId: manifest.instanceId,
      displayName: "宇策科技 AntTodo",
      namespace: verified.namespace,
      source: "cache",
    });
  });

  it("keeps the default login title for official and custom picker choices", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const custom = await selectCustomService(manifest.appUrl);
    setActiveInstanceConfig(custom);
    expect(currentAuthBrandTitle()).toBe("蚂蚁待办 x 宇策科技 AntTodo");
    expect(loginWelcomeTitle(custom.appUrl)).toBe("蚂蚁待办 x 宇策科技 AntTodo");
    expect(loginWelcomeTitle("official")).toBe("蚂蚁待办");
    expect(loginWelcomeTitle("custom")).toBe("蚂蚁待办");
    setActiveInstanceConfig(null);
  });
});
