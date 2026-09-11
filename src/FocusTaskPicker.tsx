import clsx from "clsx";
import { CalendarDays, Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  buildFocusPickerTrees,
  buildRecentFocusPickerTrees,
  partitionFocusPickerTrees,
  sameFocusTarget,
  type FocusPickerTree,
} from "./lib/focusSession";
import {
  dependencyTargetKey,
  type TaskDependencyTarget,
} from "./lib/taskDependencies";
import type { FocusSession, Task } from "./types";

type PickerTab = "recent" | "tasks";
export type TaskPickerFilter = {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
};

const EMPTY_TARGETS: TaskDependencyTarget[] = [];
const EMPTY_KEYS: string[] = [];
const EMPTY_FILTERS: TaskPickerFilter[] = [];

export function FocusTaskPicker({
  open,
  tasks,
  sessions = [],
  selectedTaskId,
  onOpenChange,
  onSelect,
  mode = "focus",
  excludeKeys = EMPTY_KEYS,
  selectedTargets = EMPTY_TARGETS,
  onConfirm,
  selectedTaskIds = EMPTY_KEYS,
  onConfirmTaskIds,
  title,
  filters = EMPTY_FILTERS,
  anchorPoint,
}: {
  open: boolean;
  tasks: Task[];
  sessions?: FocusSession[];
  selectedTaskId: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (taskId: string | null) => void;
  mode?: "focus" | "dependency" | "multi";
  excludeKeys?: string[];
  selectedTargets?: TaskDependencyTarget[];
  onConfirm?: (targets: TaskDependencyTarget[]) => void;
  selectedTaskIds?: string[];
  onConfirmTaskIds?: (taskIds: string[]) => void;
  title?: string;
  filters?: TaskPickerFilter[];
  anchorPoint?: { left: number; top: number };
}) {
  const isDependency = mode === "dependency";
  const isMulti = mode === "dependency" || mode === "multi";
  const [tab, setTab] = useState<PickerTab>("tasks");
  const [query, setQuery] = useState("");
  const [draftKeys, setDraftKeys] = useState<Set<string>>(() => new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const selectedTargetsRef = useRef(selectedTargets);
  const selectedTaskIdsRef = useRef(selectedTaskIds);
  const onOpenChangeRef = useRef(onOpenChange);
  selectedTargetsRef.current = selectedTargets;
  selectedTaskIdsRef.current = selectedTaskIds;
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setTab("tasks");
    setDraftKeys(new Set(mode === "multi"
      ? selectedTaskIdsRef.current
      : selectedTargetsRef.current.map((item) => dependencyTargetKey(item))));
  }, [mode, open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const node = event.target;
      if (node instanceof Node && rootRef.current?.contains(node)) return;
      onOpenChangeRef.current(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChangeRef.current(false);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointer);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !isMulti || !anchorPoint) return;
    const width = Math.min(360, window.innerWidth - 24);
    const height = Math.min(480, window.innerHeight - 24);
    const left = Math.min(
      Math.max(12, anchorPoint.left),
      Math.max(12, window.innerWidth - width - 12),
    );
    const top = Math.min(
      Math.max(12, anchorPoint.top),
      Math.max(12, window.innerHeight - height - 12),
    );
    setPosition({ width, left, top, maxHeight: height });
  }, [anchorPoint, isMulti, open]);

  const trees = useMemo(() => {
    if (!isMulti && tab === "recent") {
      return buildRecentFocusPickerTrees(tasks, sessions, query);
    }
    return buildFocusPickerTrees(tasks, query);
  }, [isMulti, query, sessions, tab, tasks]);

  const grouped = useMemo(() => partitionFocusPickerTrees(trees), [trees]);
  const excluded = useMemo(() => new Set(excludeKeys), [excludeKeys]);

  if (!open) return null;

  const select = (taskId: string | null) => {
    if (isMulti) {
      if (!taskId) return;
      const key = dependencyTargetKey({ taskId });
      if (excluded.has(key)) return;
      setDraftKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return;
    }
    onSelect(taskId);
    onOpenChange(false);
  };

  const confirm = () => {
    if (mode === "multi") {
      onConfirmTaskIds?.([...draftKeys].filter((key) => !excluded.has(key)));
      onOpenChange(false);
      return;
    }
    const targets: TaskDependencyTarget[] = [];
    for (const key of draftKeys) {
      if (excluded.has(key)) continue;
      targets.push({ taskId: key });
    }
    onConfirm?.(targets);
    onOpenChange(false);
  };

  const body = (
    <div
      className={clsx("focus-task-picker", isMulti && "is-dependency", mode === "multi" && "is-multi")}
      ref={rootRef}
      role="dialog"
      aria-label={isMulti ? title ?? (isDependency ? "选择依赖任务" : "选择待办") : "选择专注任务"}
      style={isMulti && anchorPoint ? position : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {!isMulti && (
        <div className="focus-task-picker-tabs">
          <button
            type="button"
            className={clsx(tab === "recent" && "active")}
            onClick={() => setTab("recent")}
          >
            最近
          </button>
          <button
            type="button"
            className={clsx(tab === "tasks" && "active")}
            onClick={() => setTab("tasks")}
          >
            任务
          </button>
        </div>
      )}
      {isMulti && (
        <div className="focus-task-picker-heading">{title ?? (isDependency ? "选择依赖任务" : "选择待办")}</div>
      )}
      {isMulti && filters.length > 0 && (
        <div className="focus-task-picker-filters">
          {filters.map((filter) => (
            <label key={filter.id}>
              <span>{filter.label}</span>
              <select
                aria-label={`${filter.label}筛选`}
                value={filter.value}
                onChange={(event) => filter.onChange(event.target.value)}
              >
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      <label className="focus-task-picker-search">
        <Search />
        <input
          value={query}
          placeholder="搜索"
          aria-label="搜索任务"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="focus-task-picker-list">
        {!isMulti && (
          <button
            type="button"
            className={clsx("focus-task-picker-item", !selectedTaskId && "selected")}
            onClick={() => select(null)}
          >
            <span className={clsx("focus-task-picker-check", !selectedTaskId && "checked")}>
              {!selectedTaskId && <Check />}
            </span>
            <span className="focus-task-picker-title">不关联任务</span>
          </button>
        )}
        {tab === "tasks" || isMulti ? (
          <>
            {grouped.today.length > 0 && (
              <TaskGroup
                title="今天"
                icon
                trees={grouped.today}
                selectedTaskId={selectedTaskId}
                draftKeys={draftKeys}
                excludedKeys={excluded}
                multi={isMulti}
                onSelect={select}
              />
            )}
            {grouped.overdue.length > 0 && (
              <TaskGroup
                title="已过期"
                trees={grouped.overdue}
                selectedTaskId={selectedTaskId}
                draftKeys={draftKeys}
                excludedKeys={excluded}
                multi={isMulti}
                overdue
                onSelect={select}
              />
            )}
            {grouped.rest.length > 0 && (
              <TaskGroup
                title={grouped.today.length || grouped.overdue.length ? "其他" : "全部任务"}
                trees={grouped.rest}
                selectedTaskId={selectedTaskId}
                draftKeys={draftKeys}
                excludedKeys={excluded}
                multi={isMulti}
                onSelect={select}
              />
            )}
          </>
        ) : (
          <TaskGroup
            title="最近"
            trees={trees}
            selectedTaskId={selectedTaskId}
            draftKeys={draftKeys}
            excludedKeys={excluded}
            onSelect={select}
          />
        )}
        {trees.length === 0 && (
          <p className="focus-task-picker-empty">没有可关联的任务</p>
        )}
      </div>
      {isMulti ? (
        <div className="focus-task-picker-footer">
          <button type="button" onClick={() => onOpenChange(false)}>取消</button>
          <button type="button" className="primary" onClick={confirm}>确定</button>
        </div>
      ) : (
        <button
          type="button"
          className="focus-task-picker-close"
          aria-label="关闭"
          onClick={() => onOpenChange(false)}
        >
          <X />
        </button>
      )}
    </div>
  );

  if (isMulti) {
    return createPortal(body, document.body);
  }
  return body;
}

function TaskGroup({
  title,
  trees,
  selectedTaskId,
  draftKeys,
  excludedKeys,
  overdue,
  icon,
  multi,
  onSelect,
}: {
  title: string;
  trees: FocusPickerTree[];
  selectedTaskId: string | null;
  draftKeys: Set<string>;
  excludedKeys: Set<string>;
  overdue?: boolean;
  icon?: boolean;
  multi?: boolean;
  onSelect: (taskId: string) => void;
}) {
  return (
    <div className="focus-task-picker-group">
      <div className="focus-task-picker-group-title">
        {icon && <CalendarDays />}
        <span>{title}</span>
      </div>
      {trees.map((tree) => (
        <PickerTree
          key={tree.task.id}
          tree={tree}
          selectedTaskId={selectedTaskId}
          draftKeys={draftKeys}
          excludedKeys={excludedKeys}
          overdue={overdue}
          multi={multi}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function PickerTree({
  tree,
  selectedTaskId,
  draftKeys,
  excludedKeys,
  overdue,
  multi,
  onSelect,
}: {
  tree: FocusPickerTree;
  selectedTaskId: string | null;
  draftKeys: Set<string>;
  excludedKeys: Set<string>;
  overdue?: boolean;
  multi?: boolean;
  onSelect: (taskId: string) => void;
}) {
  const parentKey = dependencyTargetKey({ taskId: tree.task.id });
  const showParent = !excludedKeys.has(parentKey);
  const parentSelected = multi
    ? draftKeys.has(parentKey)
    : sameFocusTarget(
      { taskId: selectedTaskId },
      { taskId: tree.task.id },
    );
  return (
    <div className="focus-task-picker-tree">
      {showParent && (
        <PickerRow
          title={tree.task.title}
          dueAt={tree.task.due_at}
          overdue={overdue}
          selected={parentSelected}
          onSelect={() => onSelect(tree.task.id)}
        />
      )}
      {tree.children.map((childTask) => {
        const key = dependencyTargetKey({ taskId: childTask.id });
        if (excludedKeys.has(key)) return null;
        const selected = multi
          ? draftKeys.has(key)
          : sameFocusTarget(
            { taskId: selectedTaskId },
            { taskId: childTask.id },
          );
        return (
          <PickerRow
            key={childTask.id}
            title={childTask.title}
            dueAt={childTask.due_at}
            overdue={overdue}
            nested
            selected={selected}
            onSelect={() => onSelect(childTask.id)}
          />
        );
      })}
    </div>
  );
}

function PickerRow({
  title,
  dueAt,
  overdue,
  nested,
  selected,
  onSelect,
}: {
  title: string;
  dueAt: string | null;
  overdue?: boolean;
  nested?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "focus-task-picker-item",
        nested && "nested",
        selected && "selected",
      )}
      onClick={onSelect}
    >
      <span className={clsx("focus-task-picker-check", selected && "checked")}>
        {selected && <Check />}
      </span>
      <span className="focus-task-picker-title">{title}</span>
      {dueAt && (
        <span className={clsx("focus-task-picker-due", overdue && "overdue")}>
          {formatDue(dueAt)}
        </span>
      )}
    </button>
  );
}

function formatDue(dueAt: string) {
  const date = new Date(dueAt);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
