import { describe, expect, it, vi } from "vitest";
import { createSyncController, flushLocalOperation, syncErrorMessage } from "./syncController";

describe("SyncController", () => {
  it("keeps Supabase error details instead of replacing them with a generic message", () => {
    expect(syncErrorMessage({
      code: "PGRST202",
      message: "Could not find the function",
      details: "Searched for the function public.pull_client_changes",
      hint: "Reload the schema cache",
    })).toBe(
      "Could not find the function Reload the schema cache (PGRST202)",
    );
  });

  it("coalesces duplicate manual runs into one request", async () => {
    let resolveRun!: (value: { status: "succeeded"; applied: number; conflicts: number }) => void;
    const runRemote = vi.fn(() => new Promise<{ status: "succeeded"; applied: number; conflicts: number }>((resolve) => {
      resolveRun = resolve;
    }));
    const controller = createSyncController({
      workspaceId: "workspace-1",
      online: true,
      runRemote,
    });

    const first = controller.syncNow("manual");
    const second = controller.syncNow("manual");
    expect(runRemote).toHaveBeenCalledTimes(1);
    resolveRun({ status: "succeeded", applied: 2, conflicts: 0 });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: "succeeded", applied: 2, conflicts: 0 },
      { status: "succeeded", applied: 2, conflicts: 0 },
    ]);
    expect(controller.getStatus().phase).toBe("idle");
    controller.dispose();
  });

  it("exposes offline and error states", async () => {
    const offline = createSyncController({ workspaceId: "w", online: false });
    await expect(offline.syncNow("manual")).resolves.toMatchObject({ status: "offline" });
    expect(offline.getStatus().phase).toBe("offline");
    offline.dispose();

    const failed = createSyncController({
      workspaceId: "w",
      online: true,
      runRemote: async () => {
        throw new Error("network unavailable");
      },
    });
    await expect(failed.syncNow("manual")).resolves.toMatchObject({ status: "failed" });
    expect(failed.getStatus()).toMatchObject({ phase: "error", errorMessage: "network unavailable" });
    failed.dispose();
  });
});

describe("flushLocalOperation", () => {
  it("waits for a second sync when an existing run did not include the new operation", async () => {
    const operation = {
      operationId: "operation-1",
      workspaceId: "workspace-1",
      deviceId: "device-1",
      deviceSeq: 1,
      entityType: "tasks",
      entityId: "task-1",
      payload: {},
    };
    const syncNow = vi.fn()
      .mockResolvedValueOnce({ status: "succeeded", applied: 0, conflicts: 0 })
      .mockResolvedValueOnce({ status: "succeeded", applied: 1, conflicts: 0 });
    const listPending = vi.fn()
      .mockResolvedValueOnce([operation])
      .mockResolvedValueOnce([]);

    await expect(flushLocalOperation({
      operationId: operation.operationId,
      workspaceId: operation.workspaceId,
      listPending,
      syncNow,
    })).resolves.toBe(true);
    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  it("stops when the task create operation failed", async () => {
    const operation = {
      operationId: "operation-1",
      workspaceId: "workspace-1",
      deviceId: "device-1",
      deviceSeq: 1,
      entityType: "tasks",
      entityId: "task-1",
      payload: {},
      state: "failed",
    };
    const syncNow = vi.fn().mockResolvedValue({
      status: "conflict",
      applied: 0,
      conflicts: 1,
    });

    await expect(flushLocalOperation({
      operationId: operation.operationId,
      workspaceId: operation.workspaceId,
      listPending: vi.fn().mockResolvedValue([operation]),
      syncNow,
    })).resolves.toBe(false);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });
});
