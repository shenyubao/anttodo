import { describe, expect, it } from "vitest";
import {
  DEFAULT_LABEL_COLOR,
  hasExplicitLabelColor,
  LABEL_COLORS,
  newLabelAccessDefaults,
} from "./labels";
import type { Label } from "../types";

const labels: Label[] = [
  {
    id: "team-parent",
    workspace_id: "workspace",
    parent_id: null,
    name: "团队父标签",
    color: DEFAULT_LABEL_COLOR,
    kind: "team",
    view_scope: "users",
    manage_scope: "groups",
    inherit_permissions: false,
    position: 0,
    created_by: "user",
  },
  {
    id: "private-parent",
    workspace_id: "workspace",
    parent_id: null,
    name: "私人父标签",
    color: DEFAULT_LABEL_COLOR,
    kind: "private",
    view_scope: "all",
    manage_scope: "users",
    inherit_permissions: false,
    position: 1,
    created_by: "user",
  },
];

describe("label colors", () => {
  it("treats the default task-label gray as no explicit label color", () => {
    expect(hasExplicitLabelColor(DEFAULT_LABEL_COLOR)).toBe(false);
    expect(hasExplicitLabelColor(DEFAULT_LABEL_COLOR.toUpperCase())).toBe(false);
  });

  it("keeps gray out of the user-selectable palette", () => {
    expect(LABEL_COLORS).not.toContain(DEFAULT_LABEL_COLOR);
    expect(LABEL_COLORS.every(hasExplicitLabelColor)).toBe(true);
  });
});

describe("new label access defaults", () => {
  it("keeps the top-level defaults when there is no parent", () => {
    expect(newLabelAccessDefaults(labels, null)).toEqual({
      kind: "private",
      viewScope: "all",
      manageScope: "users",
    });
  });

  it("uses a team parent's type and inherits its access settings", () => {
    expect(newLabelAccessDefaults(labels, "team-parent")).toEqual({
      kind: "team",
      viewScope: "inherit",
      manageScope: "inherit",
    });
  });

  it("uses a private parent's type", () => {
    expect(newLabelAccessDefaults(labels, "private-parent")).toEqual({
      kind: "private",
      viewScope: "inherit",
      manageScope: "inherit",
    });
  });
});
