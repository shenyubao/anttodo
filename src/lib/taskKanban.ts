import type {
  DateTimePreferences,
  AiCliTool,
  Label,
  Member,
  Task,
  TaskListGrouping,
  TaskListPreference,
  TaskPlacement,
  TaskPriority,
  TaskSection,
} from "../types";
import { groupTasks, isActiveTask, isCompletedTask, sortTasks } from "./taskList";

export type KanbanColumnTarget =
  | { kind: "none" }
  | { kind: "due"; bucket: "overdue" | "today" | "tomorrow" | "week" | "later" | "none" }
  | { kind: "label"; labelId: string | null }
  | { kind: "priority"; priority: TaskPriority }
  | { kind: "assignee"; assigneeId: string | null; cliAssignee: AiCliTool | null }
  | { kind: "created" }
  | { kind: "note" }
  | { kind: "completed" };

export type KanbanColumn = {
  id: string;
  title: string;
  tasks: Task[];
  target: KanbanColumnTarget;
};

export type KanbanDropAction =
  | { kind: "schedule"; dueAt: string | null }
  | { kind: "labels"; sourceLabelId: string | null; targetLabelId: string | null }
  | { kind: "priority"; priority: TaskPriority }
  | { kind: "assignee"; assigneeId: string | null; cliAssignee: AiCliTool | null };

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addLocalDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(value: Date, weekStartsOn: number) {
  const day = startOfLocalDay(value);
  return addLocalDays(day, -((day.getDay() - weekStartsOn + 7) % 7));
}

export function kanbanDueDate(
  bucket: Extract<KanbanColumnTarget, { kind: "due" }>["bucket"],
  now: Date,
  weekStartsOn: number,
) {
  const today = startOfLocalDay(now);
  if (bucket === "none") return null;
  if (bucket === "overdue") return addLocalDays(today, -1).toISOString();
  if (bucket === "today") return today.toISOString();
  if (bucket === "tomorrow") return addLocalDays(today, 1).toISOString();
  if (bucket === "week") return addLocalDays(today, 2).toISOString();
  return addLocalDays(startOfWeek(today, weekStartsOn), 7).toISOString();
}

function templateColumns(
  grouping: TaskListGrouping,
  labels: Label[],
  members: Member[],
  listTitle: string,
  selectedLabelId: string | null,
  cliTools: AiCliTool[],
): Array<Omit<KanbanColumn, "tasks">> {
  if (grouping === "due") {
    return [
      ["due:overdue", "已过期", "overdue"],
      ["due:today", "今天", "today"],
      ["due:tomorrow", "明天", "tomorrow"],
      ["due:week", "本周", "week"],
      ["due:later", "以后", "later"],
      ["due:none", "无日期", "none"],
    ].map(([id, title, bucket]) => ({
      id,
      title,
      target: { kind: "due", bucket } as KanbanColumnTarget,
    }));
  }
  if (grouping === "created") {
    return [
      ["created:today", "今天"],
      ["created:yesterday", "昨天"],
      ["created:week", "本周"],
      ["created:earlier", "更早"],
    ].map(([id, title]) => ({ id, title, target: { kind: "created" } }));
  }
  if (grouping === "label") {
    const columns = [...labels]
      .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name, "zh-Hans-CN"))
      .map((label) => ({
        id: `label:${label.id}`,
        title: label.name,
        target: { kind: "label", labelId: label.id } as KanbanColumnTarget,
      }));
    if (!selectedLabelId) {
      columns.push({
        id: "label:none",
        title: "无标签",
        target: { kind: "label", labelId: null },
      });
    }
    return columns;
  }
  if (grouping === "priority") {
    return [
      ["priority:high", "高优先级", "high"],
      ["priority:medium", "中优先级", "medium"],
      ["priority:low", "低优先级", "low"],
      ["priority:none", "无优先级", "none"],
    ].map(([id, title, priority]) => ({
      id,
      title,
      target: { kind: "priority", priority } as KanbanColumnTarget,
    }));
  }
  if (grouping === "assignee") {
    return [
      ...cliTools.map((tool) => ({
        id: `assignee:cli:${tool}`,
        title: tool === "codex" ? "Codex" : "Claude",
        target: { kind: "assignee", assigneeId: null, cliAssignee: tool } as KanbanColumnTarget,
      })),
      ...[...members]
        .sort((left, right) => (left.profile?.display_name ?? left.user_id).localeCompare(
          right.profile?.display_name ?? right.user_id,
          "zh-Hans-CN",
        ))
        .map((member) => ({
          id: `assignee:${member.user_id}`,
          title: member.profile?.display_name ?? member.user_id,
          target: {
            kind: "assignee",
            assigneeId: member.user_id,
            cliAssignee: null,
          } as KanbanColumnTarget,
        })),
      {
        id: "assignee:none",
        title: "未指派",
        target: { kind: "assignee", assigneeId: null, cliAssignee: null },
      },
    ];
  }
  return [{ id: "none", title: listTitle, target: { kind: "none" } }];
}

