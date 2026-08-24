import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutProvider } from "./ShortcutProvider";
import { WorkspaceShortcutBindings } from "./WorkspaceShortcutBindings";
import type { ShortcutScope } from "./lib/keyboardShortcuts";

describe("WorkspaceShortcutBindings", () => {
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    document.body.replaceChildren();
  });

  it("opens the team-space switcher globally but not in inputs or suspended dialogs", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onOpenWorkspaceSwitcher = vi.fn();

    async function renderBindings(
      appSection: ShortcutScope,
      settingsOpen = false,
      workspaceSwitcherOpen = false,
    ) {
      await act(async () => {
        root?.render(
          <ShortcutProvider initialScope={appSection}>
            <WorkspaceShortcutBindings
              appSection={appSection}
              settingsOpen={settingsOpen}
              workspaceSwitcherOpen={workspaceSwitcherOpen}
              smartView="all"
              selectedTask={null}
              selectedTasks={[]}
              online
              onOpenSearch={vi.fn()}
              onOpenWorkspaceSwitcher={onOpenWorkspaceSwitcher}
              onOpenSettings={vi.fn()}
              onOpenShortcutsSettings={vi.fn()}
              onChangeSection={vi.fn()}
              onCreateChildTask={vi.fn(async () => undefined)}
              onUpdateTask={vi.fn(async () => undefined)}
              onBulkComplete={vi.fn(async () => undefined)}
              onBulkDelete={vi.fn(async () => undefined)}
              onCloseTask={vi.fn()}
              onNotice={vi.fn()}
            />
          </ShortcutProvider>,
        );
      });
    }

    function pressShortcut(target: Window | HTMLElement = window) {
      target.dispatchEvent(new KeyboardEvent("keydown", {
        key: "K",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }));
    }

    for (const scope of ["tasks", "calendar", "mindmap", "focus"] as const) {
      await renderBindings(scope);
      pressShortcut();
    }
    expect(onOpenWorkspaceSwitcher).toHaveBeenCalledTimes(4);

    const input = document.createElement("input");
    document.body.append(input);
    pressShortcut(input);
    expect(onOpenWorkspaceSwitcher).toHaveBeenCalledTimes(4);

    await renderBindings("tasks", true);
    pressShortcut();
    await renderBindings("tasks", false, true);
    pressShortcut();
    expect(onOpenWorkspaceSwitcher).toHaveBeenCalledTimes(4);
  });
});
