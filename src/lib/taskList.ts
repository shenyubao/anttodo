import type {
  DateTimePreferences,
  CustomTaskView,
  CustomTaskViewDefinition,
  Label,
  Member,
  SortDirection,
  Task,
  TaskListFilterAssignee,
  TaskListFilterCreator,
  TaskListFilterDue,
  TaskListFilterDueSelection,
  TaskListFilterWatching,
  TaskListGrouping,
  TaskListPreference,
  TaskListSort,
  TaskPlacement,
  TaskSection,
  TaskSystemViewPreference,
  TaskViewMode,
  UserLabelOrder,
} from "../types";
import { aiCliLabel } from "./aiWork";
import {
  compareSiblingLabels,
  userLabelOrderMap,
} from "./labels";
import { isRootTask } from "./taskTree";

export type TaskListGroup = {
  id: string;
  title: string;
  tasks: Task[];
  sectionId?: string | null;
};

export const DEFAULT_TASK_LIST_PREFERENCE = {
  grouping: "none",
  sort: "custom",
  direction: "asc",
  filter_assignee: "all" as TaskListFilterAssignee,
  filter_assignee_ids: [] as string[],
  filter_watching: "all",
  filter_creator: "all",
  filter_due: ["all"] as TaskListFilterDueSelection,
  show_labels: false,
  show_completed: true,
  show_hours: false,
  view_mode: "list",
} as const;

export function effectiveTaskPriority(task: Task) {
  return task.kind === "note" ? "none" : task.priority;
}

export function isActiveTask(task: Task) {
  return task.kind === "note" || task.status === "open";
}

export function isCompletedTask(task: Task) {
  return task.kind !== "note" && task.status === "completed";
}

export const TASK_GROUPING_OPTIONS: Array<{ value: TaskListGrouping; label: string }> = [
  { value: "custom", label: "自定义" },
  { value: "due", label: "时间" },
  { value: "created", label: "创建时间" },
  { value: "label", label: "团队标签" },
  { value: "priority", label: "优先级" },
  { value: "assignee", label: "指派人" },
  { value: "none", label: "无" },
];

/** Groupings available in timeline view (轻量甘特). */
export const TIMELINE_GROUPING_VALUES = [
  "custom",
  "label",
  "priority",
  "none",
] as const satisfies readonly TaskListGrouping[];

export const TIMELINE_GROUPING_OPTIONS = TASK_GROUPING_OPTIONS.filter((option) =>
  (TIMELINE_GROUPING_VALUES as readonly string[]).includes(option.value));

export function isTimelineGrouping(grouping: TaskListGrouping) {
  return (TIMELINE_GROUPING_VALUES as readonly string[]).includes(grouping);
}

export function groupingOptionsForViewMode(viewMode: TaskViewMode) {
  return viewMode === "timeline" ? TIMELINE_GROUPING_OPTIONS : TASK_GROUPING_OPTIONS;
}

export function clampGroupingForViewMode(
  grouping: TaskListGrouping,
  viewMode: TaskViewMode,
): TaskListGrouping {
  if (viewMode === "timeline" && !isTimelineGrouping(grouping)) return "none";
  if (viewMode === "kanban" && grouping === "none") return "custom";
  return grouping;
}

export const TASK_SORT_OPTIONS: Array<{ value: TaskListSort; label: string }> = [
  { value: "custom", label: "自定义" },
  { value: "due", label: "时间" },
  { value: "created", label: "创建时间" },
  { value: "updated", label: "修改时间" },
  { value: "title", label: "标题" },
  { value: "label", label: "标签" },
  { value: "priority", label: "优先级" },
  { value: "assignee", label: "指派人" },
];

/** Exclusive assignee modes shown above the team member multi-select list. */
export const TASK_FILTER_ASSIGNEE_OPTIONS: Array<{
  value: Exclude<TaskListFilterAssignee, "users">;
  label: string;
}> = [
  { value: "all", label: "不限" },
  { value: "unassigned", label: "无指派人" },
  { value: "assigned_to_me", label: "指派给我" },
];

export const TASK_FILTER_WATCHING_OPTIONS: Array<{
  value: TaskListFilterWatching;
  label: string;
}> = [
  { value: "all", label: "不限" },
  { value: "watching", label: "我关注的" },
];

export const TASK_FILTER_CREATOR_OPTIONS: Array<{
  value: TaskListFilterCreator;
  label: string;
}> = [
  { value: "all", label: "不限" },
  { value: "created_by_me", label: "我创建的" },
];

export const TASK_FILTER_DUE_OPTIONS: Array<{
  value: TaskListFilterDue;
  label: string;
}> = [
  { value: "all", label: "不限" },
  { value: "overdue", label: "已过期" },
  { value: "today", label: "今天" },
  { value: "tomorrow", label: "明天" },
  { value: "this_week", label: "本周" },
  { value: "next_7_days", label: "7天内" },
  { value: "next_30_days", label: "30天内" },
];

const TASK_FILTER_DUE_VALUES = TASK_FILTER_DUE_OPTIONS
  .map((option) => option.value)
  .filter((value): value is Exclude<TaskListFilterDue, "all"> => value !== "all");

type TaskListFilterDueInput =
  | TaskListFilterDueSelection
  | TaskListFilterDue
  | "all"
  | null
  | undefined;

export function normalizeDueFilter(input: TaskListFilterDueInput): TaskListFilterDueSelection {
  const values = Array.isArray(input) ? input : input == null ? [] : [input];
  if (values.includes("all")) return ["all"];
  const selected = new Set(values);
  return TASK_FILTER_DUE_VALUES.filter((value) => selected.has(value));
}

