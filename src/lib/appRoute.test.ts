import { describe, expect, it } from "vitest";
import {
  appRoutePath,
  DEFAULT_SMART_VIEW,
  parseAppRoute,
  type AppRoute,
} from "./appRoute";

describe("application routes", () => {
  const routes: AppRoute[] = [
    { workspaceId: "workspace-1", kind: "view", view: "all", mode: "list" },
    { workspaceId: "workspace-1", kind: "view", view: "all", mode: "kanban" },
    { workspaceId: "workspace-1", kind: "view", view: "all", mode: "timeline" },
    { workspaceId: "workspace-1", kind: "view", view: "assigned", mode: "list" },
    { workspaceId: "workspace-1", kind: "view", view: "assigned", mode: "kanban" },
    { workspaceId: "workspace-1", kind: "view", view: "assigned", mode: "timeline" },
    { workspaceId: "workspace-1", kind: "view", view: "watching", mode: "list" },
    { workspaceId: "workspace-1", kind: "view", view: "watching", mode: "kanban" },
    { workspaceId: "workspace-1", kind: "view", view: "today", mode: "list" },
    { workspaceId: "workspace-1", kind: "view", view: "today", mode: "kanban" },
    { workspaceId: "workspace-1", kind: "view", view: "today", mode: "timeline" },
    { workspaceId: "workspace-1", kind: "view", view: "week", mode: "list" },
    { workspaceId: "workspace-1", kind: "view", view: "week", mode: "kanban" },
    { workspaceId: "workspace-1", kind: "view", view: "week", mode: "timeline" },
    { workspaceId: "workspace-1", kind: "view", view: "trash", mode: "list" },
    { workspaceId: "workspace-1", kind: "view", view: "custom:00000000-0000-4000-8000-000000000001", mode: "list" },
    { workspaceId: "workspace-1", kind: "view", view: "custom:00000000-0000-4000-8000-000000000001", mode: "kanban" },
    { workspaceId: "workspace-1", kind: "tag", tagId: "tag/研发", mode: "list" },
    { workspaceId: "workspace-1", kind: "tag", tagId: "tag/研发", mode: "kanban" },
    { workspaceId: "workspace-1", kind: "tag", tagId: "tag/研发", mode: "timeline" },
    { workspaceId: "workspace-1", kind: "task", taskId: "task-1", itemKind: "task" },
    { workspaceId: "workspace-1", kind: "task", taskId: "note-1", itemKind: "note" },
    { workspaceId: "workspace-1", kind: "calendar" },
    { workspaceId: "workspace-1", kind: "mindmap" },
    { workspaceId: "workspace-1", kind: "focus" },
  ];

  it.each(routes)("round-trips $kind routes", (route) => {
    expect(parseAppRoute(appRoutePath(route))).toEqual(route);
  });

  it("rejects unrelated and incomplete paths", () => {
    expect(parseAppRoute("/team/acme")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/tags")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/views/unknown")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/views/custom/not-a-uuid")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/views/today/unknown-mode")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/tags/tag-1/unknown-mode")).toBeNull();
  });

  it("keeps legacy task-list URLs in list mode and normalizes trash", () => {
    expect(parseAppRoute("/workspaces/workspace-1/tasks")).toEqual({
      workspaceId: "workspace-1",
      kind: "view",
      view: "all",
      mode: "list",
    });
    expect(parseAppRoute("/workspaces/workspace-1")).toEqual({
      workspaceId: "workspace-1",
      kind: "view",
      view: DEFAULT_SMART_VIEW,
      mode: "list",
    });
    expect(parseAppRoute("/workspaces/workspace-1/views/trash/kanban")).toEqual({
      workspaceId: "workspace-1",
      kind: "view",
      view: "trash",
      mode: "list",
    });
    expect(parseAppRoute("/workspaces/workspace-1/views/trash/timeline")).toEqual({
      workspaceId: "workspace-1",
      kind: "view",
      view: "trash",
      mode: "list",
    });
  });

  it("parses timeline view modes", () => {
    expect(parseAppRoute("/workspaces/workspace-1/tasks/timeline")).toEqual({
      workspaceId: "workspace-1",
      kind: "view",
      view: "all",
      mode: "timeline",
    });
    expect(parseAppRoute("/workspaces/workspace-1/views/today/timeline")).toEqual({
      workspaceId: "workspace-1",
      kind: "view",
      view: "today",
      mode: "timeline",
    });
    expect(parseAppRoute("/workspaces/workspace-1/views/week")).toEqual({
      workspaceId: "workspace-1",
      kind: "view",
      view: "week",
      mode: "list",
    });
    expect(appRoutePath({
      workspaceId: "workspace-1",
      kind: "view",
      view: "all",
      mode: "timeline",
    })).toBe("/workspaces/workspace-1/tasks/timeline");
  });
});
