import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoBundle } from "./demo";
import { createOptimisticTask, appendTaskToBundle, isOptimisticTaskId } from "./taskCache";
import { okrLinkedTaskCountsKey, okrLinkedTasksKey } from "./okrApi";
import {
  confirmedTaskCreationData, hasPendingTaskCreations, readAfterTaskCreations,
  retryTaskCreationLink, submitTaskCreation,
} from "./taskCreation";
import type { OkrLinkedTaskSummary, Task, WorkspaceBundle } from "../types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const workspaceId = "workspace-team";
const bundleKey = ["workspace-bundle", workspaceId];
const target = { keyResultId: "kr", objectiveId: "objective", title: "交付", position: 0 };
const krKey = okrLinkedTasksKey(workspaceId, { kind: "key_result", id: target.keyResultId });
const objectiveKey = okrLinkedTasksKey(workspaceId, { kind: "objective", id: target.objectiveId });
const countsKey = okrLinkedTaskCountsKey(workspaceId, "set", ["kr", "other"]);
let client: QueryClient;
const savedTask = (id = "saved", labelIds: string[] = []): Task => createOptimisticTask({
  workspaceId, userId: "demo-user", title: "新待办", labelIds, optimisticId: id,
});
const bundle = () => client.getQueryData<WorkspaceBundle>(bundleKey)!;
const list = (key = krKey) => client.getQueryData<OkrLinkedTaskSummary[]>(key)!;
const counts = () => client.getQueryData<Record<string, number>>(countsKey)!;
function dependencies(create = vi.fn().mockResolvedValue(savedTask())) {
  return { queryClient: client, workspaceId, userId: "demo-user", isOnline: () => true,
    create, link: vi.fn().mockResolvedValue(null), rememberLocalChange: vi.fn() };
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(bundleKey, { ...createDemoBundle(), tasks: [], labelTaskCounts: {}, taskPlacements: [] });
  client.setQueryData(krKey, []);
  client.setQueryData(objectiveKey, []);
  client.setQueryData(countsKey, { kr: 0, other: 3 });
});
afterEach(() => client.clear());

