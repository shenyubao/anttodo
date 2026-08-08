import { useEffect } from "react";
import {
  requestFlushPendingEdits,
  useShortcutHandler,
  useShortcuts,
} from "./ShortcutProvider";
import type { ShortcutScope } from "./lib/keyboardShortcuts";
import type { Task } from "./types";

export function WorkspaceShortcutBindings({
  appSection,
  settingsOpen,
  smartView,
  selectedTask,
  online,
  onOpenSearch,
  onOpenSettings,
  onOpenShortcutsSettings,
  onChangeSection,
  onCreateSubtask,
  onUpdateTask,
  onCloseTask,
  onNotice,
}: {
  appSection: ShortcutScope;
  settingsOpen: boolean;
  smartView: string;
  selectedTask: Task | null;
  online: boolean;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenShortcutsSettings: () => void;
  onChangeSection: (section: "tasks" | "calendar" | "mindmap" | "focus") => void;
  onCreateSubtask: (taskId: string, title: string) => Promise<void>;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
  onCloseTask: () => void;
  onNotice: (message: string) => void;
}) {
  const { setActiveScope, setSuspended } = useShortcuts();

  useEffect(() => {
    setActiveScope(appSection);
  }, [appSection, setActiveScope]);

  useEffect(() => {
    setSuspended(settingsOpen);
  }, [settingsOpen, setSuspended]);

  useShortcutHandler("general.flushSave", () => {
    requestFlushPendingEdits();
  });

  useShortcutHandler("general.search", () => {
    onOpenSearch();
  });

  useShortcutHandler("general.settings", () => {
    onOpenSettings();
  });

  useShortcutHandler("general.shortcutsHelp", () => {
    onOpenShortcutsSettings();
  });

  useShortcutHandler("general.goTasks", () => {
    onChangeSection("tasks");
  });

  useShortcutHandler("general.goCalendar", () => {
    onChangeSection("calendar");
  });

  useShortcutHandler("general.goFocus", () => {
    onChangeSection("focus");
  });

  useShortcutHandler("general.goMindmap", () => {
    onChangeSection("mindmap");
  });

  useShortcutHandler("task.focusQuickAdd", () => {
    if (appSection !== "tasks" || smartView === "trash") return false;
    const input = document.querySelector<HTMLInputElement>(
      "[data-quick-add-input], .quick-add-input",
    );
    if (!input) return false;
    input.focus();
    input.select();
  });

  useShortcutHandler("task.addSubtask", () => {
    if (appSection !== "tasks" || !selectedTask || !online || selectedTask.deleted_at) {
      return false;
    }
    void onCreateSubtask(selectedTask.id, "新子任务").catch((error) => {
      onNotice(error instanceof Error ? error.message : "添加子任务失败，请重试");
    });
  });

  useShortcutHandler("task.complete", () => {
    if (appSection !== "tasks" || !selectedTask || !online || selectedTask.deleted_at) {
      return false;
    }
    if (selectedTask.kind === "note") return false;
    void onUpdateTask(selectedTask.id, {
      status: selectedTask.status === "completed" ? "open" : "completed",
      completed_at: selectedTask.status === "completed" ? null : new Date().toISOString(),
    }).catch((error) => {
      onNotice(error instanceof Error ? error.message : "更新任务失败，请重试");
    });
  });

  useShortcutHandler("task.delete", () => {
    if (appSection !== "tasks" || !selectedTask || !online || selectedTask.deleted_at) {
      return false;
    }
    const itemName = selectedTask.kind === "note" ? "笔记" : "任务";
    if (!window.confirm(
      `删除${itemName}“${selectedTask.title}”？此操作会将${itemName}移入回收站。`,
    )) {
      return false;
    }
    void onUpdateTask(selectedTask.id, { deleted_at: new Date().toISOString() })
      .then(() => onCloseTask())
      .catch((error) => {
        onNotice(error instanceof Error ? error.message : "删除失败，请重试");
      });
  });

  return null;
}