export function toggleDueFilter(
  current: TaskListFilterDueInput,
  value: TaskListFilterDue | "all",
): TaskListFilterDueSelection {
  if (value === "all") return ["all"];
  const selected = new Set(normalizeDueFilter(current));
  selected.delete("all");
  if (selected.has(value)) selected.delete(value);
  else selected.add(value);
  return normalizeDueFilter(selected.size > 0 ? Array.from(selected) : ["all"]);
}

export function dueFilterLabel(filter: TaskListFilterDueInput): string {
  const selected = normalizeDueFilter(filter);
  if (selected[0] === "all") return "不限";
  const labels = selected
    .map((value) => TASK_FILTER_DUE_OPTIONS.find((option) => option.value === value)?.label)
    .filter((label): label is string => Boolean(label));
  if (labels.length <= 1) return labels[0] ?? "不限";
  return `${labels[0]}等${labels.length}项`;
}

export type TaskListFilterFields = {
  filter_assignee: TaskListFilterAssignee;
  filter_assignee_ids: string[];
  filter_watching: TaskListFilterWatching;
  filter_creator: TaskListFilterCreator;
  filter_due: TaskListFilterDueSelection;
};

export function normalizeAssigneeFilter(input: {
  filter_assignee?: TaskListFilterAssignee | null;
  filter_assignee_ids?: string[] | null;
}): Pick<TaskListFilterFields, "filter_assignee" | "filter_assignee_ids"> {
  const mode = input.filter_assignee ?? "all";
  const uniqueIds = Array.from(
    new Set((input.filter_assignee_ids ?? []).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));

  if (mode === "users") {
    if (uniqueIds.length === 0) {
      return { filter_assignee: "all", filter_assignee_ids: [] };
    }
    return { filter_assignee: "users", filter_assignee_ids: uniqueIds };
  }
  return { filter_assignee: mode, filter_assignee_ids: [] };
}

export function toggleAssigneeUserFilter(
  current: Pick<TaskListFilterFields, "filter_assignee" | "filter_assignee_ids">,
  userId: string,
): Pick<TaskListFilterFields, "filter_assignee" | "filter_assignee_ids"> {
  const existing = current.filter_assignee === "users"
    ? current.filter_assignee_ids
    : [];
  const next = new Set(existing);
  if (next.has(userId)) next.delete(userId);
  else next.add(userId);
  return normalizeAssigneeFilter({
    filter_assignee: next.size > 0 ? "users" : "all",
    filter_assignee_ids: Array.from(next),
  });
}

export function exclusiveAssigneeFilter(
  mode: Exclude<TaskListFilterAssignee, "users">,
): Pick<TaskListFilterFields, "filter_assignee" | "filter_assignee_ids"> {
  return normalizeAssigneeFilter({ filter_assignee: mode, filter_assignee_ids: [] });
}

export function assigneeFilterLabel(
  filter: Pick<TaskListFilterFields, "filter_assignee" | "filter_assignee_ids">,
  members: Iterable<Pick<Member, "user_id" | "profile">>,
): string {
  if (filter.filter_assignee !== "users") {
    return TASK_FILTER_ASSIGNEE_OPTIONS.find((option) => option.value === filter.filter_assignee)
      ?.label
      ?? "不限";
  }
  const ids = filter.filter_assignee_ids ?? [];
  if (ids.length === 0) return "不限";
  const byId = new Map(
    Array.from(members, (member) => [member.user_id, member]),
  );
  const names = ids.map((id) => {
    const member = byId.get(id);
    return member?.profile?.display_name?.trim() || "团队成员";
  });
  if (names.length === 1) return names[0]!;
  return `${names[0]}等${names.length}人`;
}

const MINE_TASK_LIST_FILTERS: TaskListFilterFields = {
  filter_due: ["all"],
  filter_assignee: "all",
  filter_assignee_ids: [],
  filter_watching: "all",
  filter_creator: "created_by_me",
};

/** Smart views that are just fixed filter presets over the full task list. */
export const SMART_VIEW_FILTER_PRESETS: Record<string, TaskListFilterFields> = {
  inbox: { ...MINE_TASK_LIST_FILTERS },
  today: {
    filter_due: ["today"],
    filter_assignee: "assigned_to_me",
    filter_assignee_ids: [],
    filter_watching: "all",
    filter_creator: "all",
  },
  week: {
    filter_due: ["this_week"],
    filter_assignee: "assigned_to_me",
    filter_assignee_ids: [],
    filter_watching: "all",
    filter_creator: "all",
  },
  assigned: {
    filter_due: ["all"],
    filter_assignee: "assigned_to_me",
    filter_assignee_ids: [],
    filter_watching: "all",
    filter_creator: "all",
  },
  watching: {
    filter_due: ["all"],
    filter_assignee: "all",
    filter_assignee_ids: [],
    filter_watching: "watching",
    filter_creator: "all",
  },
};

/** Default filters for system lists, including the editable trash list. */
export const SMART_VIEW_FILTER_DEFAULTS: Record<string, TaskListFilterFields> = {
  ...SMART_VIEW_FILTER_PRESETS,
  trash: { ...MINE_TASK_LIST_FILTERS, filter_assignee_ids: [], filter_due: ["all"] },
};

export function customTaskViewKey(viewId: string): `custom:${string}` {
  return `custom:${viewId}`;
}

export function customTaskViewId(smartView: string) {
  return smartView.startsWith("custom:") ? smartView.slice("custom:".length) : null;
}

export function isCustomTaskView(smartView: string) {
  return customTaskViewId(smartView) !== null;
}

