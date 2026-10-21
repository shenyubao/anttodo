import type { TaskViewMode } from "../types";
import { currentAppUrl } from "./instanceConfig";

export type SystemSmartView = "all" | "today" | "week" | "assigned" | "watching" | "inbox" | "trash";
export type AppSmartView = SystemSmartView | `custom:${string}`;

export const DEFAULT_SMART_VIEW: AppSmartView = "assigned";

export type AppRoute =
  | { workspaceId: string; kind: "view"; view: AppSmartView; mode?: TaskViewMode }
  | { workspaceId: string; kind: "tag"; tagId: string; mode?: TaskViewMode }
  | { workspaceId: string; kind: "task"; taskId: string; itemKind: "task" | "note" }
  | { workspaceId: string; kind: "calendar" }
  | { workspaceId: string; kind: "matrix" }
  | { workspaceId: string; kind: "mindmap" }
  | { workspaceId: string; kind: "focus" }
  | { workspaceId: string; kind: "weekly_reports"; groupId?: string }
  | { workspaceId: string; kind: "weekly_reports"; groupId?: string; page: "new"; weekStart: string }
  | { workspaceId: string; kind: "weekly_reports"; page: "view" | "edit"; reportId: string }
  | {
      workspaceId: string;
      kind: "okr";
      ownerId?: string;
      cycleId?: string;
      target?: { kind: "objective" | "key_result"; id: string; initialTab?: "tasks" | "notes" };
    }
  | { workspaceId: string; kind: "search" };

export type OverlayAppRoute = Extract<AppRoute, { kind: "calendar" | "matrix" | "mindmap" | "focus" | "weekly_reports" | "okr" }>;

const SMART_VIEWS = new Set<SystemSmartView>(["all", "today", "week", "assigned", "watching", "inbox", "trash"]);
const TASK_RETURN_LIST_MODES = new Set<TaskViewMode>(["list", "kanban"]);
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_SEGMENT = /^\d{4}-\d{2}-\d{2}$/;

function isValidUserRouteId(value: string) {
  return UUID_SEGMENT.test(value) || value === "demo-user" || value === "demo-member";
}

