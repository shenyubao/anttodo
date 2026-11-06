import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { createQueryPersister } from "./persistence";
import { createDemoBundle } from "./demo";
import { createOptimisticTask } from "./taskCache";
import { submitTaskCreation } from "./taskCreation";
import { okrLinkedTaskCountsKey } from "./okrApi";
import type { Task, WeeklyReport, WeeklyReportGroup, WorkspaceBundle } from "../types";
import { clearDeletedWeeklyReportGroupCache, createDemoWeeklyReportGroups, normalizeWeeklyReportGroup, weeklyReportGroupsKey } from "./weeklyReportGroupsApi";
import { weeklyReportDetailKey, weeklyReportsKey } from "./weeklyReportsApi";
import { requestPermissionRefresh } from "./permissionRefresh";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("idb-keyval", () => ({
  get: async (key: string) => storage.get(key),
  set: async (key: string, value: string) => { storage.set(key, value); },
  del: async (key: string) => { storage.delete(key); },
}));
afterEach(() => { storage.clear(); vi.unstubAllGlobals(); });

it("rejects a stale disk snapshot after a restart before the asynchronous purge finished", async () => {
  const markers = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => markers.get(key) ?? null,
    setItem: (key: string, value: string) => markers.set(key, value),
    removeItem: (key: string) => markers.delete(key),
  } });
  const client = new QueryClient();
  client.setQueryData(["workspace-bundle", "team"], createDemoBundle());
  const persister = createQueryPersister("restart-test", client);
  await persister.persistClient({ timestamp: Date.now(), buster: "same", clientState: dehydrate(client) });
  const oldDisk = storage.get("ANTTODO_QUERY_CACHE:restart-test")!;
  requestPermissionRefresh(client, "team");
  expect(markers.has("ANTTODO_QUERY_CACHE:restart-test:pending-permissions")).toBe(true);
  // Simulate termination before the new IndexedDB transaction committed.
  storage.set("ANTTODO_QUERY_CACHE:restart-test", oldDisk);
  const restarted = new QueryClient();
  const snapshot = await createQueryPersister("restart-test", restarted).restoreClient();
  expect(snapshot?.clientState.queries).toEqual([]);
  expect(client.getQueryData(["workspace-bundle", "team"])).toBeDefined();
  client.clear(); restarted.clear();
});

it("removes unverified permission snapshots from IDB while retaining readable in-memory content", async () => {
  const client = new QueryClient();
  const key = ["workspace-bundle", "team"];
  client.setQueryData(key, { ...createDemoBundle(), private: "old permissions" });
  client.setQueryData(["workspace-bundle", "other-team"], { ...createDemoBundle(), title: "other" });
  client.setQueryData(["date-time-preferences", "user"], { weekStartsOn: 1 });
  const persister = createQueryPersister("access-test", client);
  await persister.persistClient({ timestamp: Date.now(), buster: "same", clientState: dehydrate(client) });
  requestPermissionRefresh(client, "team");
  const snapshot = await persister.restoreClient();
  expect(snapshot?.clientState.queries.map((query) => query.queryKey)).not.toContainEqual(key);
  expect(snapshot?.clientState.queries).toHaveLength(2);
  expect(client.getQueryData(key)).toEqual({ ...createDemoBundle(), private: "old permissions" });
  expect(snapshot?.buster).toBe("same");
  client.clear();
});

it("preserves legacy offline caches and preferences while removing unfinished task rows", async () => {
  const client = new QueryClient();
  const bundleKey = ["workspace-bundle", "workspace-team"];
  const confirmed = createOptimisticTask({ workspaceId: "workspace-team", userId: "demo-user", title: "已确认", labelIds: [], optimisticId: "confirmed" });
  const pending = createOptimisticTask({ workspaceId: "workspace-team", userId: "demo-user", title: "旧临时任务", labelIds: ["product"] });
  client.setQueryData(bundleKey, { ...createDemoBundle(), tasks: [confirmed, pending], labelTaskCounts: { product: 1 }, taskPlacements: [] });
  client.setQueryData(["date-time-preferences", "demo-user"], { weekStartsOn: 1 });
  const buster = "workspace-members-no-embed-v1";
  storage.set("ANTTODO_QUERY_CACHE:legacy", JSON.stringify({ timestamp: Date.now(), buster, clientState: dehydrate(client) }));
  const persisted = await createQueryPersister("legacy", client).restoreClient();
  const restored = new QueryClient();
  hydrate(restored, persisted!.clientState);
  expect(persisted?.buster).toBe(buster);
  expect(restored.getQueryData<WorkspaceBundle>(bundleKey)?.tasks.map((task) => task.id)).toEqual(["confirmed"]);
  expect(restored.getQueryData<WorkspaceBundle>(bundleKey)?.labelTaskCounts?.product).toBe(0);
  expect(restored.getQueryData(["date-time-preferences", "demo-user"])).toEqual({ weekStartsOn: 1 });
  client.clear();
  restored.clear();
});

