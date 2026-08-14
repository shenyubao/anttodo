import { describe, expect, it, vi } from "vitest";
import { createSyncController } from "./syncController";

describe("SyncController", () => {
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
