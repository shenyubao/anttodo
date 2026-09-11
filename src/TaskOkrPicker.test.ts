import { describe, expect, it } from "vitest";
import { formatTaskOkrBulkNotice, resolveTaskOkrSelection } from "./TaskOkrPicker";

describe("task OKR selection state", () => {
  it("preselects a shared KR for a bulk selection", () => {
    expect(resolveTaskOkrSelection(["task-1", "task-2"], {
      "task-1": "kr-1",
      "task-2": "kr-1",
    })).toBe("kr-1");
  });

  it("reports mixed links and treats missing links as unlinked", () => {
    expect(resolveTaskOkrSelection(["task-1", "task-2"], {
      "task-1": "kr-1",
    })).toBe("__mixed__");
    expect(resolveTaskOkrSelection(["task-1", "task-2"], {})).toBeNull();
  });

  it("summarizes successful, failed, and skipped bulk items", () => {
    expect(formatTaskOkrBulkNotice({ ok: 2, failed: 1, skipped: 3, action: "关联 KR" }))
      .toBe("关联 KR：2 项成功，1 项失败，3 项跳过");
  });
});