function isValidDateSegment(value: string) {
  if (!DATE_SEGMENT.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function decodeSegment(value: string | undefined) {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function parseModeSegment(segment: string | undefined): TaskViewMode | null {
  if (!segment) return "list";
  if (segment === "kanban" || segment === "timeline") return segment;
  return null;
}

function modePathSegment(mode: TaskViewMode | undefined) {
  return mode && mode !== "list" ? `/${mode}` : "";
}

export function parseAppRoute(pathname: string): AppRoute | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "workspaces" || segments.length < 2) return null;
  const workspaceId = decodeSegment(segments[1]);
  if (!workspaceId) return null;

  if (segments.length === 2) {
    return { workspaceId, kind: "view", view: DEFAULT_SMART_VIEW, mode: "list" };
  }
  if (segments.length === 3 && segments[2] === "tasks") {
    return { workspaceId, kind: "view", view: "all", mode: "list" };
  }
  if (
    segments.length === 4
    && segments[2] === "tasks"
    && (segments[3] === "kanban" || segments[3] === "timeline")
  ) {
    return { workspaceId, kind: "view", view: "all", mode: segments[3] };
  }
  if ((segments.length === 4 || segments.length === 5) && segments[2] === "views" && segments[3] !== "custom") {
    const view = decodeSegment(segments[3]) as SystemSmartView | null;
    const mode = parseModeSegment(segments.length === 5 ? segments[4] : undefined);
    if (!mode) return null;
    return view && SMART_VIEWS.has(view)
      ? { workspaceId, kind: "view", view, mode: view === "trash" ? "list" : mode }
      : null;
  }
  if ((segments.length === 5 || segments.length === 6) && segments[2] === "views" && segments[3] === "custom") {
    const customViewId = decodeSegment(segments[4]);
    const mode = parseModeSegment(segments.length === 6 ? segments[5] : undefined);
    if (!customViewId || !UUID_SEGMENT.test(customViewId) || !mode) return null;
    return { workspaceId, kind: "view", view: `custom:${customViewId}`, mode };
  }
  if ((segments.length === 4 || segments.length === 5) && segments[2] === "users") {
    const userId = decodeSegment(segments[3]);
    const mode = parseModeSegment(segments.length === 5 ? segments[4] : undefined);
    if (!userId || !isValidUserRouteId(userId) || !mode) return null;
    return { workspaceId, kind: "view", view: "assigned", mode };
  }
  if ((segments.length === 4 || segments.length === 5) && segments[2] === "tags") {
    const tagId = decodeSegment(segments[3]);
    const mode = parseModeSegment(segments.length === 5 ? segments[4] : undefined);
    if (!mode) return null;
    return tagId ? { workspaceId, kind: "tag", tagId, mode } : null;
  }
  if (segments.length === 4 && (segments[2] === "tasks" || segments[2] === "notes")) {
    const taskId = decodeSegment(segments[3]);
    return taskId
      ? { workspaceId, kind: "task", taskId, itemKind: segments[2] === "notes" ? "note" : "task" }
      : null;
  }
  if (segments.length === 3 && segments[2] === "calendar") {
    return { workspaceId, kind: "calendar" };
  }
  if (segments.length === 3 && segments[2] === "matrix") {
    return { workspaceId, kind: "matrix" };
  }
  if (segments.length === 3 && segments[2] === "mindmap") {
    return { workspaceId, kind: "mindmap" };
  }
  if (segments.length === 3 && segments[2] === "focus") {
    return { workspaceId, kind: "focus" };
  }
  if (segments[2] === "weekly-reports") {
    if (segments.length === 3) return { workspaceId, kind: "weekly_reports" };
    if (segments[3] === "groups") {
      const groupId = decodeSegment(segments[4]);
      if (!groupId || (!UUID_SEGMENT.test(groupId) && !groupId.startsWith("demo-weekly-group-"))) return null;
      if (segments.length === 5) return { workspaceId, kind: "weekly_reports", groupId };
      const weekStart = decodeSegment(segments[6]);
      return segments.length === 7 && segments[5] === "new" && weekStart && isValidDateSegment(weekStart)
        ? { workspaceId, kind: "weekly_reports", groupId, page: "new", weekStart } : null;
    }
    if (segments.length === 5 && segments[3] === "new") {
      const weekStart = decodeSegment(segments[4]);
      return weekStart && isValidDateSegment(weekStart)
        ? { workspaceId, kind: "weekly_reports", page: "new", weekStart }
        : null;
    }
    const reportId = decodeSegment(segments[3]);
    const demoReport = reportId?.startsWith("demo-weekly-report-");
    if (!reportId || (!UUID_SEGMENT.test(reportId) && !demoReport)) return null;
    if (segments.length === 4) {
      return { workspaceId, kind: "weekly_reports", page: "view", reportId };
    }
    if (segments.length === 5 && segments[4] === "edit") {
      return { workspaceId, kind: "weekly_reports", page: "edit", reportId };
    }
    return null;
  }
  if (segments[2] === "okr") {
    if (segments.length === 3) return { workspaceId, kind: "okr" };
    const ownerId = decodeSegment(segments[3]);
    const demoOwner = ownerId === "demo-user" || ownerId === "demo-member";
    if (!ownerId || (!UUID_SEGMENT.test(ownerId) && !demoOwner)) return null;
    if (segments.length === 4) return { workspaceId, kind: "okr", ownerId };
    if (segments.length === 6 && segments[4] === "cycles") {
      const cycleId = decodeSegment(segments[5]);
      const demoCyclePrefix = `demo-okr-${workspaceId}-`;
      const demoCycle = demoOwner && cycleId?.startsWith(demoCyclePrefix)
        && /^\d{4}-q[1-4]$/.test(cycleId.slice(demoCyclePrefix.length));
      return cycleId && (UUID_SEGMENT.test(cycleId) || demoCycle)
        ? { workspaceId, kind: "okr", ownerId, cycleId }
        : null;
    }
    if ((segments.length === 8 || (segments.length === 9 && segments[8] === "notes")) && segments[4] === "cycles") {
      const cycleId = decodeSegment(segments[5]);
      const targetId = decodeSegment(segments[7]);
      const demoCyclePrefix = `demo-okr-${workspaceId}-`;
      const demoCycle = demoOwner && cycleId?.startsWith(demoCyclePrefix)
        && /^\d{4}-q[1-4]$/.test(cycleId.slice(demoCyclePrefix.length));
      const cycleValid = Boolean(cycleId && (UUID_SEGMENT.test(cycleId) || demoCycle));
      const demoTarget = demoOwner && targetId?.startsWith(`${cycleId}-${ownerId}-o`);
      const targetValid = Boolean(targetId && (UUID_SEGMENT.test(targetId) || demoTarget));
      const targetKind = segments[6] === "objectives"
        ? "objective"
        : segments[6] === "key-results"
          ? "key_result"
          : null;
      return cycleValid && targetValid && targetKind
        ? {
            workspaceId,
            kind: "okr",
            ownerId,
            cycleId: cycleId!,
            target: { kind: targetKind, id: targetId!, initialTab: segments[8] === "notes" ? "notes" : "tasks" },
          }
        : null;
    }
    return null;
  }
  if (segments.length === 3 && segments[2] === "search") {
    return { workspaceId, kind: "search" };
  }
  return null;
}

export function appRoutePath(route: AppRoute) {
  const base = `/workspaces/${encodeURIComponent(route.workspaceId)}`;
  if (route.kind === "view") {
    const path = route.view === "all"
      ? `${base}/tasks`
      : route.view.startsWith("custom:")
        ? `${base}/views/custom/${encodeURIComponent(route.view.slice("custom:".length))}`
        : `${base}/views/${route.view}`;
    if (route.view === "trash") return path;
    return `${path}${modePathSegment(route.mode)}`;
  }
  if (route.kind === "tag") {
    const path = `${base}/tags/${encodeURIComponent(route.tagId)}`;
    return `${path}${modePathSegment(route.mode)}`;
  }
  if (route.kind === "task") {
    return `${base}/${route.itemKind === "note" ? "notes" : "tasks"}/${encodeURIComponent(route.taskId)}`;
  }
  if (route.kind === "okr") {
    if (!route.ownerId) return `${base}/okr`;
    const ownerPath = `${base}/okr/${encodeURIComponent(route.ownerId)}`;
    if (!route.cycleId) return ownerPath;
    const cyclePath = `${ownerPath}/cycles/${encodeURIComponent(route.cycleId)}`;
    if (!route.target) return cyclePath;
    return `${cyclePath}/${route.target.kind === "objective" ? "objectives" : "key-results"}/${encodeURIComponent(route.target.id)}${route.target.initialTab === "notes" ? "/notes" : ""}`;
  }
  if (route.kind === "weekly_reports") {
    const root = `${base}/weekly-reports`;
    const groupRoot = "groupId" in route && route.groupId ? `${root}/groups/${encodeURIComponent(route.groupId)}` : root;
    if (!("page" in route)) return groupRoot;
    if (route.page === "new") return `${groupRoot}/new/${encodeURIComponent(route.weekStart)}`;
    const reportPath = `${root}/${encodeURIComponent(route.reportId)}`;
    return route.page === "edit" ? `${reportPath}/edit` : reportPath;
  }
  return `${base}/${route.kind}`;
}

export function isOverlayAppRoute(route: AppRoute | null | undefined): route is OverlayAppRoute {
  return route?.kind === "calendar" || route?.kind === "matrix" || route?.kind === "mindmap" || route?.kind === "focus" || route?.kind === "weekly_reports" || route?.kind === "okr";
}

export function parseTaskReturnRoute(value: unknown, workspaceId: string): AppRoute | null {
  if (!value || typeof value !== "object") return null;
  const route = value as {
    workspaceId?: unknown;
    kind?: unknown;
    view?: unknown;
    tagId?: unknown;
    groupId?: unknown;
    page?: unknown;
    reportId?: unknown;
    weekStart?: unknown;
    mode?: unknown;
    ownerId?: unknown;
    cycleId?: unknown;
    target?: unknown;
  };
  if (route.workspaceId !== workspaceId || typeof route.kind !== "string") return null;
  if (route.kind === "calendar" || route.kind === "matrix" || route.kind === "mindmap" || route.kind === "focus" || route.kind === "weekly_reports" || route.kind === "okr") {
    if (route.kind === "okr") {
      const ownerId = typeof route.ownerId === "string" ? route.ownerId : undefined;
      const cycleId = typeof route.cycleId === "string" ? route.cycleId : undefined;
      const rawTarget = route.target && typeof route.target === "object"
        ? route.target as { kind?: unknown; id?: unknown; initialTab?: unknown }
        : null;
      const target: Extract<AppRoute, { kind: "okr" }>["target"] = rawTarget
        && (rawTarget.kind === "objective" || rawTarget.kind === "key_result")
        && typeof rawTarget.id === "string"
        ? { kind: rawTarget.kind, id: rawTarget.id, initialTab: rawTarget.initialTab === "notes" ? "notes" as const : "tasks" as const }
        : undefined;
      return { workspaceId, kind: "okr", ...(ownerId ? { ownerId } : {}), ...(cycleId ? { cycleId } : {}), ...(target ? { target } : {}) };
    }
    if (route.kind === "weekly_reports") {
      const groupId = typeof route.groupId === "string" ? route.groupId : undefined;
      const group = groupId ? { groupId } : {};
      if (route.page === "new") {
        return typeof route.weekStart === "string"
          ? parseAppRoute(appRoutePath({ workspaceId, kind: "weekly_reports", ...group, page: "new", weekStart: route.weekStart })) : null;
      }
      if (route.page === "view" || route.page === "edit") {
        return typeof route.reportId === "string"
          ? parseAppRoute(appRoutePath({ workspaceId, kind: "weekly_reports", page: route.page, reportId: route.reportId })) : null;
      }
      return parseAppRoute(appRoutePath({ workspaceId, kind: "weekly_reports", ...group }));
    }
    return { workspaceId, kind: route.kind };
  }
  if (route.kind === "view") {
    if (typeof route.view !== "string") return null;
    const userViewId = route.view.startsWith("user:")
      ? route.view.slice("user:".length)
      : null;
    if (
      !SMART_VIEWS.has(route.view as SystemSmartView)
      && !route.view.startsWith("custom:")
      && !(userViewId && isValidUserRouteId(userViewId))
    ) {
      return null;
    }
    if (!TASK_RETURN_LIST_MODES.has(route.mode as TaskViewMode)) return null;
    const view = userViewId ? "assigned" : route.view as AppSmartView;
    const mode = route.mode as "list" | "kanban";
    return view === "trash"
      ? { workspaceId, kind: "view", view, mode: "list" }
      : { workspaceId, kind: "view", view, mode };
  }
  if (route.kind === "tag") {
    if (typeof route.tagId !== "string" || !route.tagId) return null;
    if (!TASK_RETURN_LIST_MODES.has(route.mode as TaskViewMode)) return null;
    return { workspaceId, kind: "tag", tagId: route.tagId, mode: route.mode as "list" | "kanban" };
  }
  return null;
}

/** Absolute URL for sharing a task/note; uses public app origin in the Electron file:// shell. */
export function taskShareUrl(
  workspaceId: string,
  task: { id: string; kind: "todo" | "note" | string },
) {
  const path = appRoutePath({
    workspaceId,
    kind: "task",
    taskId: task.id,
    itemKind: task.kind === "note" ? "note" : "task",
  });
  let url = new URL(path, window.location.origin).toString();
  if (window.location.protocol === "file:") {
    url = new URL(path, currentAppUrl()).toString();
  }
  return url;
}
