import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DueDateControl, type DueDateTarget } from "./DueDateControl";
import { DEFAULT_DATE_TIME_PREFERENCES } from "./lib/dateTimePreferences";

describe("DueDateControl", () => {
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    document.body.replaceChildren();
  });

  it("defaults a new time range to 00:00 through 23:59 on the selected day", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onSave = vi.fn(async () => undefined);
    const task: DueDateTarget = {
      id: "task-1",
      due_at: null,
      due_start_at: null,
      due_is_all_day: false,
      due_timezone: "Asia/Shanghai",
      reminders: [],
      reminder_persistent: false,
    };

    await act(async () => {
      root?.render(
        <DueDateControl
          task={task}
          online
          now={new Date("2026-08-18T04:00:00.000Z")}
          preferences={DEFAULT_DATE_TIME_PREFERENCES}
          onSave={onSave}
          autoOpen
          showTrigger={false}
          allowRecurrence={false}
        />,
      );
    });

    const rangeTab = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "时间段");
    expect(rangeTab).toBeTruthy();
    await act(async () => {
      rangeTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect((document.querySelector('[aria-label="开始时间"]') as HTMLSelectElement).value)
      .toBe("00:00");
    expect((document.querySelector('[aria-label="结束时间"]') as HTMLSelectElement).value)
      .toBe("23:59");

    await act(async () => {
      (document.querySelector(".due-footer .primary") as HTMLButtonElement).click();
    });

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      due_start_at: "2026-08-17T16:00:00.000Z",
      due_at: "2026-08-18T15:59:00.000Z",
      due_is_all_day: false,
      due_timezone: "Asia/Shanghai",
    }), expect.any(Object));
  });
});
