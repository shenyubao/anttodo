import { describe, expect, it } from "vitest";
import { createDemoBundle } from "./demo";
import {
  canMemberBeAssignedToTask,
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

  it("limits candidates to the manage user group when view stays open", () => {
    const bundle = createDemoBundle();
    const task = bundle.tasks.find((item) => item.id === "task-1")!;
    const label = bundle.labels.find((item) => item.id === "product")!;
    label.view_scope = "all";
    label.manage_scope = "groups";
    bundle.labelUserAcls = [];
    bundle.labelGroupAcls = [{
      label_id: "product",
      workspace_id: "workspace-team",
      group_id: "group-client",
      permission: "edit",
    }];
    // urgent also uses manage users with open view; keep it from restricting.
    const urgent = bundle.labels.find((item) => item.id === "urgent")!;
    urgent.manage_scope = "all";
    bundle.members.push({
      workspace_id: task.workspace_id,
      user_id: "demo-outsider",
      role: "member",
      profile: {
        id: "demo-outsider",
        display_name: "路人",
        avatar_url: null,
      },
    });

    const outsider = bundle.members.find((item) => item.user_id === "demo-outsider")!;
    const member = bundle.members.find((item) => item.user_id === "demo-member")!;
    expect(canMemberViewTask(outsider, task, bundle)).toBe(true);
    expect(canMemberBeAssignedToTask(outsider, task, bundle)).toBe(false);
    expect(canMemberBeAssignedToTask(member, task, bundle)).toBe(true);
    expect(
      getAssignableMembers(bundle, task, "demo-user").map((item) => item.user_id),
    ).toEqual(["demo-user", "demo-member"]);
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

  it("hides another member private label tasks from workspace admins", () => {
    const bundle = createDemoBundle();
    const owner = bundle.members.find((item) => item.user_id === "demo-user")!;
    const admin: typeof owner = {
      ...owner,
      user_id: "demo-admin",
      role: "admin",
      profile: { id: "demo-admin", display_name: "管理员", avatar_url: null },
    };
    bundle.members.push(admin);
    bundle.labels.push({
      id: "member-private",
      workspace_id: "workspace-team",
      parent_id: null,
      name: "个人备忘",
      color: "#b8bdc8",
      kind: "private",
      view_scope: "users",
      manage_scope: "users",
      inherit_permissions: false,
      position: 9,
      created_by: "demo-member",
    });
    const privateTask = {
      ...bundle.tasks[0]!,
      id: "task-private",
      label_ids: ["member-private"],
      created_by: "demo-member",
      assignee_id: "demo-member",
    };
    bundle.tasks.push(privateTask);

    expect(canMemberViewTask(owner, privateTask, bundle)).toBe(false);
    expect(canMemberViewTask(admin, privateTask, bundle)).toBe(false);
    expect(
      canMemberViewTask(
        bundle.members.find((item) => item.user_id === "demo-member")!,
        privateTask,
        bundle,
      ),
    ).toBe(true);
    expect(canMemberViewTask(owner, bundle.tasks[0]!, bundle)).toBe(true);
  });
});
