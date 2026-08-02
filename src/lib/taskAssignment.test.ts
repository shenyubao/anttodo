import { describe, expect, it } from "vitest";
import { createDemoBundle } from "./demo";
import {
  canMemberViewTask,
  getAssignableMembers,
} from "./taskAssignment";

describe("task assignment candidates", () => {
  it("keeps the current user first and sorts other visible members by name", () => {
    const bundle = createDemoBundle();
    const task = bundle.tasks.find((item) => item.id === "task-1")!;
    bundle.members.push({
      workspace_id: task.workspace_id,
      user_id: "demo-another",
      role: "member",
      profile: {
        id: "demo-another",
        display_name: "阿布",
        avatar_url: null,
      },
    });

    expect(
      getAssignableMembers(bundle, task, "demo-user").map(
        (member) => member.user_id,
      ),
    ).toEqual(["demo-user", "demo-another", "demo-member"]);
  });

  it("uses the strict intersection of inherited label permissions", () => {
    const bundle = createDemoBundle();
    const member = bundle.members.find(
      (item) => item.user_id === "demo-member",
    )!;
    const restrictedTask = bundle.tasks.find(
      (item) => item.id === "task-3",
    )!;

    expect(canMemberViewTask(member, restrictedTask, bundle)).toBe(true);
    bundle.labelUserAcls = [];
    expect(canMemberViewTask(member, restrictedTask, bundle)).toBe(false);
  });

  it("uses the parent result when both child scopes inherit", () => {
    const bundle = createDemoBundle();
    const member = bundle.members.find((item) => item.user_id === "demo-member")!;
    const task = bundle.tasks.find((item) => item.id === "task-2")!;
    const child = bundle.labels.find((item) => item.id === "frontend")!;
    const parent = bundle.labels.find((item) => item.id === "product")!;
    child.view_scope = "inherit";
    child.manage_scope = "inherit";

    expect(canMemberViewTask(member, task, bundle)).toBe(true);
    parent.view_scope = "users";
    bundle.labelUserAcls = [];
    expect(canMemberViewTask(member, task, bundle)).toBe(false);
  });

  it("honors server-provided candidate ids", () => {
    const bundle = createDemoBundle();
    const task = bundle.tasks.find((item) => item.id === "task-1")!;

    expect(
      getAssignableMembers(
        bundle,
        task,
        "demo-user",
        ["demo-member"],
      ).map((member) => member.user_id),
    ).toEqual(["demo-member"]);
  });
});
