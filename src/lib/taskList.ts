import type {
  DateTimePreferences,
  Label,
  Member,
  SortDirection,
  Task,
  TaskListGrouping,
  TaskListPreference,
  TaskListSort,
  TaskPlacement,
  TaskSection,
} from "../types";

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
  show_labels: false,
} as const;

export const TASK_GROUPING_OPTIONS: Array<{ value: TaskListGrouping; label: string }> = [
  { value: "due", label: "时间" },
  { value: "created", label: "创建时间" },
  { value: "label", label: "标签" },
  { value: "priority", label: "优先级" },
  { value: "assignee", label: "指派人" },
  { value: "none", label: "无" },
];

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

export function taskListKey(smartView: string, selectedLabelId: string | null) {
  return selectedLabelId ? `label:${selectedLabelId}` : smartView;
}

export function defaultSortDirection(sort: TaskListSort): SortDirection {
  return sort === "created" || sort === "updated" || sort === "priority" ? "desc" : "asc";
}

export function resolveTaskListPreference(
  preferences: TaskListPreference[],
  listKey: string,
) {
  const found = preferences.find((item) => item.list_key === listKey);
  if (!found) return { ...DEFAULT_TASK_LIST_PREFERENCE, list_key: listKey };
  const resolved = {
    ...DEFAULT_TASK_LIST_PREFERENCE,
    ...found,
    show_labels: found.show_labels ?? false,
  };
  return {
    ...resolved,
    // “自定义分组”已下线；兼容历史偏好，统一展示为无分组。
    grouping: resolved.grouping === "custom" ? "none" : resolved.grouping,
  };
}

function orderedLabels(labels: Label[]) {
  const byParent = new Map<string | null, Label[]>();
  for (const label of labels) {
    const siblings = byParent.get(label.parent_id) ?? [];
    siblings.push(label);
    byParent.set(label.parent_id, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "zh-Hans-CN"));
  }
  const result: Label[] = [];
  const visit = (parentId: string | null) => {
    for (const label of byParent.get(parentId) ?? []) {
      result.push(label);
      visit(label.id);
    }
  };
  visit(null);
  return result;
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addLocalDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
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
) {
  const directionFactor = direction === "asc" ? 1 : -1;
  const labelOrder = orderedLabels(labels);
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
      result = priorityRank[left.priority] - priorityRank[right.priority];
    } else if (sort === "assignee") {
      result = nullableCompare(
        left.assignee_id ? memberName.get(left.assignee_id) : null,
        right.assignee_id ? memberName.get(right.assignee_id) : null,
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
  grouping: TaskListGrouping;
  sort: TaskListSort;
  direction: SortDirection;
  labels: Label[];
  members: Member[];
  sections: TaskSection[];
  placements: TaskPlacement[];
  now: Date;
  preferences: Pick<DateTimePreferences, "weekStartsOn">;
}) {
  const {
    grouping, labels, members, sections, placements, now, preferences,
  } = input;
  const tasks = input.tasks.filter((task) => task.status === "open");
  const sortGroup = (items: Task[]) =>
    sortTasks(items, input.sort, input.direction, labels, members, placements);
  const groups: TaskListGroup[] = [];
  const add = (id: string, title: string, items: Task[], sectionId?: string | null) => {
    if (items.length > 0 || grouping === "custom") {
      groups.push({ id, title, tasks: sortGroup(items), sectionId });
    }
  };

  if (grouping === "custom") {
    const placementByTask = new Map(placements.map((item) => [item.task_id, item]));
    const ungroupedTasks = tasks.filter(
      (task) => !placementByTask.get(task.id)?.section_id,
    );
    if (ungroupedTasks.length > 0 || sections.length > 0) {
      groups.push({
        id: "section:ungrouped",
        title: "未分组",
        tasks: sortGroup(ungroupedTasks),
        sectionId: null,
      });
    }
    for (const section of [...sections].sort((a, b) => a.position - b.position)) {
      add(
        `section:${section.id}`,
        section.name,
        tasks.filter((task) => placementByTask.get(task.id)?.section_id === section.id),
        section.id,
      );
    }
  } else if (grouping === "due") {
    const today = startOfLocalDay(now);
    const tomorrow = addLocalDays(today, 1);
    const afterTomorrow = addLocalDays(today, 2);
    const nextWeek = addLocalDays(startOfWeek(now, preferences.weekStartsOn), 7);
    const dueTime = (task: Task) => task.due_at ? new Date(task.due_at).getTime() : null;
    const overdue = (task: Task) => {
      const due = dueTime(task);
      if (due == null) return false;
      return task.due_is_all_day ? due < today.getTime() : due < now.getTime();
    };
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
    for (const label of orderedLabels(labels)) {
      add(`label:${label.id}`, label.name, tasks.filter((task) => task.label_ids.includes(label.id)));
    }
    add("label:none", "无标签", tasks.filter((task) => task.label_ids.length === 0));
  } else if (grouping === "priority") {
    add("priority:high", "高优先级", tasks.filter((task) => task.priority === "high"));
    add("priority:medium", "中优先级", tasks.filter((task) => task.priority === "medium"));
    add("priority:low", "低优先级", tasks.filter((task) => task.priority === "low"));
    add("priority:none", "无优先级", tasks.filter((task) => task.priority === "none"));
  } else if (grouping === "assignee") {
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
    add("assignee:none", "未指派", tasks.filter((task) => !task.assignee_id));
  } else {
    add("none", "", tasks);
  }
  return groups.filter((group) => group.tasks.length > 0 || grouping === "custom");
}