it("round-trips confirmed data while excluding pending writes from offline startup", async () => {
  const client = new QueryClient();
  const restored = new QueryClient();
  const workspaceId = "workspace-team";
  const bundleKey = ["workspace-bundle", workspaceId];
  const countsKey = okrLinkedTaskCountsKey(workspaceId, "set", ["kr"]);
  const confirmed = createOptimisticTask({ workspaceId, userId: "demo-user", title: "已确认任务", labelIds: [], optimisticId: "confirmed" });
  client.setQueryData(bundleKey, { ...createDemoBundle(), tasks: [confirmed], labelTaskCounts: {}, taskPlacements: [] });
  client.setQueryData(countsKey, { kr: 0 });
  let resolve!: (task: Task) => void;
  const response = new Promise<Task>((done) => { resolve = done; });
  const create = vi.fn(() => response);
  const request = submitTaskCreation({ queryClient: client, workspaceId, userId: "demo-user",
    isOnline: () => true, create, link: vi.fn().mockResolvedValue(null) }, {
    title: "尚未确认", labelIds: [], okrTarget: { keyResultId: "kr", objectiveId: "objective", title: "KR", position: 0 },
  });
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  const persister = createQueryPersister("task-create-test", client);
  await persister.persistClient({ timestamp: Date.now(), buster: "test", clientState: dehydrate(client, {
    shouldDehydrateMutation: () => false,
  }) });
  const persisted = await persister.restoreClient();
  expect(persisted).toBeDefined();
  hydrate(restored, persisted!.clientState);
  expect(restored.getQueryData<WorkspaceBundle>(bundleKey)?.tasks.map((task) => task.id)).toEqual(["confirmed"]);
  expect(restored.getQueryData(countsKey)).toEqual({ kr: 0 });
  expect(restored.getMutationCache().getAll()).toEqual([]);
  expect(JSON.stringify(persisted)).not.toContain("optimistic-task:");
  // Persisting does not remove the visible, pending row from the running app.
  expect(client.getQueryData<WorkspaceBundle>(bundleKey)?.tasks).toHaveLength(2);
  resolve({ ...confirmed, id: "saved", title: "尚未确认" });
  await request;
  client.clear();
  restored.clear();
});

it("never restores deleted weekly groups or their report snapshots offline", async () => {
  const client = new QueryClient();
  const group = createDemoWeeklyReportGroups("team", ["user"])[0];
  const sibling = { ...group, id: "keep-group", is_default: false };
  const report = { id: "deleted-report", workspace_id: "team", weekly_report_group_id: group.id } as WeeklyReport;
  const feedKey = weeklyReportsKey("team", "2026-11-02", group.id);
  const detailKey = weeklyReportDetailKey("team", report.id);
  client.setQueryData(weeklyReportGroupsKey("team"), [group, sibling]);
  client.setQueryData(feedKey, [report]); client.setQueryData(detailKey, report);
  const persister = createQueryPersister("deleted-weekly-group", client);
  await persister.persistClient({ timestamp: Date.now(), buster: "same", clientState: dehydrate(client) });
  await clearDeletedWeeklyReportGroupCache(client, "team", group.id);
  await persister.persistClient({ timestamp: Date.now(), buster: "same", clientState: dehydrate(client) });
  const snapshot = await persister.restoreClient();
  const restored = new QueryClient(); hydrate(restored, snapshot!.clientState);
  expect(restored.getQueryData(weeklyReportGroupsKey("team"))).toEqual([sibling]);
  expect(restored.getQueryData(feedKey)).toBeUndefined();
  expect(restored.getQueryData(detailKey)).toBeUndefined();
  client.clear(); restored.clear();
});

it("restores creator attribution and safely reads legacy group snapshots", async () => {
  const client = new QueryClient();
  const key = weeklyReportGroupsKey("team");
  const created = { ...createDemoWeeklyReportGroups("team", ["writer"])[0], created_by: "creator" };
  const legacy = { ...created, id: "legacy" } as Partial<WeeklyReportGroup>;
  delete legacy.created_by;
  client.setQueryData(key, [created, legacy]);
  const persister = createQueryPersister("weekly-creators", client);
  await persister.persistClient({ timestamp: Date.now(), buster: "same", clientState: dehydrate(client) });
  const restored = new QueryClient();
  hydrate(restored, (await persister.restoreClient())!.clientState);
  const groups = restored.getQueryData<WeeklyReportGroup[]>(key)!.map(normalizeWeeklyReportGroup);
  expect(groups[0].created_by).toBe("creator");
  expect(groups[1].created_by).toBeNull();
  expect(groups[1].participant_ids).toEqual(["writer"]);
  client.clear(); restored.clear();
});
