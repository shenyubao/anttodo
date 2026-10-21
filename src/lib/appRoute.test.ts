import { describe, expect, it } from "vitest";
import {
  appRoutePath,
  DEFAULT_SMART_VIEW,
  isOverlayAppRoute,
  parseAppRoute,
  parseTaskReturnRoute,
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
    { workspaceId: "workspace-1", kind: "matrix" },
    { workspaceId: "workspace-1", kind: "mindmap" },
    { workspaceId: "workspace-1", kind: "focus" },
    { workspaceId: "workspace-1", kind: "weekly_reports" },
    { workspaceId: "workspace-1", kind: "weekly_reports", page: "new", weekStart: "2026-08-31" },
    {
      workspaceId: "workspace-1",
      kind: "weekly_reports",
      page: "view",
      reportId: "00000000-0000-4000-8000-000000000004",
    },
    {
      workspaceId: "workspace-1",
      kind: "weekly_reports",
      page: "edit",
      reportId: "00000000-0000-4000-8000-000000000004",
    },
    { workspaceId: "workspace-1", kind: "okr" },
    {
      workspaceId: "workspace-team",
      kind: "okr",
      ownerId: "demo-member",
      cycleId: "demo-okr-workspace-team-2026-q3",
    },
    {
      workspaceId: "workspace-1",
      kind: "okr",
      ownerId: "00000000-0000-4000-8000-000000000001",
      cycleId: "00000000-0000-4000-8000-000000000002",
    },
    {
      workspaceId: "workspace-1",
      kind: "okr",
      ownerId: "00000000-0000-4000-8000-000000000001",
      cycleId: "00000000-0000-4000-8000-000000000002",
      target: {
        kind: "key_result",
        id: "00000000-0000-4000-8000-000000000003",
        initialTab: "tasks",
      },
    },
    { workspaceId: "workspace-1", kind: "search" },
  ];

  it.each(routes)("round-trips $kind routes", (route) => {
    expect(parseAppRoute(appRoutePath(route))).toEqual(route);
  });

  it("rejects unrelated and incomplete paths", () => {
    expect(parseAppRoute("/team/acme")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/tags")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/views/unknown")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/views/custom/not-a-uuid")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/users/not-a-uuid")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/views/today/unknown-mode")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/tags/tag-1/unknown-mode")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-team/okr/not-a-user")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-team/okr/demo-user/cycles/not-a-cycle")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-team/okr/demo-user/cycles/demo-okr-workspace-personal-2026-q3")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-team/okr/demo-user/cycles/demo-okr-workspace-team-2026-q5")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/weekly-reports/new/not-a-date")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/weekly-reports/new/2026-99-99")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/weekly-reports/not-a-report")).toBeNull();
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

  it("redirects legacy user-space URLs to the assigned view", () => {
    expect(parseAppRoute("/workspaces/workspace-1/users/00000000-0000-4000-8000-000000000002/kanban")).toEqual({
      workspaceId: "workspace-1",
      kind: "view",
      view: "assigned",
      mode: "kanban",
    });
  });
});

