import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LabelTreeMenuItems } from "./LabelTreeMenuItems";
import { TaskTitleTokenMenu } from "./TaskTitleTokenMenu";
import type { Label } from "./types";

const labels: Label[] = [
  {
    id: "parent",
    workspace_id: "workspace-1",
    parent_id: null,
    name: "个人项目",
    color: "#b8bdc8",
    kind: "private",
    view_scope: "all",
    manage_scope: "all",
    inherit_permissions: false,
    position: 0,
    created_by: "user-1",
  },
  {
    id: "child",
    workspace_id: "workspace-1",
    parent_id: "parent",
    name: "蚂蚁清单",
    color: "#4772fa",
    kind: "private",
    view_scope: "inherit",
    manage_scope: "inherit",
    inherit_permissions: true,
    position: 0,
    created_by: "user-1",
  },
];

describe("LabelTreeMenuItems", () => {
  let root: Root | null = null;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
  });

  it("renders parent and child rows with distinct tree depths", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onToggle = vi.fn();

    await act(async () => {
      root?.render(
        <div className="task-label-menu" role="menu">
          <LabelTreeMenuItems
            labels={labels}
            selectionFor={(label) => label.id === "child"}
            onToggle={onToggle}
          />
        </div>,
      );
    });

    const rows = [...container.querySelectorAll<HTMLButtonElement>("[role=menuitemcheckbox]")];
    expect(rows.map((row) => row.textContent)).toEqual(["个人项目", "蚂蚁清单"]);
    expect(rows[0]?.style.getPropertyValue("--label-tree-depth")).toBe("0");
    expect(rows[1]?.style.getPropertyValue("--label-tree-depth")).toBe("1");
    expect(rows[0]?.classList.contains("has-children")).toBe(true);
    expect(rows[1]?.getAttribute("aria-checked")).toBe("true");

    await act(async () => rows[1]?.click());
    expect(onToggle).toHaveBeenCalledWith(labels[1]);
  });

  it("keeps the same hierarchy in hashtag suggestions", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TaskTitleTokenMenu
          kind="label"
          assigneeCandidates={[]}
          labelCandidates={labels}
          labelTreeLabels={labels}
          activeIndex={0}
          onSelectAssignee={vi.fn()}
          onSelectLabel={vi.fn()}
        />,
      );
    });

    const rows = [...container.querySelectorAll<HTMLButtonElement>("[role=option]")];
    expect(rows[0]?.style.getPropertyValue("--label-tree-depth")).toBe("0");
    expect(rows[1]?.style.getPropertyValue("--label-tree-depth")).toBe("1");
  });
});