/** System smart views that users may hide from the sidebar. */
export type HideableSystemSmartView =
  | "inbox"
  | "assigned"
  | "watching"
  | "week"
  | "trash";

export type SystemSmartViewKey = HideableSystemSmartView;

export const DEFAULT_SYSTEM_SMART_VIEW_ORDER: readonly SystemSmartViewKey[] = [
  "inbox",
  "assigned",
  "watching",
  "week",
  "trash",
];

export const DEFAULT_SYSTEM_SMART_VIEW_VISIBILITY: Readonly<Record<SystemSmartViewKey, boolean>> = {
  inbox: true,
  assigned: true,
  watching: true,
  week: false,
  trash: false,
};

const HIDEABLE_SYSTEM_SMART_VIEWS: readonly HideableSystemSmartView[] = DEFAULT_SYSTEM_SMART_VIEW_ORDER;

const DEFAULT_SYSTEM_SMART_VIEW_POSITION = new Map(
  DEFAULT_SYSTEM_SMART_VIEW_ORDER.map((key, index) => [key, index]),
);

const LEGACY_SYSTEM_SMART_VIEW_POSITION = new Map<SystemSmartViewKey, number>([
  ["week", 2],
  ["assigned", 3],
  ["watching", 4],
  ["inbox", 5],
  ["trash", 6],
]);

export function isHideableSystemSmartView(view: string): view is HideableSystemSmartView {
  return (HIDEABLE_SYSTEM_SMART_VIEWS as readonly string[]).includes(view);
}

export function canHideSmartView(viewKey: string) {
  return isHideableSystemSmartView(viewKey) || isCustomTaskView(viewKey);
}

export function defaultSystemSmartViewPosition(viewKey: SystemSmartViewKey) {
  return DEFAULT_SYSTEM_SMART_VIEW_POSITION.get(viewKey) ?? 0;
}

export function defaultSystemSmartViewVisible(viewKey: SystemSmartViewKey) {
  return DEFAULT_SYSTEM_SMART_VIEW_VISIBILITY[viewKey];
}

export function resolveSystemSmartViewVisible(
  preferences: Iterable<Pick<TaskSystemViewPreference, "view_key" | "visible">>,
  viewKey: SystemSmartViewKey,
) {
  for (const preference of preferences) {
    if (preference.view_key === viewKey) return preference.visible;
  }
  return defaultSystemSmartViewVisible(viewKey);
}

/** Resolve the ordered system smart-view keys, filling missing prefs with defaults. */
export function resolveSystemSmartViewOrder(
  preferences: Iterable<Pick<TaskSystemViewPreference, "view_key" | "position">>,
): SystemSmartViewKey[] {
  const positionByKey = new Map<SystemSmartViewKey, number>();
  for (const preference of preferences) {
    if (!isHideableSystemSmartView(preference.view_key)) continue;
    positionByKey.set(preference.view_key, preference.position);
  }
  const usesLegacyDefaultPositions = positionByKey.size > 0
    && [...positionByKey].every(([key, position]) =>
      LEGACY_SYSTEM_SMART_VIEW_POSITION.get(key) === position);
  if (usesLegacyDefaultPositions) return [...DEFAULT_SYSTEM_SMART_VIEW_ORDER];
  return [...DEFAULT_SYSTEM_SMART_VIEW_ORDER].sort((left, right) => {
    const leftPosition = positionByKey.get(left) ?? defaultSystemSmartViewPosition(left);
    const rightPosition = positionByKey.get(right) ?? defaultSystemSmartViewPosition(right);
    if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    return defaultSystemSmartViewPosition(left) - defaultSystemSmartViewPosition(right);
  });
}

/** Build a complete preference list for a new system smart-view order. */
export function applySystemSmartViewOrder(
  preferences: Iterable<Pick<TaskSystemViewPreference, "view_key" | "visible" | "position">>,
  orderedKeys: readonly SystemSmartViewKey[],
  context: { userId: string; workspaceId: string },
): TaskSystemViewPreference[] {
  const byKey = new Map<SystemSmartViewKey, Pick<TaskSystemViewPreference, "view_key" | "visible" | "position">>();
  for (const item of preferences) {
    if (isHideableSystemSmartView(item.view_key)) {
      byKey.set(item.view_key, item);
    }
  }
  return orderedKeys.map((viewKey, position) => ({
    user_id: context.userId,
    workspace_id: context.workspaceId,
    view_key: viewKey,
    visible: byKey.get(viewKey)?.visible ?? defaultSystemSmartViewVisible(viewKey),
    position,
  }));
}

/** Apply a new custom-view id order, keeping unspecified views after ordered ones. */
export function applyCustomTaskViewOrder(
  views: CustomTaskView[],
  orderedIds: readonly string[],
): CustomTaskView[] {
  const byId = new Map(views.map((view) => [view.id, view]));
  const ordered: CustomTaskView[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    const view = byId.get(id);
    if (!view || seen.has(id)) continue;
    ordered.push({ ...view, position: ordered.length });
    seen.add(id);
  }
  for (const view of views) {
    if (seen.has(view.id)) continue;
    ordered.push({ ...view, position: ordered.length });
  }
  return ordered;
}

export type CustomViewSnapshotPresentation = Pick<
  TaskListPreference,
  | "grouping"
  | "sort"
  | "direction"
  | "filter_assignee"
  | "filter_assignee_ids"
  | "filter_watching"
  | "filter_creator"
  | "filter_due"
  | "show_labels"
  | "show_completed"
  | "show_hours"
  | "view_mode"
>;

