import { Check, ChevronRight, ListFilter } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  TASK_FILTER_ASSIGNEE_OPTIONS,
  TASK_FILTER_DUE_OPTIONS,
  TASK_FILTER_WATCHING_OPTIONS,
} from "./lib/taskList";
import type {
  TaskListFilterAssignee,
  TaskListFilterDue,
  TaskListFilterWatching,
  TaskListPreference,
} from "./types";

type PreferencePatch = Partial<
  Pick<TaskListPreference, "filter_assignee" | "filter_due" | "filter_watching">
>;

type Submenu = "due" | "assignee" | "watching" | null;

export function TaskFilterMenu({
  preference,
  online,
  locked = false,
  onChange,
}: {
  preference: Pick<
    TaskListPreference,
    "filter_assignee" | "filter_due" | "filter_watching"
  >;
  online: boolean;
  locked?: boolean;
  onChange: (patch: PreferencePatch) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dueLabel = TASK_FILTER_DUE_OPTIONS.find(
    (option) => option.value === preference.filter_due,
  )?.label;
  const assigneeLabel = TASK_FILTER_ASSIGNEE_OPTIONS.find(
    (option) => option.value === preference.filter_assignee,
  )?.label;
  const watchingLabel = TASK_FILTER_WATCHING_OPTIONS.find(
    (option) => option.value === preference.filter_watching,
  )?.label;
  const active = preference.filter_due !== "all"
    || preference.filter_assignee !== "all"
    || preference.filter_watching !== "all";
  const canEdit = online && !locked;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSubmenu(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function selectDue(filter_due: TaskListFilterDue) {
    if (!canEdit) return;
    await onChange({ filter_due });
    setSubmenu(null);
  }

  async function selectAssignee(filter_assignee: TaskListFilterAssignee) {
    if (!canEdit) return;
    await onChange({ filter_assignee });
    setSubmenu(null);
  }

  async function selectWatching(filter_watching: TaskListFilterWatching) {
    if (!canEdit) return;
    await onChange({ filter_watching });
    setSubmenu(null);
  }

  return (
    <div className="task-view-menu-anchor" ref={menuRef}>
      <button
        className="icon-button"
        aria-label="过滤"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={active}
        onClick={() => {
          setOpen((value) => !value);
          setSubmenu(null);
        }}
      >
        <ListFilter />
      </button>
      {open && (
        <div className="task-view-menu" role="menu" aria-label="过滤">
          <button
            role="menuitem"
            aria-expanded={submenu === "due"}
            onClick={() => setSubmenu((value) => value === "due" ? null : "due")}
          >
            <span>时间</span>
            <em>{dueLabel}</em>
            <ChevronRight />
          </button>
          <button
            role="menuitem"
            aria-expanded={submenu === "assignee"}
            onClick={() => setSubmenu((value) => value === "assignee" ? null : "assignee")}
          >
            <span>指派人</span>
            <em>{assigneeLabel}</em>
            <ChevronRight />
          </button>
          <button
            role="menuitem"
            aria-expanded={submenu === "watching"}
            onClick={() => setSubmenu((value) => value === "watching" ? null : "watching")}
          >
            <span>关注人</span>
            <em>{watchingLabel}</em>
            <ChevronRight />
          </button>
          {submenu === "due" && (
            <div className="task-view-submenu" role="menu" aria-label="过滤时间">
              {TASK_FILTER_DUE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  role="menuitemradio"
                  aria-checked={preference.filter_due === option.value}
                  disabled={!canEdit}
                  onClick={() => void selectDue(option.value)}
                >
                  <span>{option.label}</span>
                  {preference.filter_due === option.value && <Check />}
                </button>
              ))}
            </div>
          )}
          {submenu === "assignee" && (
            <div className="task-view-submenu" role="menu" aria-label="过滤指派人">
              {TASK_FILTER_ASSIGNEE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  role="menuitemradio"
                  aria-checked={preference.filter_assignee === option.value}
                  disabled={!canEdit}
                  onClick={() => void selectAssignee(option.value)}
                >
                  <span>{option.label}</span>
                  {preference.filter_assignee === option.value && <Check />}
                </button>
              ))}
            </div>
          )}
          {submenu === "watching" && (
            <div className="task-view-submenu" role="menu" aria-label="过滤关注人">
              {TASK_FILTER_WATCHING_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  role="menuitemradio"
                  aria-checked={preference.filter_watching === option.value}
                  disabled={!canEdit}
                  onClick={() => void selectWatching(option.value)}
                >
                  <span>{option.label}</span>
                  {preference.filter_watching === option.value && <Check />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
