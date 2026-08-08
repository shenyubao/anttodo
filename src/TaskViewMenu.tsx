import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Check,
  ChevronRight,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  TASK_GROUPING_OPTIONS,
  TASK_SORT_OPTIONS,
  defaultSortDirection,
  groupingOptionsForViewMode,
} from "./lib/taskList";
import type {
  TaskListGrouping,
  TaskListPreference,
  TaskListSort,
  TaskViewMode,
} from "./types";

export function TaskViewMenu({
  preference,
  viewMode = "list",
  online,
  onChange,
}: {
  preference: Pick<TaskListPreference, "grouping" | "sort" | "direction">;
  viewMode?: TaskViewMode;
  online: boolean;
  onChange: (
    patch: Partial<Pick<TaskListPreference, "grouping" | "sort" | "direction">>,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<"grouping" | "sort" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const groupingOptions = groupingOptionsForViewMode(viewMode);
  const groupingLabel = (groupingOptions.length > 0 ? groupingOptions : TASK_GROUPING_OPTIONS)
    .find((option) => option.value === preference.grouping)?.label
    ?? TASK_GROUPING_OPTIONS.find((option) => option.value === preference.grouping)?.label;
  const sortLabel = TASK_SORT_OPTIONS.find((option) => option.value === preference.sort)?.label;

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

  async function selectGrouping(grouping: TaskListGrouping) {
    await onChange({ grouping });
    setOpen(false);
    setSubmenu(null);
  }

  async function selectSort(sort: TaskListSort) {
    await onChange({ sort, direction: defaultSortDirection(sort) });
    setOpen(false);
    setSubmenu(null);
  }

  return (
    <div className="task-view-menu-anchor" ref={menuRef}>
      <button
        className="icon-button"
        aria-label="分组与排序"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setSubmenu(null);
        }}
      >
        <ArrowDownUp />
      </button>
      {open && (
        <div className="task-view-menu" role="menu" aria-label="分组与排序">
          <button
            role="menuitem"
            aria-expanded={submenu === "grouping"}
            onClick={() => setSubmenu((value) => value === "grouping" ? null : "grouping")}
          >
            <span>分组</span>
            <em>{groupingLabel}</em>
            <ChevronRight />
          </button>
          <button
            role="menuitem"
            aria-expanded={submenu === "sort"}
            onClick={() => setSubmenu((value) => value === "sort" ? null : "sort")}
          >
            <span>排序</span>
            <em>{sortLabel}</em>
            <ChevronRight />
          </button>
          {preference.sort !== "custom" && (
            <button
              role="menuitem"
              disabled={!online}
              onClick={() => void onChange({
                direction: preference.direction === "asc" ? "desc" : "asc",
              })}
            >
              {preference.direction === "asc" ? <ArrowUp /> : <ArrowDown />}
              <span>{preference.direction === "asc" ? "升序" : "降序"}</span>
            </button>
          )}
          {submenu === "grouping" && (
            <div className="task-view-submenu" role="menu" aria-label="分组方式">
              {groupingOptions.map((option) => (
                <button
                  key={option.value}
                  role="menuitemradio"
                  aria-checked={preference.grouping === option.value}
                  disabled={!online}
                  onClick={() => void selectGrouping(option.value)}
                >
                  <span>{option.label}</span>
                  {preference.grouping === option.value && <Check />}
                </button>
              ))}
            </div>
          )}
          {submenu === "sort" && (
            <div className="task-view-submenu" role="menu" aria-label="排序方式">
              {TASK_SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  role="menuitemradio"
                  aria-checked={preference.sort === option.value}
                  disabled={!online}
                  onClick={() => void selectSort(option.value)}
                >
                  <span>{option.label}</span>
                  {preference.sort === option.value && <Check />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