export type CustomViewSnapshot = {
  definition: CustomTaskViewDefinition;
  presentation: CustomViewSnapshotPresentation;
};

/** Snapshot used when creating a custom view from a sidebar smart list. */
export function buildCustomViewSnapshotFromSmartView(
  preferences: TaskListPreference[],
  smartViewKey: string,
  customViews: CustomTaskView[] = [],
  labels: Label[] = [],
): CustomViewSnapshot {
  const viewId = customTaskViewId(smartViewKey);
  const customView = viewId
    ? customViews.find((view) => view.id === viewId) ?? null
    : null;
  const preference = resolveTaskListPreference(preferences, smartViewKey, labels);

  if (customView) {
    const filters = customTaskViewFilters(customView);
    return {
      definition: { ...customView.definition, filter_due: filters.filter_due },
      presentation: {
        grouping: preference.grouping,
        sort: preference.sort,
        direction: preference.direction,
        ...filters,
        show_labels: preference.show_labels,
        show_completed: preference.show_completed,
        show_hours: preference.show_hours,
        view_mode: preference.view_mode,
      },
    };
  }

  const scope: CustomTaskViewDefinition["scope"] = smartViewKey === "inbox"
    ? "inbox"
    : smartViewKey === "trash"
      ? "trash"
      : "all";
  const filters = SMART_VIEW_FILTER_DEFAULTS[smartViewKey] ?? {
    filter_assignee: DEFAULT_TASK_LIST_PREFERENCE.filter_assignee,
    filter_assignee_ids: DEFAULT_TASK_LIST_PREFERENCE.filter_assignee_ids,
    filter_watching: DEFAULT_TASK_LIST_PREFERENCE.filter_watching,
    filter_creator: DEFAULT_TASK_LIST_PREFERENCE.filter_creator,
    filter_due: DEFAULT_TASK_LIST_PREFERENCE.filter_due,
  };

  return {
    definition: {
      scope,
      label_ids: [],
      ...filters,
    },
    presentation: {
      grouping: preference.grouping,
      sort: preference.sort,
      direction: preference.direction,
      ...filters,
      show_labels: preference.show_labels,
      show_completed: preference.show_completed,
      show_hours: preference.show_hours,
      view_mode: preference.view_mode,
    },
  };
}

export function customTaskViewFilters(view: CustomTaskView | CustomTaskViewDefinition): TaskListFilterFields {
  const definition = "definition" in view ? view.definition : view;
  return {
    ...normalizeAssigneeFilter({
      filter_assignee: definition.filter_assignee,
      filter_assignee_ids: definition.filter_assignee_ids,
    }),
    filter_watching: definition.filter_watching,
    filter_creator: definition.filter_creator,
    filter_due: normalizeDueFilter(definition.filter_due),
  };
}

export function resolveTaskListFilters(
  listKey: string,
  preference: TaskListFilterFields,
  customView?: CustomTaskView | null,
): TaskListFilterFields {
  // Smart system views keep fixed presets. Custom views and free lists use the
  // live preference so filters can be edited and auto-saved.
  if (SMART_VIEW_FILTER_PRESETS[listKey]) {
    return SMART_VIEW_FILTER_PRESETS[listKey];
  }
  if (customView) {
    const seed = customTaskViewFilters(customView);
    return {
      ...normalizeAssigneeFilter({
        filter_assignee: preference.filter_assignee ?? seed.filter_assignee,
        filter_assignee_ids: preference.filter_assignee_ids ?? seed.filter_assignee_ids,
      }),
      filter_watching: preference.filter_watching ?? seed.filter_watching,
      filter_creator: preference.filter_creator ?? seed.filter_creator,
      filter_due: normalizeDueFilter(preference.filter_due ?? seed.filter_due),
    };
  }
  return {
    ...normalizeAssigneeFilter(preference),
    filter_watching: preference.filter_watching,
    filter_creator: preference.filter_creator,
    filter_due: normalizeDueFilter(preference.filter_due),
  };
}

export function taskListKey(smartView: string, selectedLabelId: string | null) {
  return selectedLabelId ? `label:${selectedLabelId}` : smartView;
}

export type OrderedLabelTreeRow = {
  label: Label;
  depth: number;
  hasChildren: boolean;
};

