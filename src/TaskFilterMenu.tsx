import { Check, ChevronRight, ListFilter } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  TASK_FILTER_ASSIGNEE_OPTIONS,
  TASK_FILTER_CREATOR_OPTIONS,
  TASK_FILTER_DUE_OPTIONS,
  TASK_FILTER_WATCHING_OPTIONS,
  assigneeFilterLabel,
  dueFilterLabel,
  exclusiveAssigneeFilter,
  toggleDueFilter,
  toggleAssigneeUserFilter,
} from "./lib/taskList";
import { memberDisplayName } from "./lib/taskTitleTokens";
import type {
  Member,
  TaskListFilterAssignee,
  TaskListFilterCreator,
  TaskListFilterDue,
  TaskListFilterWatching,
  TaskListPreference,
} from "./types";

type PreferencePatch = Partial<
  Pick<
    TaskListPreference,
    | "filter_assignee"
    | "filter_assignee_ids"
    | "filter_creator"
    | "filter_due"
    | "filter_watching"
  >
>;

type Submenu = "due" | "assignee" | "watching" | "creator" | null;

export function TaskFilterMenu({
  preference,
  members,
  online,
  locked = false,
  onChange,
}: {
  preference: Pick<
    TaskListPreference,
    | "filter_assignee"
    | "filter_assignee_ids"
    | "filter_creator"
    | "filter_due"
    | "filter_watching"
  >;
  members: Member[];
  online: boolean;
  locked?: boolean;
  onChange: (patch: PreferencePatch) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dueLabel = dueFilterLabel(preference.filter_due);
  const assigneeLabel = assigneeFilterLabel(preference, members);
  const watchingLabel = TASK_FILTER_WATCHING_OPTIONS.find(
    (option) => option.value === preference.filter_watching,
  )?.label;
  const creatorLabel = TASK_FILTER_CREATOR_OPTIONS.find(
    (option) => option.value === preference.filter_creator,
  )?.label;
  const active = !preference.filter_due.includes("all")
    || preference.filter_assignee !== "all"
    || preference.filter_watching !== "all"
    || preference.filter_creator !== "all";
  const canEdit = online && !locked;
  const sortedMembers = useMemo(
    () => [...members].sort((left, right) =>
      memberDisplayName(left).localeCompare(memberDisplayName(right), "zh-Hans-CN")),
    [members],
  );
  const selectedAssigneeIds = preference.filter_assignee === "users"
    ? new Set(preference.filter_assignee_ids ?? [])
    : new Set<string>();

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
    await onChange({ filter_due: toggleDueFilter(preference.filter_due, filter_due) });
  }

  async function selectExclusiveAssignee(
    mode: Exclude<TaskListFilterAssignee, "users">,
  ) {
    if (!canEdit) return;
    await onChange(exclusiveAssigneeFilter(mode));
  }

  async function toggleAssigneeUser(userId: string) {
    if (!canEdit) return;
    await onChange(toggleAssigneeUserFilter(preference, userId));
  }

  async function selectWatching(filter_watching: TaskListFilterWatching) {
    if (!canEdit) return;
    await onChange({ filter_watching });
    setSubmenu(null);
  }

  async function selectCreator(filter_creator: TaskListFilterCreator) {
    if (!canEdit) return;
    await onChange({ filter_creator });
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
          <button
            role="menuitem"
            aria-expanded={submenu === "creator"}
            onClick={() => setSubmenu((value) => value === "creator" ? null : "creator")}
          >
            <span>创建人</span>
            <em>{creatorLabel}</em>
            <ChevronRight />
          </button>
          {submenu === "due" && (
            <div className="task-view-submenu" role="menu" aria-label="过滤时间">
              {TASK_FILTER_DUE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  role="menuitemcheckbox"
                  aria-checked={option.value === "all"
                    ? preference.filter_due.includes("all")
                    : preference.filter_due.includes(option.value)}
                  disabled={!canEdit}
                  onClick={() => option.value === "all"
                    ? void onChange({ filter_due: ["all"] })
                    : void selectDue(option.value)}
                >
                  <span>{option.label}</span>
                  {((option.value === "all" && preference.filter_due.includes("all"))
                    || (option.value !== "all" && preference.filter_due.includes(option.value)))
                    && <Check />}
                </button>
              ))}
            </div>
          )}
          {submenu === "assignee" && (
            <div
              className="task-view-submenu task-view-submenu-scrollable"
              role="menu"
              aria-label="过滤指派人"
            >
              {TASK_FILTER_ASSIGNEE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  role="menuitemradio"
                  aria-checked={preference.filter_assignee === option.value}
                  disabled={!canEdit}
                  onClick={() => void selectExclusiveAssignee(option.value)}
                >
                  <span>{option.label}</span>
                  {preference.filter_assignee === option.value && <Check />}
                </button>
              ))}
              {sortedMembers.length > 0 && (
                <div className="task-assignee-divider" aria-hidden="true" />
              )}
              {sortedMembers.map((member) => {
                const checked = selectedAssigneeIds.has(member.user_id);
                return (
                  <button
                    key={member.user_id}
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    disabled={!canEdit}
                    onClick={() => void toggleAssigneeUser(member.user_id)}
                  >
                    <span>{memberDisplayName(member)}</span>
                    {checked && <Check />}
                  </button>
                );
              })}
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
          {submenu === "creator" && (
            <div className="task-view-submenu" role="menu" aria-label="过滤创建人">
              {TASK_FILTER_CREATOR_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  role="menuitemradio"
                  aria-checked={preference.filter_creator === option.value}
                  disabled={!canEdit}
                  onClick={() => void selectCreator(option.value)}
                >
                  <span>{option.label}</span>
                  {preference.filter_creator === option.value && <Check />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
