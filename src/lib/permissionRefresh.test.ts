import { QueryClient, QueryObserver, CancelledError } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertPermissionReady, beginUserGroupSave, canPersistPermissionQuery, permissionRefreshStatus,
  readAfterUserGroupSaves, requestPermissionRefresh, retryPermissionRefresh,
} from "./permissionRefresh";

let client: QueryClient;
let unsubscribes: Array<() => void>;
beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  unsubscribes = [];
});
afterEach(() => { unsubscribes.forEach((stop) => stop()); client.clear(); vi.useRealTimers(); });
function watch(key: readonly unknown[], read: () => Promise<unknown>, meta?: Record<string, unknown>) {
  client.setQueryData(key, "confirmed");
  const observer = new QueryObserver(client, { queryKey: key, queryFn: read, meta });
  unsubscribes.push(observer.subscribe(() => undefined));
}
const flush = () => vi.advanceTimersByTimeAsync(160);

describe("permission verification", () => {
  it("coalesces a batch, preserves visible data and blocks writes until confirmed", async () => {
    let resolve!: (value: string) => void;
    const read = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const key = ["workspace-bundle", "team"];
    watch(key, read);
    for (let n = 0; n < 100; n++) requestPermissionRefresh(client, "team");
    expect(permissionRefreshStatus(client, "team")).toBe("pending");
    expect(client.getQueryData(key)).toBe("confirmed");
    expect(canPersistPermissionQuery(client, key)).toBe(false);
    expect(() => assertPermissionReady(client, "team")).toThrow("权限");
    await flush();
    expect(read).toHaveBeenCalledOnce();
    resolve("verified");
    await flush();
    expect(permissionRefreshStatus(client, "team")).toBe("ready");
    expect(client.getQueryData(key)).toBe("verified");
    expect(canPersistPermissionQuery(client, key)).toBe(true);
  });

  it("runs one trailing verification when another change arrives during a read", async () => {
    let resolve!: (value: string) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; })).mockResolvedValue("latest");
    watch(["workspace-bundle", "team"], read);
    requestPermissionRefresh(client, "team");
    await flush();
    requestPermissionRefresh(client, "team");
    await flush();
    expect(read).toHaveBeenCalledOnce();
    resolve("older");
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(permissionRefreshStatus(client, "team")).toBe("ready");
    expect(client.getQueryData(["workspace-bundle", "team"])).toBe("latest");
  });

  it("a cancelled verification is retried and cannot unlock writes", async () => {
    const read = vi.fn().mockRejectedValueOnce(new CancelledError()).mockResolvedValue("verified");
    watch(["okr-set", "team", "cycle", "owner"], read);
    requestPermissionRefresh(client, "team", "okr");
    await flush();
    expect(permissionRefreshStatus(client, "team")).toBe("pending");
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(permissionRefreshStatus(client, "team")).toBe("ready");
  });

  it("does not treat cancelQueries reverting to old data as successful verification", async () => {
    let resolve!: (value: string) => void;
    const key = ["workspace-bundle", "team"];
    const read = vi.fn().mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; })).mockResolvedValue("verified");
    watch(key, read);
    requestPermissionRefresh(client, "team");
    await flush();
    const cancelling = client.cancelQueries({ queryKey: key });
    client.setQueryData(key, "optimistic local change");
    await cancelling;
    expect(permissionRefreshStatus(client, "team")).toBe("pending");
    expect(client.getQueryData(key)).toBe("optimistic local change");
    resolve("cancelled stale result");
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(key)).toBe("verified");
    expect(permissionRefreshStatus(client, "team")).toBe("ready");
  });

  it("keeps failed reads readonly, retries reads only, and accepts an empty revoked result", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue([]);
    const key = ["weekly-reports", "team", "group"];
    watch(key, read);
    requestPermissionRefresh(client, "team", "weekly");
    await flush();
    expect(permissionRefreshStatus(client, "team")).toBe("error");
    expect(client.getQueryData(key)).toBe("confirmed");
    expect(canPersistPermissionQuery(client, key)).toBe(false);
    retryPermissionRefresh(client, "team");
    await flush();
    expect(client.getQueryData(key)).toEqual([]);
    expect(permissionRefreshStatus(client, "team")).toBe("ready");
  });

  it("does not accept a pre-commit request as permission verification", async () => {
    let resolve!: (value: string) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; })).mockResolvedValue("after commit");
    const key = ["workspace-bundle", "team"];
    watch(key, read);
    const original = client.refetchQueries({ queryKey: key });
    requestPermissionRefresh(client, "team");
    await flush();
    expect(read).toHaveBeenCalledOnce();
    resolve("before commit");
    await original;
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(key)).toBe("after commit");
  });

  it("clears inactive detail caches without touching another workspace or preferences", async () => {
    const key = ["okr-progress-records", "objective", "id"];
    client.setQueryDefaults(key, { meta: { workspaceId: "team" } });
    client.setQueryData(key, ["private"]);
    client.setQueryData(["okr-versions", "legacy-set"], ["legacy private"]);
    client.setQueryData(["workspace-bundle", "another"], "another");
    client.setQueryData(["date-time-preferences", "user"], "preferences");
    requestPermissionRefresh(client, "team");
    expect(canPersistPermissionQuery(client, key, { workspaceId: "team" })).toBe(false);
    await flush();
    expect(client.getQueryData(key)).toBeUndefined();
    expect(client.getQueryData(["okr-versions", "legacy-set"])).toBeUndefined();
    expect(client.getQueryData(["workspace-bundle", "another"])).toBe("another");
    expect(client.getQueryData(["date-time-preferences", "user"])).toBe("preferences");
  });

  it("waits for user-group saves and discards reads overlapping a save", async () => {
    const finish = beginUserGroupSave(client, "team");
    const read = vi.fn().mockResolvedValue("new");
    const reading = readAfterUserGroupSaves(client, "team", read);
    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    finish();
    await expect(reading).resolves.toBe("new");
    let resolve!: (value: string) => void;
    read.mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; }));
    const overlapping = readAfterUserGroupSaves(client, "team", read);
    const finishNext = beginUserGroupSave(client, "team");
    finishNext();
    resolve("old");
    await expect(overlapping).resolves.toBe("new");
    expect(read).toHaveBeenCalledTimes(3);
  });
});