export function orderedLabelTreeRows(
  labels: Label[],
  userLabelOrder?: Iterable<Pick<UserLabelOrder, "label_id" | "position">>,
): OrderedLabelTreeRow[] {
  const byParent = new Map<string | null, Label[]>();
  const orderMap = userLabelOrderMap(userLabelOrder);
  const labelIds = new Set(labels.map((label) => label.id));
  for (const label of labels) {
    const parentId = label.parent_id !== label.id && labelIds.has(label.parent_id ?? "")
      ? label.parent_id
      : null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(label);
    byParent.set(parentId, siblings);
  }
  for (const [parentId, siblings] of byParent.entries()) {
    siblings.sort((a, b) => compareSiblingLabels(a, b, parentId, orderMap));
  }
  const result: OrderedLabelTreeRow[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const label of byParent.get(parentId) ?? []) {
      if (visited.has(label.id)) continue;
      visited.add(label.id);
      result.push({
        label,
        depth,
        hasChildren: (byParent.get(label.id)?.length ?? 0) > 0,
      });
      visit(label.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const label of labels) {
    if (visited.has(label.id)) continue;
    visited.add(label.id);
    result.push({
      label,
      depth: 0,
      hasChildren: (byParent.get(label.id)?.length ?? 0) > 0,
    });
    visit(label.id, 1);
  }
  return result;
}

export function orderedLabels(
  labels: Label[],
  userLabelOrder?: Iterable<Pick<UserLabelOrder, "label_id" | "position">>,
) {
  return orderedLabelTreeRows(labels, userLabelOrder).map(({ label }) => label);
}

export function descendantLabelIds(labels: Label[], rootId: string) {
  const result = new Set<string>();
  const visit = (parentId: string) => {
    for (const label of labels) {
      if (label.parent_id !== parentId) continue;
      result.add(label.id);
      visit(label.id);
    }
  };
  visit(rootId);
  return result;
}

export function labelSubtreeIds(labels: Label[], rootId: string) {
  const result = descendantLabelIds(labels, rootId);
  result.add(rootId);
  return result;
}

export function labelHasChildren(labels: Label[], labelId: string) {
  return labels.some((label) => label.parent_id === labelId);
}

export function leafLabelsInScope(
  labels: Label[],
  scopeIds?: Set<string>,
  userLabelOrder?: Iterable<Pick<UserLabelOrder, "label_id" | "position">>,
) {
  const inScope = (id: string) => !scopeIds || scopeIds.has(id);
  return orderedLabels(labels, userLabelOrder).filter((label) => {
    if (!inScope(label.id)) return false;
    return !labels.some((child) => child.parent_id === label.id && inScope(child.id));
  });
}

export function countTasksForLabelSubtree(
  tasks: Task[],
  labels: Label[],
  labelId: string,
) {
  const scope = labelSubtreeIds(labels, labelId);
  return tasks.filter((task) => isRootTask(task) && task.label_ids.some((id) => scope.has(id))).length;
}

export function filterTasksForView(input: {
  tasks: Task[];
  labels: Label[];
  smartView: string;
  selectedLabelId: string | null;
  customView?: CustomTaskView | null;
}) {
  const { tasks, labels, smartView, selectedLabelId, customView } = input;
  const customScope = customView?.definition.scope;
  if (!selectedLabelId && (smartView === "trash" || customScope === "trash")) {
    return tasks
      .filter((task) => Boolean(task.deleted_at))
      .sort((left, right) => String(right.deleted_at).localeCompare(String(left.deleted_at)));
  }
  let result = tasks.filter((task) => !task.deleted_at && isRootTask(task));
  if (customView?.definition.scope === "inbox") {
    return result.filter((task) => task.label_ids.length === 0);
  }
  if (customView?.definition.scope === "label") {
    const scope = new Set(customView.definition.label_ids);
    return result.filter((task) => task.label_ids.some((id) => scope.has(id)));
  }
  if (selectedLabelId) {
    const scope = labelSubtreeIds(labels, selectedLabelId);
    return result.filter((task) => task.label_ids.some((id) => scope.has(id)));
  }
  // today / assigned / watching stay on locked presets; inbox / trash default to mine.
  if (smartView === "inbox") {
    return result.filter((task) => task.label_ids.length === 0);
  }
  return result;
}

export function applyTaskListFilters(input: {
  tasks: Task[];
  filterAssignee?: TaskListFilterAssignee;
  filterAssigneeIds?: string[];
  filterWatching?: TaskListFilterWatching;
  filterCreator?: TaskListFilterCreator;
  filterDue?: TaskListFilterDueInput;
  currentUserId: string;
  now?: Date;
  weekStartsOn?: DateTimePreferences["weekStartsOn"];
}) {
  const {
    currentUserId,
    filterAssignee = "all",
    filterAssigneeIds = [],
    filterWatching = "all",
    filterCreator = "all",
    filterDue = ["all"],
  } = input;
  const assigneeFilter = normalizeAssigneeFilter({
    filter_assignee: filterAssignee,
    filter_assignee_ids: filterAssigneeIds,
  });
  const now = input.now ?? new Date();
  const weekStartsOn = input.weekStartsOn ?? 1;
  let result = input.tasks;

  if (assigneeFilter.filter_assignee === "unassigned") {
    result = result.filter((task) => !task.assignee_id);
  } else if (assigneeFilter.filter_assignee === "assigned_to_me") {
    result = result.filter((task) => task.assignee_id === currentUserId);
  } else if (assigneeFilter.filter_assignee === "users") {
    const ids = new Set(assigneeFilter.filter_assignee_ids);
    result = result.filter((task) => task.assignee_id != null && ids.has(task.assignee_id));
  }
  if (filterWatching === "watching") {
    result = result.filter((task) => task.participant_ids.includes(currentUserId));
  }
  if (filterCreator === "created_by_me") {
    result = result.filter((task) => task.created_by === currentUserId);
  }

  const dueFilters = normalizeDueFilter(filterDue);
  if (dueFilters.includes("all") || dueFilters.length === 0) return result;

  const today = startOfLocalDay(now);
  const tomorrow = addLocalDays(today, 1);
  const afterTomorrow = addLocalDays(today, 2);
  const dueTime = (task: Task) => task.due_at ? new Date(task.due_at).getTime() : null;
  const overdue = (task: Task) => isTaskOverdue(task, now, today);

  const matchesDueFilter = (task: Task, filter: Exclude<TaskListFilterDue, "all">) => {
    if (filter === "overdue") return overdue(task);
    if (filter === "today") {
      const due = dueTime(task);
      return due != null
        && due >= today.getTime()
        && due < tomorrow.getTime();
    }
    if (filter === "tomorrow") {
      const due = dueTime(task);
      return due != null && due >= tomorrow.getTime() && due < afterTomorrow.getTime();
    }
    if (filter === "this_week") {
      const weekStart = startOfWeek(now, weekStartsOn);
      const nextWeek = addLocalDays(weekStart, 7);
      const due = dueTime(task);
      return due != null && due >= weekStart.getTime() && due < nextWeek.getTime();
    }
    const windowDays = filter === "next_7_days" ? 7 : 30;
    const windowEnd = addLocalDays(today, windowDays);
    const due = dueTime(task);
    return due != null && due >= today.getTime() && due < windowEnd.getTime();
  };
  return result.filter((task) => dueFilters
    .filter((filter): filter is Exclude<TaskListFilterDue, "all"> => filter !== "all")
    .some((filter) => matchesDueFilter(task, filter)));
}

export function defaultSortDirection(sort: TaskListSort): SortDirection {
  return sort === "created" || sort === "updated" || sort === "priority" ? "desc" : "asc";
}

export function resolveTaskListPreference(
  preferences: TaskListPreference[],
  listKey: string,
  labels: Label[] = [],
  viewMode?: TaskViewMode,
) {
  const found = preferences.find((item) => item.list_key === listKey);
  const filterDefaults = SMART_VIEW_FILTER_DEFAULTS[listKey] ?? {
    filter_assignee: DEFAULT_TASK_LIST_PREFERENCE.filter_assignee,
    filter_assignee_ids: [...DEFAULT_TASK_LIST_PREFERENCE.filter_assignee_ids],
    filter_watching: DEFAULT_TASK_LIST_PREFERENCE.filter_watching,
    filter_creator: DEFAULT_TASK_LIST_PREFERENCE.filter_creator,
    filter_due: DEFAULT_TASK_LIST_PREFERENCE.filter_due,
  };
  if (!found) {
    const labelId = listKey.startsWith("label:") ? listKey.slice("label:".length) : null;
    const mode = viewMode ?? DEFAULT_TASK_LIST_PREFERENCE.view_mode;
    const grouping: TaskListGrouping = mode === "kanban"
      ? "custom"
      : labelId && labelHasChildren(labels, labelId)
        ? "label"
        : DEFAULT_TASK_LIST_PREFERENCE.grouping;
    return {
      ...DEFAULT_TASK_LIST_PREFERENCE,
      ...filterDefaults,
      list_key: listKey,
      grouping,
      view_mode: mode,
    };
  }
  const filters = resolveTaskListFilters(listKey, {
    filter_assignee: found.filter_assignee ?? filterDefaults.filter_assignee,
    filter_assignee_ids: found.filter_assignee_ids ?? filterDefaults.filter_assignee_ids,
    filter_watching: found.filter_watching ?? filterDefaults.filter_watching,
    filter_creator: found.filter_creator ?? filterDefaults.filter_creator,
    filter_due: normalizeDueFilter(found.filter_due ?? filterDefaults.filter_due),
  });
  return {
    ...DEFAULT_TASK_LIST_PREFERENCE,
    ...found,
    ...filters,
    show_labels: found.show_labels ?? false,
    show_completed: found.show_completed ?? DEFAULT_TASK_LIST_PREFERENCE.show_completed,
    show_hours: found.show_hours ?? false,
    view_mode: found.view_mode ?? "list",
  };
}

export const UNGROUPED_GROUP_KEY = "ungrouped";
export const UNGROUPED_GROUP_ID = `section:${UNGROUPED_GROUP_KEY}`;

export function customGroupKey(sectionId: string | null | undefined) {
  return sectionId ?? UNGROUPED_GROUP_KEY;
}

export function orderedTaskSections(sections: TaskSection[]) {
  return [...sections].sort((left, right) =>
    left.position - right.position || left.id.localeCompare(right.id));
}

export function ungroupedPosition(sections: TaskSection[]) {
  const ordered = orderedTaskSections(sections);
  const occupied = new Set(ordered.map((section) => section.position));
  for (let index = 0; index <= ordered.length; index += 1) {
    if (!occupied.has(index)) return index;
  }
  return 0;
}

export function orderedGroupKeys(sections: TaskSection[]) {
  const keys = orderedTaskSections(sections).map((section) => section.id);
  keys.splice(Math.max(0, Math.min(ungroupedPosition(sections), keys.length)), 0, UNGROUPED_GROUP_KEY);
  return keys;
}

export function positionsFromGroupKeys(keys: readonly string[]) {
  const positionById = new Map<string, number>();
  keys.forEach((key, position) => {
    if (key !== UNGROUPED_GROUP_KEY) positionById.set(key, position);
  });
  return positionById;
}

export function taskSectionOrderAfterMove(
  sections: TaskSection[],
  activeSectionId: string,
  overSectionId: string,
) {
  const orderedIds = orderedGroupKeys(sections);
  const from = orderedIds.indexOf(activeSectionId);
  const to = orderedIds.indexOf(overSectionId);
  if (from < 0 || to < 0 || from === to) return orderedIds;
  const [activeId] = orderedIds.splice(from, 1);
  orderedIds.splice(to, 0, activeId);
  return orderedIds;
}

export function taskSectionOrderAfterInsert(
  sections: TaskSection[],
  sectionId: string,
  index?: number,
) {
  const orderedIds = orderedGroupKeys(sections).filter((id) => id !== sectionId);
  orderedIds.splice(
    Math.max(0, Math.min(index ?? orderedIds.length, orderedIds.length)),
    0,
    sectionId,
  );
  return orderedIds;
}

export function resolveCustomGroupKey(input: {
  overId: string;
  groups: Array<{
    id: string;
    sectionId?: string | null;
    tasks: Array<{ id: string }>;
  }>;
}) {
  if (input.overId.startsWith("section:")) return input.overId.slice("section:".length);
  const group = input.groups.find((item) =>
    item.tasks.some((task) => task.id === input.overId)
    || `group:${item.id}` === input.overId);
  if (!group?.id.startsWith("section:")) return null;
  return customGroupKey(group.sectionId);
}

export function taskOrdersAfterCrossSectionMove(input: {
  sourceTaskIds: string[];
  targetTaskIds: string[];
  taskId: string;
  targetIndex?: number;
}) {
  const sourceTaskIds = input.sourceTaskIds.filter((id) => id !== input.taskId);
  const targetTaskIds = input.targetTaskIds.filter((id) => id !== input.taskId);
  const targetIndex = Math.max(
    0,
    Math.min(input.targetIndex ?? 0, targetTaskIds.length),
  );
  targetTaskIds.splice(targetIndex, 0, input.taskId);
  return { sourceTaskIds, targetTaskIds };
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addLocalDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function isTaskOverdue(task: Task, now: Date, today = startOfLocalDay(now)) {
  if (!task.due_at) return false;
  const due = new Date(task.due_at).getTime();
  return task.due_is_all_day ? due < today.getTime() : due < now.getTime();
}

function startOfWeek(value: Date, weekStartsOn: number) {
  const day = startOfLocalDay(value);
  const offset = (day.getDay() - weekStartsOn + 7) % 7;
  return addLocalDays(day, -offset);
}

function nullableCompare<T>(
  left: T | null | undefined,
  right: T | null | undefined,
  compare: (a: T, b: T) => number,
  directionFactor = 1,
) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return compare(left, right) * directionFactor;
}

export function sortTasks(
  tasks: Task[],
  sort: TaskListSort,
  direction: SortDirection,
  labels: Label[],
  members: Member[],
  placements: TaskPlacement[],
  userLabelOrder?: Iterable<Pick<UserLabelOrder, "label_id" | "position">>,
) {
  const directionFactor = direction === "asc" ? 1 : -1;
  const labelOrder = orderedLabels(labels, userLabelOrder);
  const labelRank = new Map(labelOrder.map((label, index) => [label.id, index]));
  const labelName = new Map(labels.map((label) => [label.id, label.name]));
  const memberName = new Map(
    members.map((member) => [member.user_id, member.profile?.display_name ?? member.user_id]),
  );
  const placement = new Map(placements.map((item) => [item.task_id, item.position]));
  const priorityRank = { none: 0, low: 1, medium: 2, high: 3 };
  const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });
  const labelKey = (task: Task) =>
    [...task.label_ids]
      .sort((a, b) => (labelRank.get(a) ?? Number.MAX_SAFE_INTEGER)
        - (labelRank.get(b) ?? Number.MAX_SAFE_INTEGER))
      .map((id) => labelName.get(id) ?? "")
      .join("\u0000") || null;
  const assigneeKey = (task: Task) => task.cli_assignee
    ? aiCliLabel(task.cli_assignee)
    : task.assignee_id ? memberName.get(task.assignee_id) ?? task.assignee_id : null;

  return [...tasks].sort((left, right) => {
    let result = 0;
    let directionApplied = false;
    if (sort === "custom") {
      result = nullableCompare(
        placement.get(left.id),
        placement.get(right.id),
        (a, b) => a - b,
      );
    } else if (sort === "due") {
      result = nullableCompare(left.due_at, right.due_at, (a, b) =>
        new Date(a).getTime() - new Date(b).getTime(), directionFactor);
      directionApplied = true;
    } else if (sort === "created") {
      result = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    } else if (sort === "updated") {
      result = new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime();
    } else if (sort === "title") {
      result = collator.compare(left.title, right.title);
    } else if (sort === "label") {
      result = nullableCompare(
        labelKey(left),
        labelKey(right),
        (a, b) => collator.compare(a, b),
        directionFactor,
      );
      directionApplied = true;
    } else if (sort === "priority") {
      result = priorityRank[effectiveTaskPriority(left)]
        - priorityRank[effectiveTaskPriority(right)];
    } else if (sort === "assignee") {
      result = nullableCompare(
        assigneeKey(left),
        assigneeKey(right),
        (a, b) => collator.compare(a, b),
        directionFactor,
      );
      directionApplied = true;
    }
    if (result !== 0) return directionApplied ? result : result * directionFactor;
    const created = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    return created || left.id.localeCompare(right.id);
  });
}

