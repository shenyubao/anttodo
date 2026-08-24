import { describe, expect, it } from "vitest";
import { shouldDismissTaskDetailOnPointerDown } from "./taskDetailDismiss";

function el(html: string) {
  document.body.innerHTML = html;
  return document.body.firstElementChild;
}

describe("shouldDismissTaskDetailOnPointerDown", () => {
  it("dismisses clicks on the main workspace chrome", () => {
    const heading = el('<section class="workspace-main"><h1>指派给我</h1></section>')
      ?.querySelector("h1") ?? null;
    expect(shouldDismissTaskDetailOnPointerDown(heading)).toBe(true);
  });

  it("keeps the panel open for the panel, its portals, and task rows", () => {
    expect(shouldDismissTaskDetailOnPointerDown(
      el('<div class="task-detail task-detail-panel"><textarea></textarea></div>')
        ?.querySelector("textarea") ?? null,
    )).toBe(false);
    expect(shouldDismissTaskDetailOnPointerDown(
      el('<div class="due-popover"><button>今天</button></div>')
        ?.querySelector("button") ?? null,
    )).toBe(false);
    expect(shouldDismissTaskDetailOnPointerDown(
      el('<article class="task-row"><button class="task-row-content">任务</button></article>')
        ?.querySelector("button") ?? null,
    )).toBe(false);
    expect(shouldDismissTaskDetailOnPointerDown(
      el('<div class="task-multi-select-menu"><button>标签</button></div>')
        ?.querySelector("button") ?? null,
    )).toBe(false);
    expect(shouldDismissTaskDetailOnPointerDown(
      el('<div class="task-group-header"><button class="task-group-select-all">全选</button></div>')
        ?.querySelector("button") ?? null,
    )).toBe(false);
    expect(shouldDismissTaskDetailOnPointerDown(
      el('<form class="task-group-quick-add"><input /></form>')
        ?.querySelector("input") ?? null,
    )).toBe(false);
  });

  it("ignores non-primary buttons", () => {
    const heading = el("<h1>指派给我</h1>");
    expect(shouldDismissTaskDetailOnPointerDown(heading, 2)).toBe(false);
  });
});
