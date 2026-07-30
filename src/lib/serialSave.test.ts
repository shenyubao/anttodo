import { describe, expect, it, vi } from "vitest";
import { SerialSaveQueue, type SaveQueueState } from "./serialSave";

describe("SerialSaveQueue", () => {
  it("debounces and saves only the latest value", async () => {
    vi.useFakeTimers();
    const saves: string[] = [];
    const queue = new SerialSaveQueue(
      "",
      async (value) => {
        saves.push(value);
      },
      () => undefined,
    );

    queue.schedule("a");
    queue.schedule("ab");
    await vi.advanceTimersByTimeAsync(500);

    expect(saves).toEqual(["ab"]);
    queue.stop();
    vi.useRealTimers();
  });

  it("serializes an edit that arrives during an in-flight save", async () => {
    let releaseFirst: (() => void) | undefined;
    const saves: string[] = [];
    const queue = new SerialSaveQueue(
      "",
      (value) => {
        saves.push(value);
        return value === "first"
          ? new Promise<void>((resolve) => {
              releaseFirst = resolve;
            })
          : Promise.resolve();
      },
      () => undefined,
      0,
    );

    queue.schedule("first");
    const firstFlush = queue.flush();
    await vi.waitFor(() => expect(saves).toEqual(["first"]));
    queue.schedule("second");
    releaseFirst?.();
    await firstFlush;

    expect(saves).toEqual(["first", "second"]);
    queue.stop();
  });

  it("reports errors and retries the latest value", async () => {
    const states: SaveQueueState[] = [];
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    const queue = new SerialSaveQueue<string>(
      "before",
      save,
      (state) => states.push(state),
      0,
    );

    queue.schedule("after");
    await expect(queue.flush()).rejects.toThrow("network");
    await expect(queue.retry()).resolves.toBeUndefined();

    expect(save).toHaveBeenCalledTimes(2);
    expect(states.some((state) => state.status === "error")).toBe(true);
    expect(states.at(-1)).toEqual({ status: "saved" });
    queue.stop();
  });
});