describe("shared task creation", () => {
  it("supports the iOS 15 AbortSignal API without throwIfAborted or reason", async () => {
    const abort = new AbortController();
    Object.defineProperty(abort.signal, "throwIfAborted", { value: undefined });
    Object.defineProperty(abort.signal, "reason", { value: undefined });
    await expect(readAfterTaskCreations(client, workspaceId, async () => ["saved"], abort.signal)).resolves.toEqual(["saved"]);
    abort.abort();
    await expect(readAfterTaskCreations(client, workspaceId, async () => [], abort.signal)).rejects.toThrow("查询已取消");
  });

  it.each([{ labelIds: [] }, { labelIds: ["product"] }])("shows an inbox/label task before the request finishes: $labelIds", async ({ labelIds }) => {
    const response = deferred<Task>();
    const deps = dependencies(vi.fn(() => response.promise));
    const request = submitTaskCreation(deps, { title: "新待办", labelIds });
    await vi.waitFor(() => expect(deps.create).toHaveBeenCalledOnce());
    expect(bundle().tasks).toHaveLength(1);
    expect(isOptimisticTaskId(bundle().tasks[0].id)).toBe(true);
    expect(bundle().tasks[0].label_ids).toEqual(labelIds);
    response.resolve(savedTask("saved", labelIds));
    await request;
    expect(bundle().tasks.map((row) => row.id)).toEqual(["saved"]);
    if (labelIds.length) expect(bundle().labelTaskCounts).toEqual({ product: 1 });
  });

  it("updates both OKR lists and counts immediately, then uses the response without waiting for a refetch", async () => {
    const response = deferred<Task>();
    const linked = deferred<null>();
    const deps = dependencies(vi.fn(() => response.promise));
    deps.link.mockImplementation(() => linked.promise);
    const request = submitTaskCreation(deps, { title: "新待办", labelIds: [], okrTarget: target });
    await vi.waitFor(() => expect(list()).toHaveLength(1));
    expect(client.getQueryData(objectiveKey)).toEqual(list());
    expect(counts()).toEqual({ kr: 1, other: 3 });
    response.resolve(savedTask());
    await vi.waitFor(() => expect(deps.link).toHaveBeenCalledOnce());
    expect(bundle().tasks[0].id).toBe("saved");
    expect(isOptimisticTaskId(list()[0].task_id)).toBe(true);
    linked.resolve(null);
    await request;
    expect(list().map((row) => row.task_id)).toEqual(["saved"]);
    expect(client.getQueryData(objectiveKey)).toEqual(list());
    expect(counts()).toEqual({ kr: 1, other: 3 });
    expect(hasPendingTaskCreations(client, workspaceId)).toBe(false);
  });

  it("rolls back just the failed creation, its placement and counts during concurrent submissions", async () => {
    const first = deferred<Task>();
    const deps = dependencies(vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValueOnce(savedTask("second", ["product"])));
    const failed = submitTaskCreation(deps, { title: "失败", labelIds: ["product"], okrTarget: target,
      optimisticOrder: { listKey: "inbox", sectionId: null, taskIds: [] } });
    const rejection = expect(failed).rejects.toThrow("拒绝保存");
    await vi.waitFor(() => expect(deps.create).toHaveBeenCalledOnce());
    await submitTaskCreation(deps, { title: "成功", labelIds: ["product"], okrTarget: target });
    expect(counts().kr).toBe(2);
    first.reject(new Error("拒绝保存"));
    await rejection;
    expect(bundle().tasks.map((row) => row.id)).toEqual(["second"]);
    expect(bundle().labelTaskCounts).toEqual({ product: 1 });
    expect(bundle().taskPlacements).toEqual([]);
    expect(list().map((row) => row.task_id)).toEqual(["second"]);
    expect(counts()).toEqual({ kr: 1, other: 3 });
  });

  it("merges an early Realtime row without duplicating rows or label counts", async () => {
    const response = deferred<Task>();
    const deps = dependencies(vi.fn(() => response.promise));
    const request = submitTaskCreation(deps, { title: "新待办", labelIds: ["product"] });
    await vi.waitFor(() => expect(deps.create).toHaveBeenCalledOnce());
    client.setQueryData<WorkspaceBundle>(bundleKey, (current) => appendTaskToBundle(current!, savedTask("saved", ["product"])));
    expect(bundle().labelTaskCounts?.product).toBe(2);
    response.resolve(savedTask("saved", ["product"]));
    await request;
    expect(bundle().tasks.map((row) => row.id)).toEqual(["saved"]);
    expect(bundle().labelTaskCounts?.product).toBe(1);
  });

  it("keeps the saved task when linking fails and retries only the association", async () => {
    const deps = dependencies();
    deps.link.mockRejectedValueOnce(new Error("关联失败"));
    const created = await submitTaskCreation(deps, { title: "新待办", labelIds: [], okrTarget: target });
    expect(created).toMatchObject({ id: "saved", okrLinkError: "关联失败" });
    expect(bundle().tasks.map((row) => row.id)).toEqual(["saved"]);
    expect(list()).toEqual([]);
    expect(counts().kr).toBe(0);
    await retryTaskCreationLink(deps, created.id, target);
    expect(deps.create).toHaveBeenCalledOnce();
    expect(deps.link).toHaveBeenCalledTimes(2);
    expect(list().map((row) => row.task_id)).toEqual(["saved"]);
    expect(counts().kr).toBe(1);
    await retryTaskCreationLink(deps, created.id, target);
    expect(list()).toHaveLength(1);
    expect(counts().kr).toBe(1);
  });

  it("does not undo a committed write if background refresh fails", async () => {
    vi.spyOn(client, "invalidateQueries").mockRejectedValue(new Error("刷新失败"));
    await expect(submitTaskCreation(dependencies(), { title: "新待办", labelIds: [], okrTarget: target })).resolves.toMatchObject({ id: "saved" });
    expect(list()[0].task_id).toBe("saved");
    expect(counts().kr).toBe(1);
  });

  it("rejects offline without modifying caches or making a request", async () => {
    const deps = { ...dependencies(), isOnline: () => false };
    await expect(submitTaskCreation(deps, { title: "不写入", labelIds: [], okrTarget: target })).rejects.toThrow("离线");
    expect(deps.create).not.toHaveBeenCalled();
    expect(deps.link).not.toHaveBeenCalled();
    expect(bundle().tasks).toEqual([]);
    expect(list()).toEqual([]);
    expect(counts().kr).toBe(0);
  });

  it("stores only confirmed tasks, placements and counts while a request is pending", async () => {
    const response = deferred<Task>();
    const deps = dependencies(vi.fn(() => response.promise));
    const request = submitTaskCreation(deps, { title: "新待办", labelIds: ["product"], okrTarget: target,
      optimisticOrder: { listKey: "inbox", sectionId: null, taskIds: [] } });
    await vi.waitFor(() => expect(deps.create).toHaveBeenCalledOnce());
    const persisted = confirmedTaskCreationData(client, bundleKey, bundle()) as WorkspaceBundle;
    expect(persisted.tasks).toEqual([]);
    expect(persisted.taskPlacements).toEqual([]);
    expect(persisted.labelTaskCounts?.product).toBe(0);
    expect(confirmedTaskCreationData(client, krKey, list())).toEqual([]);
    expect(confirmedTaskCreationData(client, countsKey, counts())).toEqual({ kr: 0, other: 3 });
    expect(bundle().tasks).toHaveLength(1);
    expect(counts().kr).toBe(1);
    response.resolve(savedTask("saved", ["product"]));
    await request;
    expect((confirmedTaskCreationData(client, bundleKey, bundle()) as WorkspaceBundle).tasks[0].id).toBe("saved");
    expect(confirmedTaskCreationData(client, countsKey, counts())).toEqual({ kr: 1, other: 3 });
  });

  it("waits for pending writes before refetching and discards reads that started before a write", async () => {
    const stale = deferred<string[]>();
    const read = vi.fn().mockImplementationOnce(() => stale.promise).mockResolvedValue(["saved"]);
    const fetching = readAfterTaskCreations(client, workspaceId, read);
    const response = deferred<Task>();
    const deps = dependencies(vi.fn(() => response.promise));
    const request = submitTaskCreation(deps, { title: "新待办", labelIds: [] });
    await vi.waitFor(() => expect(deps.create).toHaveBeenCalledOnce());
    stale.resolve([]);
    await Promise.resolve();
    expect(read).toHaveBeenCalledOnce();
    response.resolve(savedTask());
    await request;
    await expect(fetching).resolves.toEqual(["saved"]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("cancels a waiting refetch without hanging or replaying the write", async () => {
    const response = deferred<Task>();
    const deps = dependencies(vi.fn(() => response.promise));
    const request = submitTaskCreation(deps, { title: "新待办", labelIds: [] });
    await vi.waitFor(() => expect(deps.create).toHaveBeenCalledOnce());
    const abort = new AbortController();
    const read = vi.fn();
    const fetching = readAfterTaskCreations(client, workspaceId, read, abort.signal);
    abort.abort(new Error("cancelled"));
    await expect(fetching).rejects.toThrow("cancelled");
    expect(read).not.toHaveBeenCalled();
    response.resolve(savedTask());
    await request;
    expect(deps.create).toHaveBeenCalledOnce();
  });
});
