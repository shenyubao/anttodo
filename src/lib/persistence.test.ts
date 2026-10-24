import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { createQueryPersister } from "./persistence";
import { createDemoBundle } from "./demo";
import { createOptimisticTask } from "./taskCache";
import { submitTaskCreation } from "./taskCreation";
import { okrLinkedTaskCountsKey } from "./okrApi";
import type { Task, WorkspaceBundle } from "../types";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("idb-keyval", () => ({
  get: async (key: string) => storage.get(key),
  set: async (key: string, value: string) => { storage.set(key, value); },
  del: async (key: string) => { storage.delete(key); },
}));
afterEach(() => storage.clear());

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