export function buildKanbanColumns(input: {
  tasks: Task[];
  preference: Pick<TaskListPreference, "grouping" | "sort" | "direction" | "show_completed">;
  labels: Label[];
  members: Member[];
  sections: TaskSection[];
  placements: TaskPlacement[];
  now: Date;
  dateTimePreferences: Pick<DateTimePreferences, "weekStartsOn">;
  listTitle: string;
  selectedLabelId: string | null;
}) {
  const todos = input.tasks.filter((task) => task.kind !== "note" && isActiveTask(task));
  const notes = input.tasks.filter((task) => task.kind === "note" && isActiveTask(task));
  const groups = groupTasks({
    tasks: todos,
    grouping: input.preference.grouping,
    sort: input.preference.sort,
    direction: input.preference.direction,
    labels: input.labels,
    members: input.members,
    sections: input.sections,
    placements: input.placements,
    now: input.now,
    preferences: input.dateTimePreferences,
  });
  const tasksByGroup = new Map(groups.map((group) => [group.id, group.tasks]));
  const columns: KanbanColumn[] = templateColumns(
    input.preference.grouping === "custom" ? "none" : input.preference.grouping,
    input.labels,
    input.members,
    input.listTitle,
    input.selectedLabelId,
    (["codex", "claude"] as const).filter((tool) =>
      input.tasks.some((task) => task.cli_assignee === tool)),
  ).map((column) => ({ ...column, tasks: tasksByGroup.get(column.id) ?? [] }));
  columns.push({
    id: "notes",
    title: "笔记",
    target: { kind: "note" },
    tasks: sortTasks(
      notes,
      input.preference.sort,
      input.preference.direction,
      input.labels,
      input.members,
      input.placements,
    ),
  });
  if (input.preference.show_completed) {
    columns.push({
      id: "completed",
      title: "已完成",
      target: { kind: "completed" },
      tasks: sortTasks(
        input.tasks.filter(isCompletedTask),
        input.preference.sort,
        input.preference.direction,
        input.labels,
        input.members,
        input.placements,
      ),
    });
  }
  return columns;
}

export function kanbanDropAction(input: {
  source: KanbanColumn;
  target: KanbanColumn;
  now: Date;
  weekStartsOn: number;
}): KanbanDropAction | null {
  const { source, target } = input;
  if (source.id === target.id || source.target.kind === "note" || target.target.kind === "note") {
    return null;
  }
  if (source.target.kind === "completed" || target.target.kind === "completed") return null;
  if (target.target.kind === "due") {
    return {
      kind: "schedule",
      dueAt: kanbanDueDate(target.target.bucket, input.now, input.weekStartsOn),
    };
  }
  if (target.target.kind === "priority") {
    return { kind: "priority", priority: target.target.priority };
  }
  if (target.target.kind === "assignee") {
    return {
      kind: "assignee",
      assigneeId: target.target.assigneeId,
      cliAssignee: target.target.cliAssignee,
    };
  }
  if (target.target.kind === "label") {
    return {
      kind: "labels",
      sourceLabelId: source.target.kind === "label" ? source.target.labelId : null,
      targetLabelId: target.target.labelId,
    };
  }
  return null;
}
