import { describe, expect, it } from "vitest";
import { appRoutePath, parseAppRoute, type AppRoute } from "./appRoute";

describe("application routes", () => {
  const routes: AppRoute[] = [
    { workspaceId: "workspace-1", kind: "view", view: "all" },
    { workspaceId: "workspace-1", kind: "view", view: "today" },
    { workspaceId: "workspace-1", kind: "tag", tagId: "tag/研发" },
    { workspaceId: "workspace-1", kind: "task", taskId: "task-1", itemKind: "task" },
    { workspaceId: "workspace-1", kind: "task", taskId: "note-1", itemKind: "note" },
    { workspaceId: "workspace-1", kind: "calendar" },
    { workspaceId: "workspace-1", kind: "mindmap" },
  ];

  it.each(routes)("round-trips $kind routes", (route) => {
    expect(parseAppRoute(appRoutePath(route))).toEqual(route);
  });

  it("rejects unrelated and incomplete paths", () => {
    expect(parseAppRoute("/team/acme")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/tags")).toBeNull();
    expect(parseAppRoute("/workspaces/workspace-1/views/unknown")).toBeNull();
  });
});
