import * as Dialog from "@radix-ui/react-dialog";
import { Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { initials } from "./MemberAvatar";
import type { Workspace } from "./types";

const SEARCH_THRESHOLD = 6;

export function WorkspaceSwitcherDialog({
  open,
  onOpenChange,
  workspaces,
  currentWorkspaceId,
  onSelectWorkspace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: Workspace[];
  currentWorkspaceId: string;
  onSelectWorkspace: (workspaceId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(currentWorkspaceId);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const showSearch = workspaces.length > SEARCH_THRESHOLD;
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-Hans-CN");
  const filteredWorkspaces = useMemo(
    () => normalizedQuery
      ? workspaces.filter((workspace) =>
          workspace.name.toLocaleLowerCase("zh-Hans-CN").includes(normalizedQuery))
      : workspaces,
    [normalizedQuery, workspaces],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    setActiveWorkspaceId(currentWorkspaceId);
  }, [currentWorkspaceId, open]);

  useEffect(() => {
    if (!open) return;
    if (filteredWorkspaces.some((workspace) => workspace.id === activeWorkspaceId)) return;
    setActiveWorkspaceId(filteredWorkspaces[0]?.id ?? "");
  }, [activeWorkspaceId, filteredWorkspaces, open]);

  function focusWorkspace(workspaceId: string) {
    setActiveWorkspaceId(workspaceId);
    queueMicrotask(() => itemRefs.current.get(workspaceId)?.focus());
  }

  function chooseWorkspace(workspaceId: string) {
    if (workspaceId !== currentWorkspaceId) onSelectWorkspace(workspaceId);
    onOpenChange(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!filteredWorkspaces.length) return;
      event.preventDefault();
      const currentIndex = filteredWorkspaces.findIndex(
        (workspace) => workspace.id === activeWorkspaceId,
      );
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const fallbackIndex = direction > 0 ? -1 : 0;
      const nextIndex = (Math.max(currentIndex, fallbackIndex) + direction + filteredWorkspaces.length)
        % filteredWorkspaces.length;
      focusWorkspace(filteredWorkspaces[nextIndex]!.id);
      return;
    }

    const keyboardSelectionTarget = event.target === searchInputRef.current
      || (event.target instanceof Element && Boolean(event.target.closest(".workspace-switch-item")));
    if (event.key === "Enter" && keyboardSelectionTarget && activeWorkspaceId) {
      event.preventDefault();
      chooseWorkspace(activeWorkspaceId);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay workspace-switch-dialog-overlay" />
        <Dialog.Content
          className="dialog-content workspace-switch-dialog"
          onKeyDown={handleKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            queueMicrotask(() => {
              if (showSearch) searchInputRef.current?.focus();
              else itemRefs.current.get(currentWorkspaceId)?.focus();
            });
          }}
        >
          <header className="workspace-switch-dialog-header">
            <Dialog.Title>切换团队空间</Dialog.Title>
            <Dialog.Close className="workspace-switch-dialog-close" aria-label="关闭团队空间切换">
              <X />
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">
            选择要进入的团队空间
          </Dialog.Description>

          {showSearch && (
            <label className="workspace-switch-search">
              <Search aria-hidden="true" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索团队空间"
                aria-label="搜索团队空间"
              />
            </label>
          )}

          <div className="workspace-switch-list" role="radiogroup" aria-label="团队空间列表">
            {filteredWorkspaces.length ? filteredWorkspaces.map((workspace) => {
              const current = workspace.id === currentWorkspaceId;
              const active = workspace.id === activeWorkspaceId;
              return (
                <button
                  key={workspace.id}
                  ref={(node) => {
                    if (node) itemRefs.current.set(workspace.id, node);
                    else itemRefs.current.delete(workspace.id);
                  }}
                  type="button"
                  role="radio"
                  aria-checked={current}
                  className={clsx(
                    "workspace-switch-item",
                    current && "current",
                    active && "keyboard-active",
                  )}
                  onFocus={() => setActiveWorkspaceId(workspace.id)}
                  onMouseMove={() => setActiveWorkspaceId(workspace.id)}
                  onClick={() => chooseWorkspace(workspace.id)}
                >
                  <span className="workspace-initial" aria-hidden="true">
                    {initials(workspace.name).slice(0, 1)}
                  </span>
                  <span>{workspace.name}</span>
                  {current && <Check aria-hidden="true" />}
                </button>
              );
            }) : (
              <div className="workspace-switch-empty" role="status">
                <Search aria-hidden="true" />
                <strong>未找到团队空间</strong>
                <span>换个名称试试</span>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
