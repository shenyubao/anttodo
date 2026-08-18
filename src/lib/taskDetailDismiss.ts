export const TASK_DETAIL_DISMISS_IGNORE_SELECTOR = [
  ".task-detail",
  ".task-detail-sheet-root",
  ".panel-resize-handle",
  ".due-popover",
  ".priority-menu",
  ".task-more-menu",
  ".ai-smart-process-menu",
  ".ai-childTask-suggest-panel",
  ".ai-format-suggest-panel",
  ".focus-task-picker",
  ".task-context-menu",
  ".task-row",
  ".kanban-card",
  ".task-list-childTask-row",
  ".task-hours-dialog",
  ".comment-mention-menu",
  ".task-title-token-menu",
  ".toast",
  "[data-radix-dialog-content]",
  "[data-radix-dialog-overlay]",
  "[data-radix-popper-content-wrapper]",
].join(",");

export function shouldDismissTaskDetailOnPointerDown(
  target: EventTarget | null,
  button = 0,
) {
  if (button !== 0) return false;
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  if (!element) return false;
  return !element.closest(TASK_DETAIL_DISMISS_IGNORE_SELECTOR);
}