describe("task return routes", () => {
  const workspaceId = "workspace-1";

  it.each([
    { kind: "calendar" },
    { kind: "matrix" },
    { kind: "mindmap" },
    { kind: "focus" },
    { kind: "weekly_reports" },
    { kind: "okr" },
  ] as const)("accepts $kind overlay return routes", ({ kind }) => {
    const route = parseTaskReturnRoute({ workspaceId, kind }, workspaceId);
    expect(route).toEqual({ workspaceId, kind });
    expect(isOverlayAppRoute(route)).toBe(true);
  });

  it("accepts list and kanban view/tag return routes and normalizes trash", () => {
    expect(parseTaskReturnRoute({
      workspaceId,
      kind: "view",
      view: "assigned",
      mode: "list",
    }, workspaceId)).toEqual({
      workspaceId,
      kind: "view",
      view: "assigned",
      mode: "list",
    });
    expect(parseTaskReturnRoute({
      workspaceId,
      kind: "view",
      view: "custom:00000000-0000-4000-8000-000000000001",
      mode: "kanban",
    }, workspaceId)).toEqual({
      workspaceId,
      kind: "view",
      view: "custom:00000000-0000-4000-8000-000000000001",
      mode: "kanban",
    });
    expect(parseTaskReturnRoute({
      workspaceId,
      kind: "view",
      view: "user:00000000-0000-4000-8000-000000000002",
      mode: "list",
    }, workspaceId)).toEqual({
      workspaceId,
      kind: "view",
      view: "assigned",
      mode: "list",
    });
    expect(parseTaskReturnRoute({
      workspaceId,
      kind: "view",
      view: "trash",
      mode: "kanban",
    }, workspaceId)).toEqual({
      workspaceId,
      kind: "view",
      view: "trash",
      mode: "list",
    });
    expect(parseTaskReturnRoute({
      workspaceId,
      kind: "tag",
      tagId: "tag-1",
      mode: "kanban",
    }, workspaceId)).toEqual({
      workspaceId,
      kind: "tag",
      tagId: "tag-1",
      mode: "kanban",
    });
  });

  it("preserves the full OKR target while a linked task is open", () => {
    const target = {
      workspaceId,
      kind: "okr",
      ownerId: "00000000-0000-4000-8000-000000000001",
      cycleId: "00000000-0000-4000-8000-000000000002",
      target: {
        kind: "key_result",
        id: "00000000-0000-4000-8000-000000000003",
        initialTab: "tasks",
      },
    } as const;
    expect(parseTaskReturnRoute(target, workspaceId)).toEqual(target);
  });

  it("rejects invalid or non-return history state", () => {
    expect(parseTaskReturnRoute(null, workspaceId)).toBeNull();
    expect(parseTaskReturnRoute({ workspaceId: "other", kind: "calendar" }, workspaceId)).toBeNull();
    expect(parseTaskReturnRoute({ workspaceId, kind: "search" }, workspaceId)).toBeNull();
    expect(parseTaskReturnRoute({
      workspaceId,
      kind: "task",
      taskId: "task-1",
      itemKind: "task",
    }, workspaceId)).toBeNull();
    expect(parseTaskReturnRoute({
      workspaceId,
      kind: "view",
      view: "today",
      mode: "timeline",
    }, workspaceId)).toBeNull();
    expect(parseTaskReturnRoute({
      workspaceId,
      kind: "view",
      view: "unknown",
      mode: "list",
    }, workspaceId)).toBeNull();
    expect(parseTaskReturnRoute({
      workspaceId,
      kind: "view",
      view: "user:",
      mode: "list",
    }, workspaceId)).toBeNull();
    expect(parseTaskReturnRoute({
      workspaceId,
      kind: "tag",
      tagId: "",
      mode: "list",
    }, workspaceId)).toBeNull();
    expect(isOverlayAppRoute({ workspaceId, kind: "view", view: "all", mode: "list" })).toBe(false);
    expect(isOverlayAppRoute(null)).toBe(false);
  });
});


describe("weekly report group routes", () => {
  it.each([
    { workspaceId: "workspace-1", kind: "weekly_reports" as const, groupId: "dd000000-0000-4000-8000-000000000001" },
    { workspaceId: "workspace-1", kind: "weekly_reports" as const, groupId: "dd000000-0000-4000-8000-000000000001", page: "new" as const, weekStart: "2026-10-12" },
  ])("round-trips group context", (route) => {
    expect(parseAppRoute(appRoutePath(route))).toEqual(route);
    expect(parseTaskReturnRoute(route, "workspace-1")).toEqual(route);
  });
  it("rejects malformed group and creation paths", () => {
    expect(parseAppRoute("/workspaces/w/weekly-reports/groups/invalid")).toBeNull();
    expect(parseAppRoute("/workspaces/w/weekly-reports/groups/dd000000-0000-4000-8000-000000000001/new/2026-99-99")).toBeNull();
  });
});
