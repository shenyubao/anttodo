export type AppSmartView = "all" | "today" | "assigned" | "inbox";

export type AppRoute =
  | { workspaceId: string; kind: "view"; view: AppSmartView }
  | { workspaceId: string; kind: "tag"; tagId: string }
  | { workspaceId: string; kind: "task"; taskId: string; itemKind: "task" | "note" }
  | { workspaceId: string; kind: "calendar" }
  | { workspaceId: string; kind: "mindmap" };

const SMART_VIEWS = new Set<AppSmartView>(["all", "today", "assigned", "inbox"]);

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
    return { workspaceId, kind: "view", view: "all" };
  }
  if (segments.length === 4 && segments[2] === "views") {
    const view = decodeSegment(segments[3]) as AppSmartView | null;
    return view && SMART_VIEWS.has(view) ? { workspaceId, kind: "view", view } : null;
  }
  if (segments.length === 4 && segments[2] === "tags") {
    const tagId = decodeSegment(segments[3]);
    return tagId ? { workspaceId, kind: "tag", tagId } : null;
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
    return route.view === "all" ? `${base}/tasks` : `${base}/views/${route.view}`;
  }
  if (route.kind === "tag") return `${base}/tags/${encodeURIComponent(route.tagId)}`;
  if (route.kind === "task") {
    return `${base}/${route.itemKind === "note" ? "notes" : "tasks"}/${encodeURIComponent(route.taskId)}`;
  }
  return `${base}/${route.kind}`;
}

