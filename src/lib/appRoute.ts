import type { TaskViewMode } from "../types";

export type AppSmartView = "all" | "today" | "assigned" | "inbox" | "trash";

export type AppRoute =
  | { workspaceId: string; kind: "view"; view: AppSmartView; mode?: TaskViewMode }
  | { workspaceId: string; kind: "tag"; tagId: string; mode?: TaskViewMode }
  | { workspaceId: string; kind: "task"; taskId: string; itemKind: "task" | "note" }
  | { workspaceId: string; kind: "calendar" }
  | { workspaceId: string; kind: "mindmap" };

const SMART_VIEWS = new Set<AppSmartView>(["all", "today", "assigned", "inbox", "trash"]);

function decodeSegment(value: string | undefined) {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseAppRoute(pathname: string): AppRoute | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "workspaces" || segments.length < 2) return null;
  const workspaceId = decodeSegment(segments[1]);
  if (!workspaceId) return null;

  if (segments.length === 2 || (segments.length === 3 && segments[2] === "tasks")) {
    return { workspaceId, kind: "view", view: "all", mode: "list" };
  }
  if (segments.length === 4 && segments[2] === "tasks" && segments[3] === "kanban") {
    return { workspaceId, kind: "view", view: "all", mode: "kanban" };
  }
  if (segments.length === 4 && segments[2] === "tasks" && segments[3] === "timeline") {
    return null;
  }
  if ((segments.length === 4 || segments.length === 5) && segments[2] === "views") {
    const view = decodeSegment(segments[3]) as AppSmartView | null;
    const mode = segments.length === 5 && segments[4] === "kanban" ? "kanban" : "list";
    if (segments.length === 5 && segments[4] !== "kanban") return null;
    return view && SMART_VIEWS.has(view)
      ? { workspaceId, kind: "view", view, mode: view === "trash" ? "list" : mode }
      : null;
  }
  if ((segments.length === 4 || segments.length === 5) && segments[2] === "tags") {
    const tagId = decodeSegment(segments[3]);
    const mode = segments.length === 5 && segments[4] === "kanban" ? "kanban" : "list";
    if (segments.length === 5 && segments[4] !== "kanban") return null;
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
  if (segments.length === 3 && segments[2] === "mindmap") {
    return { workspaceId, kind: "mindmap" };
  }
  return null;
}

export function appRoutePath(route: AppRoute) {
  const base = `/workspaces/${encodeURIComponent(route.workspaceId)}`;
  if (route.kind === "view") {
    const path = route.view === "all" ? `${base}/tasks` : `${base}/views/${route.view}`;
    return route.mode === "kanban" && route.view !== "trash" ? `${path}/kanban` : path;
  }
  if (route.kind === "tag") {
    const path = `${base}/tags/${encodeURIComponent(route.tagId)}`;
    return route.mode === "kanban" ? `${path}/kanban` : path;
  }
  if (route.kind === "task") {
    return `${base}/${route.itemKind === "note" ? "notes" : "tasks"}/${encodeURIComponent(route.taskId)}`;
  }
  return `${base}/${route.kind}`;
}
