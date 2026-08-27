import { describe, expect, it } from "vitest";
import type { Connector, Task } from "../types";
import {
  canCompleteYunxiaoExternalTask,
  importYunxiaoWorkitemFromText,
  isYunxiaoQuickCreateConnector,
  isYunxiaoQuickCreateInput,
} from "./yunxiaoQuickCreate";

const quickCreate: Pick<Connector, "id" | "created_by" | "enabled" | "type" | "public_config"> = {
  id: "connector-quick-create",
  created_by: "admin-1",
  enabled: true,
  type: "yunxiao",
  public_config: { kind: "quick_create", organizationId: "org" },
};

const scheduled: Pick<Connector, "id" | "created_by" | "enabled" | "type" | "public_config"> = {
  id: "connector-scheduled",
  created_by: "admin-1",
  enabled: true,
  type: "yunxiao",
  public_config: {
    organizationId: "org",
    projectId: "project-1",
    workitemTypeId: "type-bug",
    workitemTypeName: "缺陷",
    categoryId: "Bug",
    conditions: [],
    orderBy: "gmtModified",
    sort: "desc",
    completedStatusId: "done",
    completedStatusName: "已完成",
  },
};

const task = {
  connector_platform: "yunxiao" as const,
  status: "open" as const,
  created_by: "member-1",
  connector_id: quickCreate.id,
} satisfies Pick<Task, "connector_platform" | "status" | "created_by" | "connector_id">;

describe("yunxiao quick create helpers", () => {
  it("detects a whole-input Yunxiao work item URL", () => {
    expect(isYunxiaoQuickCreateInput("https://devops.aliyun.com/projex/req/HQGS-354")).toBe(true);
    expect(isYunxiaoQuickCreateInput(
      "https://devops.aliyun.com/projex/project/p1/req/abc# 《标题》",
    )).toBe(true);
    expect(isYunxiaoQuickCreateInput("跟进 https://devops.aliyun.com/projex/req/HQGS-354")).toBe(false);
  });

  it("recognizes the quick create connector kind", () => {
    expect(isYunxiaoQuickCreateConnector(quickCreate)).toBe(true);
    expect(isYunxiaoQuickCreateConnector(scheduled)).toBe(false);
  });

  it("lets the paste author or connector creator complete a quick-create task", () => {
    expect(canCompleteYunxiaoExternalTask(task, [quickCreate], "member-1")).toBe(true);
    expect(canCompleteYunxiaoExternalTask(task, [quickCreate], "admin-1")).toBe(true);
    expect(canCompleteYunxiaoExternalTask(task, [quickCreate], "other-user")).toBe(false);
  });

  it("keeps scheduled Yunxiao completion limited to the connector owner who created the task", () => {
    const scheduledTask = { ...task, connector_id: scheduled.id };
    expect(canCompleteYunxiaoExternalTask(scheduledTask, [scheduled], "admin-1")).toBe(false);
    expect(canCompleteYunxiaoExternalTask(
      { ...scheduledTask, created_by: "admin-1" },
      [scheduled],
      "admin-1",
    )).toBe(true);
  });

  it("rejects demo imports without calling the edge function", async () => {
    await expect(importYunxiaoWorkitemFromText(
      "workspace-team",
      "https://devops.aliyun.com/projex/req/HQGS-354",
    )).rejects.toThrow("演示模式无法从云效链接创建待办");
    await expect(importYunxiaoWorkitemFromText("workspace-team", "普通待办")).resolves.toBeNull();
  });
});
