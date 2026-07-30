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
    bundle.labelAcls = [];
    expect(canMemberViewTask(member, restrictedTask, bundle)).toBe(false);
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
