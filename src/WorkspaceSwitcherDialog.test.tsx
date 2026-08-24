import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSwitcherDialog } from "./WorkspaceSwitcherDialog";
import type { Workspace } from "./types";

function createWorkspaces(count: number): Workspace[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `workspace-${index + 1}`,
    name: index === count - 1 ? `研发空间 ${index + 1}` : `团队空间 ${index + 1}`,
    slug: `team-${index + 1}`,
    created_by: "user-1",
  }));
}

describe("WorkspaceSwitcherDialog", () => {
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    document.body.replaceChildren();
  });

  async function renderDialog(
    workspaces: Workspace[],
    options: {
      currentWorkspaceId?: string;
      onOpenChange?: (open: boolean) => void;
      onSelectWorkspace?: (workspaceId: string) => void;
    } = {},
  ) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onOpenChange = options.onOpenChange ?? vi.fn();
    const onSelectWorkspace = options.onSelectWorkspace ?? vi.fn();
    await act(async () => {
      root?.render(
        <WorkspaceSwitcherDialog
          open
          onOpenChange={onOpenChange}
          workspaces={workspaces}
          currentWorkspaceId={options.currentWorkspaceId ?? workspaces[0]!.id}
          onSelectWorkspace={onSelectWorkspace}
        />,
      );
    });
    return { onOpenChange, onSelectWorkspace };
  }

  it("shows search only when there are more than six team spaces", async () => {
    await renderDialog(createWorkspaces(6));
    expect(document.querySelector('[aria-label="搜索团队空间"]')).toBeNull();

    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();

    await renderDialog(createWorkspaces(7));
    expect(document.querySelector('[aria-label="搜索团队空间"]')).toBeTruthy();
  });

  it("filters by name and renders a no-results state", async () => {
    await renderDialog(createWorkspaces(7));
    const input = document.querySelector<HTMLInputElement>('[aria-label="搜索团队空间"]')!;

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "研发");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelectorAll('.workspace-switch-item')).toHaveLength(1);
    expect(document.querySelector('.workspace-switch-list')?.textContent).toContain("研发空间 7");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "不存在");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelector('.workspace-switch-empty')?.textContent).toContain("未找到团队空间");
  });

  it("marks the current space and closes without selecting it again", async () => {
    const workspaces = createWorkspaces(3);
    const { onOpenChange, onSelectWorkspace } = await renderDialog(workspaces, {
      currentWorkspaceId: workspaces[1]!.id,
    });
    const current = document.querySelector<HTMLButtonElement>('[aria-checked="true"]')!;
    expect(current.textContent).toContain(workspaces[1]!.name);

    await act(async () => current.click());
    expect(onSelectWorkspace).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("supports arrow-key navigation and Enter selection", async () => {
    const workspaces = createWorkspaces(3);
    const { onOpenChange, onSelectWorkspace } = await renderDialog(workspaces);
    const current = document.querySelector<HTMLButtonElement>('[aria-checked="true"]')!;
    current.focus();

    await act(async () => {
      current.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }));
    });
    const next = document.activeElement as HTMLButtonElement;
    expect(next.textContent).toContain(workspaces[1]!.name);

    await act(async () => {
      next.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(onSelectWorkspace).toHaveBeenCalledWith(workspaces[1]!.id);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