export function groupTasks(input: {
  tasks: Task[];
  includeClosed?: boolean;
  grouping: TaskListGrouping;
  sort: TaskListSort;
  direction: SortDirection;
  labels: Label[];
  members: Member[];
  sections: TaskSection[];
  placements: TaskPlacement[];
  now: Date;
  preferences: Pick<DateTimePreferences, "weekStartsOn">;
  selectedLabelId?: string | null;
  userLabelOrder?: Iterable<Pick<UserLabelOrder, "label_id" | "position">>;
}) {
  const {
    grouping, labels, members, sections, placements, now, preferences,
    userLabelOrder,
  } = input;
  const selectedLabelId = input.selectedLabelId ?? null;
  const tasks = input.includeClosed ? input.tasks : input.tasks.filter(isActiveTask);
  const sortGroup = (items: Task[]) =>
    sortTasks(items, input.sort, input.direction, labels, members, placements, userLabelOrder);
  const groups: TaskListGroup[] = [];
  const add = (id: string, title: string, items: Task[], sectionId?: string | null) => {
    if (items.length > 0 || grouping === "custom") {
      groups.push({ id, title, tasks: sortGroup(items), sectionId });
    }
  };

  if (grouping === "custom") {
    const placementByTask = new Map(placements.map((item) => [item.task_id, item]));
    const tasksBySection = new Map<string | null, Task[]>();
    tasksBySection.set(null, []);
    const sectionById = new Map(sections.map((section) => [section.id, section]));
    for (const section of sections) tasksBySection.set(section.id, []);
    for (const task of tasks) {
      const sectionId = placementByTask.get(task.id)?.section_id ?? null;
      (tasksBySection.get(sectionId) ?? tasksBySection.get(null)!).push(task);
    }
    for (const key of orderedGroupKeys(sections)) {
      if (key === UNGROUPED_GROUP_KEY) {
        add(UNGROUPED_GROUP_ID, "未分组", tasksBySection.get(null) ?? [], null);
        continue;
      }
      const section = sectionById.get(key);
      if (!section) continue;
      add(
        `section:${section.id}`,
        section.name,
        tasksBySection.get(section.id) ?? [],
        section.id,
      );
    }
  } else if (grouping === "due") {
    const today = startOfLocalDay(now);
    const tomorrow = addLocalDays(today, 1);
    const afterTomorrow = addLocalDays(today, 2);
    const nextWeek = addLocalDays(startOfWeek(now, preferences.weekStartsOn), 7);
    const dueTime = (task: Task) => task.due_at ? new Date(task.due_at).getTime() : null;
    const overdue = (task: Task) => isTaskOverdue(task, now, today);
    add("due:overdue", "已过期", tasks.filter(overdue));
    add("due:today", "今天", tasks.filter((task) => {
      const due = dueTime(task);
      return due != null
        && !overdue(task)
        && due >= today.getTime()
        && due < tomorrow.getTime();
    }));
    add("due:tomorrow", "明天", tasks.filter((task) => {
      const due = dueTime(task);
      return due != null && due >= tomorrow.getTime() && due < afterTomorrow.getTime();
    }));
    add("due:week", "本周", tasks.filter((task) => {
      const due = dueTime(task);
      return due != null && due >= afterTomorrow.getTime() && due < nextWeek.getTime();
    }));
    add("due:later", "以后", tasks.filter((task) => {
      const due = dueTime(task);
      return due != null && due >= Math.max(afterTomorrow.getTime(), nextWeek.getTime());
    }));
    add("due:none", "无日期", tasks.filter((task) => !task.due_at));
  } else if (grouping === "created") {
    const today = startOfLocalDay(now);
    const tomorrow = addLocalDays(today, 1);
    const yesterday = addLocalDays(today, -1);
    const week = startOfWeek(now, preferences.weekStartsOn);
    const created = (task: Task) => new Date(task.created_at).getTime();
    add("created:today", "今天", tasks.filter((task) => created(task) >= today.getTime() && created(task) < tomorrow.getTime()));
    add("created:yesterday", "昨天", tasks.filter((task) => created(task) >= yesterday.getTime() && created(task) < today.getTime()));
    add("created:week", "本周", tasks.filter((task) => created(task) >= week.getTime() && created(task) < yesterday.getTime()));
    add("created:earlier", "更早", tasks.filter(
      (task) => created(task) < Math.min(week.getTime(), yesterday.getTime()),
    ));
  } else if (grouping === "label") {
    const scopeIds = selectedLabelId ? labelSubtreeIds(labels, selectedLabelId) : undefined;
    const leafLabels = leafLabelsInScope(labels, scopeIds, userLabelOrder);
    const leafIds = new Set(leafLabels.map((label) => label.id));
    for (const label of leafLabels) {
      add(
        `label:${label.id}`,
        label.name,
        tasks.filter((task) => task.label_ids.includes(label.id)),
      );
    }
    const intermediateTasks = tasks.filter((task) => {
      const scopedIds = scopeIds
        ? task.label_ids.filter((id) => scopeIds.has(id))
        : task.label_ids;
      if (scopedIds.length === 0) return false;
      return scopedIds.every((id) => !leafIds.has(id));
    });
    const intermediateTitle = selectedLabelId
      ? labels.find((label) => label.id === selectedLabelId)?.name ?? "其他标签"
      : "其他标签";
    add("label:intermediate", intermediateTitle, intermediateTasks);
    if (!selectedLabelId) {
      add("label:none", "无标签", tasks.filter((task) => task.label_ids.length === 0));
    }
  } else if (grouping === "priority") {
    add("priority:high", "高优先级", tasks.filter((task) => effectiveTaskPriority(task) === "high"));
    add("priority:medium", "中优先级", tasks.filter((task) => effectiveTaskPriority(task) === "medium"));
    add("priority:low", "低优先级", tasks.filter((task) => effectiveTaskPriority(task) === "low"));
    add("priority:none", "无优先级", tasks.filter((task) => effectiveTaskPriority(task) === "none"));
  } else if (grouping === "assignee") {
    for (const tool of ["codex", "claude"] as const) {
      add(
        `assignee:cli:${tool}`,
        aiCliLabel(tool),
        tasks.filter((task) => task.cli_assignee === tool),
      );
    }
    for (const member of [...members].sort((a, b) =>
      (a.profile?.display_name ?? a.user_id).localeCompare(
        b.profile?.display_name ?? b.user_id,
        "zh-Hans-CN",
      ))) {
      add(
        `assignee:${member.user_id}`,
        member.profile?.display_name ?? member.user_id,
        tasks.filter((task) => task.assignee_id === member.user_id),
      );
    }
    add(
      "assignee:none",
      "未指派",
      tasks.filter((task) => !task.assignee_id && !task.cli_assignee),
    );
  } else {
    add("none", "", tasks);
  }
  return groups.filter((group) => group.tasks.length > 0 || grouping === "custom");
}
