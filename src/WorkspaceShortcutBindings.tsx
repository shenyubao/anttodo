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
  selectedTasks,
  online,
  onOpenSearch,
  onOpenSettings,
  onOpenShortcutsSettings,
  onChangeSection,
  onCreateChildTask,
  onUpdateTask,
  onBulkComplete,
  onBulkDelete,
  onCloseTask,
  onNotice,
}: {
  appSection: ShortcutScope;
  settingsOpen: boolean;
  smartView: string;
  selectedTask: Task | null;
  selectedTasks: Task[];
  online: boolean;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenShortcutsSettings: () => void;
  onChangeSection: (section: "tasks" | "calendar" | "mindmap" | "focus") => void;
  onCreateChildTask: (taskId: string, title: string) => Promise<void>;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
  onBulkComplete: () => Promise<void>;
  onBulkDelete: () => Promise<void>;
  onCloseTask: () => void;
  onNotice: (message: string) => void;
}) {
  const { setActiveScope, setSuspended } = useShortcuts();
  const multiSelected = selectedTasks.length >= 2;

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

  useShortcutHandler("task.addChildTask", () => {
    if (multiSelected) return false;
    if (appSection !== "tasks" || !selectedTask || !online || selectedTask.deleted_at) {
      return false;
    }
    void onCreateChildTask(selectedTask.id, "新子级任务").catch((error) => {
      onNotice(error instanceof Error ? error.message : "添加子级任务失败，请重试");
    });
  });

  useShortcutHandler("task.complete", () => {
    if (appSection !== "tasks" || !online) return false;
    if (multiSelected) {
      void onBulkComplete().catch((error) => {
        onNotice(error instanceof Error ? error.message : "更新任务失败，请重试");
      });
      return;
    }
    if (!selectedTask || selectedTask.deleted_at) return false;
    if (selectedTask.kind === "note") return false;
    void onUpdateTask(selectedTask.id, {
      status: selectedTask.status === "completed" ? "open" : "completed",
      completed_at: selectedTask.status === "completed" ? null : new Date().toISOString(),
    }).catch((error) => {
      onNotice(error instanceof Error ? error.message : "更新任务失败，请重试");
    });
  });

  useShortcutHandler("task.delete", () => {
    if (appSection !== "tasks" || !online) return false;
    if (multiSelected) {
      void onBulkDelete().catch((error) => {
        onNotice(error instanceof Error ? error.message : "删除失败，请重试");
      });
      return;
    }
    if (!selectedTask || selectedTask.deleted_at) return false;
    void onUpdateTask(selectedTask.id, { deleted_at: new Date().toISOString() })
      .then(() => onCloseTask())
      .catch((error) => {
        onNotice(error instanceof Error ? error.message : "删除失败，请重试");
      });
  });

  return null;
}
