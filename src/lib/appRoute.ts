import type { TaskViewMode } from "../types";

export type SystemSmartView = "all" | "today" | "week" | "assigned" | "watching" | "inbox" | "trash";
export type AppSmartView = SystemSmartView | `custom:${string}`;

export const DEFAULT_SMART_VIEW: AppSmartView = "assigned";

export type AppRoute =
  | { workspaceId: string; kind: "view"; view: AppSmartView; mode?: TaskViewMode }
  | { workspaceId: string; kind: "tag"; tagId: string; mode?: TaskViewMode }
  | { workspaceId: string; kind: "task"; taskId: string; itemKind: "task" | "note" }
  | { workspaceId: string; kind: "calendar" }
  | { workspaceId: string; kind: "mindmap" }
  | { workspaceId: string; kind: "focus" };

const SMART_VIEWS = new Set<SystemSmartView>(["all", "today", "week", "assigned", "watching", "inbox", "trash"]);
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (segments.length === 3 && segments[2] === "mindmap") {
    return { workspaceId, kind: "mindmap" };
  }
  if (segments.length === 3 && segments[2] === "focus") {
    return { workspaceId, kind: "focus" };
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
  return `${base}/${route.kind}`;
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
  if (window.location.protocol === "file:" && import.meta.env.VITE_PUBLIC_APP_URL) {
    url = new URL(path, import.meta.env.VITE_PUBLIC_APP_URL).toString();
  }
  return url;
}
