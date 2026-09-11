import {
  addDays,
  addWeeks,
  endOfWeek,
  format,
  getISOWeek,
  getISOWeekYear,
  parseISO,
  startOfWeek,
} from "date-fns";
import { buildTaskOpenUrl } from "../../supabase/functions/_shared/app-url";
import type { Label, Task, WeeklyReport, WeeklyReportVisibility } from "../types";

type WeeklyReportTaskRef = Pick<Task, "id" | "workspace_id" | "title" | "kind">;
type WeeklyReportSelectedTask = Pick<Task, "id" | "workspace_id" | "title" | "kind" | "label_ids" | "parent_task_id">;

export type WeeklyReportTextPart =
  | { type: "text"; value: string }
  | { type: "link"; href: string; label: string };

const WEEKLY_REPORT_LINK_RE = /\[((?:\\.|[^\]])+)\]\((https?:\/\/[^)\s]+)\)/g;

export type WeeklyReportSection = "completed" | "next_plan";
export type WeeklyReportTaskTimeFilter = "through_this_week" | "through_next_week" | "all";
export type WeeklyReportTaskAssigneeFilter = "me" | "unassigned" | "all";
export type WeeklyReportTaskFilters = {
  time: WeeklyReportTaskTimeFilter;
  assignee: WeeklyReportTaskAssigneeFilter;
};

export function defaultWeeklyReportTaskFilters(section: WeeklyReportSection): WeeklyReportTaskFilters {
  return {
    time: section === "completed" ? "through_this_week" : "through_next_week",
    assignee: "me",
  };
}

export function weeklyReportWeekStart(date = new Date()) {
  return format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export function weeklyReportWeekEnd(weekStart: string) {
  return format(endOfWeek(parseISO(weekStart), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export function shiftWeeklyReportWeek(weekStart: string, amount: number) {
  return format(addWeeks(parseISO(weekStart), amount), "yyyy-MM-dd");
}

export function weeklyReportWeekMeta(weekStart: string) {
  const start = parseISO(weekStart);
  const end = addDays(start, 6);
  return {
    week: getISOWeek(start),
    year: getISOWeekYear(start),
    range: `${format(start, "M月d日")}–${format(end, "M月d日")}`,
  };
}

export function canCreateWeeklyReportForWeek(weekStart: string, now = new Date()) {
  const current = weeklyReportWeekStart(now);
  return weekStart === current || weekStart === shiftWeeklyReportWeek(current, -1);
}

export function filterWeeklyReportPickerTasks(
  tasks: Task[],
  input: {
    section: WeeklyReportSection;
    weekStart: string;
    time: WeeklyReportTaskTimeFilter;
    assignee: WeeklyReportTaskAssigneeFilter;
    currentUserId: string;
  },
) {
  const cutoff = input.time === "all"
    ? null
    : addDays(parseISO(input.weekStart), input.time === "through_this_week" ? 7 : 14).getTime();
  return tasks.filter((task) => {
    if (task.kind !== "todo" || task.deleted_at) return false;
    if (input.section === "completed" && task.status !== "completed") return false;
    if (input.section === "next_plan" && task.status !== "open") return false;
    if (input.assignee === "me" && task.assignee_id !== input.currentUserId) return false;
    if (input.assignee === "unassigned" && task.assignee_id !== null) return false;
    if (cutoff !== null && (!task.due_at || new Date(task.due_at).getTime() >= cutoff)) return false;
    return true;
  });
}

function weeklyReportLinkLabel(title: string) {
  return title.trim().replace(/\r?\n/g, " ").replace(/([\\[\]])/g, "\\$1");
}

function weeklyReportTaskLink(task: WeeklyReportTaskRef | undefined, title: string, appUrl?: string | null) {
  const label = weeklyReportLinkLabel(title);
  if (!label) return "";
  if (!task?.id || !task.workspace_id) return `\`${label.replaceAll("`", "\\`")}\``;
  return `[${label}](${buildTaskOpenUrl(task.workspace_id, task.id, task.kind, appUrl)})`;
}

export function parseWeeklyReportTextParts(value: string): WeeklyReportTextPart[] {
  const parts: WeeklyReportTextPart[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(WEEKLY_REPORT_LINK_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ type: "text", value: value.slice(lastIndex, index) });
    parts.push({
      type: "link",
      href: match[2],
      label: match[1].replace(/\\([\\[\]])/g, "$1"),
    });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < value.length) parts.push({ type: "text", value: value.slice(lastIndex) });
  return parts;
}

export function appendWeeklyReportTaskLines(
  current: string,
  tasks: WeeklyReportSelectedTask[],
  section: WeeklyReportSection,
  labels: Array<Pick<Label, "id" | "name">> = [],
  catalog: WeeklyReportTaskRef[] = [],
  appUrl?: string | null,
) {
  const prefix = section === "completed" ? "完成了" : "计划完成";
  const labelNames = new Map(labels.map((label) => [label.id, label.name.trim()]));
  const tasksById = new Map<string, WeeklyReportTaskRef>();
  for (const item of [...catalog, ...tasks]) tasksById.set(item.id, item);
  const groups = new Map<string, string[]>();

  for (const task of tasks) {
    const title = task.title.trim();
    if (!title) continue;
    const names = task.label_ids
      .map((id) => labelNames.get(id))
      .filter((name): name is string => Boolean(name));
    const groupName = names.length ? names.join(" / ") : "收集箱";
    const lines = groups.get(groupName) ?? [];
    const parent = task.parent_task_id ? tasksById.get(task.parent_task_id) : undefined;
    const parentTitle = parent?.title.trim() ?? "";
    const subject = parentTitle
      ? `${weeklyReportTaskLink(parent, parentTitle, appUrl)} 下的 ${weeklyReportTaskLink(task, title, appUrl)}`
      : weeklyReportTaskLink(task, title, appUrl);
    lines.push(`- ${prefix} ${subject}`);
    groups.set(groupName, lines);
  }

  if (!groups.size) return current;
  const generated = [...groups]
    .map(([groupName, lines]) => `## ${groupName.replaceAll("\n", " ")}\n${lines.join("\n")}`)
    .join("\n\n");
  const base = current.replace(/\s+$/, "");
  return `${base ? `${base}\n\n` : ""}${generated}`;
}

export function weeklyReportPublishError(input: {
  completedText: string;
  nextPlanText: string;
  reflectionText: string;
  visibility: WeeklyReportVisibility;
  userIds: string[];
  groupIds: string[];
}) {
  if (![input.completedText, input.nextPlanText, input.reflectionText].some((value) => value.trim())) {
    return "至少填写一个周报栏目后才能发布";
  }
  if (input.visibility === "users" && input.userIds.length === 0) {
    return "请至少选择一位可见用户";
  }
  if (input.visibility === "groups" && input.groupIds.length === 0) {
    return "请至少选择一个可见用户组";
  }
  return null;
}

export function sortWeeklyReports(reports: WeeklyReport[]) {
  return [...reports].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}
