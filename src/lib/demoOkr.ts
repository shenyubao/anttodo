import { addQuarters, endOfQuarter, format, startOfQuarter } from "date-fns";
import type { OkrCycle, OkrKeyResult, OkrObjective, OkrSet } from "../types";

type KeyResultExample = Pick<OkrKeyResult, "title" | "target_value" | "current_value">
  & Partial<Pick<OkrKeyResult, "start_value" | "metric_unit" | "custom_unit" | "progress_status">>;

type ObjectiveExample = {
  title: string;
  note: string;
  keyResults: KeyResultExample[];
};

const currentObjectives: ObjectiveExample[] = [
  {
    title: "让 AntTodo 成为团队每天信赖的协作工具",
    note: "围绕 Web、macOS 和 iOS 的核心任务流程，提升跨端体验与交付质量。",
    keyResults: [
      { title: "核心任务流程验收通过率达到 100%", target_value: 100, current_value: 80 },
      { title: "完成 10 个团队的产品试用与反馈回访", target_value: 10, current_value: 6, metric_unit: "custom", custom_unit: "个团队", progress_status: "risk" },
    ],
  },
  {
    title: "建立稳定、可衡量的产品交付节奏",
    note: "将质量保障融入每周交付，持续降低团队使用成本。",
    keyResults: [
      { title: "完成 8 次每周迭代发布", target_value: 8, current_value: 5, metric_unit: "custom", custom_unit: "次" },
      { title: "将高优先级缺陷从 20 个降至 4 个", start_value: 20, target_value: 4, current_value: 14, metric_unit: "custom", custom_unit: "个", progress_status: "delayed" },
    ],
  },
];

const memberObjective: ObjectiveExample = {
  title: "打造清晰顺畅的跨端任务体验",
  note: "聚焦任务详情、标签导航和移动端操作，让新用户快速上手。",
  keyResults: [
    { title: "完成 12 项核心交互体验优化", target_value: 12, current_value: 9, metric_unit: "custom", custom_unit: "项" },
    { title: "新用户首次创建任务成功率达到 95%", start_value: 60, target_value: 95, current_value: 88 },
  ],
};

// Keep fixtures outside React Query: demo content must never enter the persisted
// cache used by signed-in Web, Electron, and iOS clients.
export function createDemoOkrData(workspaceId = "workspace-team", now = new Date()): {
  cycles: OkrCycle[];
  sets: OkrSet[];
} {
  const createdAt = now.toISOString();
  const userId = "demo-user";
  const owners = workspaceId === "workspace-team" ? [userId, "demo-member"] : [userId];
  const cycles: OkrCycle[] = [1, 0, -1].map((offset, position) => {
    const start = startOfQuarter(addQuarters(now, offset));
    const quarter = `${start.getFullYear()}-q${Math.floor(start.getMonth() / 3) + 1}`;
    return {
      id: `demo-okr-${workspaceId}-${quarter}`,
      workspace_id: workspaceId,
      name: `${start.getFullYear()} 年 Q${Math.floor(start.getMonth() / 3) + 1}`,
      starts_on: format(start, "yyyy-MM-dd"),
      ends_on: format(endOfQuarter(start), "yyyy-MM-dd"),
      status: offset > 0 ? "draft" : offset < 0 ? "closed" : "active",
      position,
      created_by: userId,
      created_at: createdAt,
      updated_at: createdAt,
    };
  });

  const sets = cycles.flatMap((cycle) => owners.map((ownerId): OkrSet => {
    const setId = `${cycle.id}-${ownerId}`;
    const publishedAt = cycle.status === "draft" ? null : `${cycle.starts_on}T00:00:00.000Z`;
    const examples: ObjectiveExample[] = cycle.status === "active"
      ? ownerId === userId ? currentObjectives : [memberObjective]
      : cycle.status === "closed" ? [{
        title: ownerId === userId ? "完成 AntTodo 核心能力建设" : "交付第一版任务协作体验",
        note: "上一周期复盘：核心能力已交付，经验与反馈用于下一轮迭代。",
        keyResults: [
          { title: "完成 3 个客户端的核心流程验收", target_value: 3, current_value: 3, metric_unit: "custom", custom_unit: "个客户端" },
          { title: "关键功能测试覆盖率达到 90%", target_value: 90, current_value: 90 },
        ],
      }] : [{
        title: ownerId === userId ? "推动团队协作规模化落地" : "提升新团队的首次使用体验",
        note: "下一周期规划示例：明确目标与衡量方式，等待周期启动。",
        keyResults: [
          { title: "支持 30 个团队完成协作流程搭建", target_value: 30, current_value: null, metric_unit: "custom", custom_unit: "个团队" },
          { title: "团队新成员引导完成率达到 90%", target_value: 90, current_value: null },
        ],
      }];

    return {
      id: setId,
      workspace_id: workspaceId,
      cycle_id: cycle.id,
      owner_id: ownerId,
      visibility: "workspace",
      published_version: publishedAt ? 1 : 0,
      published_at: publishedAt,
      created_at: publishedAt ?? createdAt,
      updated_at: createdAt,
      user_acl_ids: [],
      group_acl_ids: [],
      objectives: examples.map((example, position): OkrObjective => {
        const objectiveId = `${setId}-o${position + 1}`;
        return {
          id: objectiveId,
          set_id: setId,
          workspace_id: workspaceId,
          title: example.title,
          note: example.note,
          position,
          visibility: "inherit",
          progress_mode: "key_results",
          status_mode: "manual",
          progress_status: cycle.status === "draft" ? "none" : position === 1 ? "risk" : "normal",
          start_value: 0,
          target_value: 100,
          current_value: null,
          metric_unit: "percent",
          custom_unit: null,
          score: cycle.status === "closed" ? 1 : cycle.status === "active" ? 0.7 : null,
          published_at: publishedAt,
          created_at: publishedAt ?? createdAt,
          updated_at: createdAt,
          responsible_ids: [ownerId],
          user_acl_ids: [],
          group_acl_ids: [],
          alignment_target_id: cycle.status === "active" && ownerId !== userId
            ? `${cycle.id}-${userId}-o1` : null,
          key_results: example.keyResults.map((kr, index): OkrKeyResult => ({
            id: `${objectiveId}-kr${index + 1}`,
            objective_id: objectiveId,
            workspace_id: workspaceId,
            title: kr.title,
            position: index,
            visibility: "inherit",
            status_mode: "manual",
            progress_status: cycle.status === "draft" ? "none" : kr.progress_status ?? "normal",
            start_value: kr.start_value ?? 0,
            target_value: kr.target_value,
            current_value: kr.current_value,
            metric_unit: kr.metric_unit ?? "percent",
            custom_unit: kr.custom_unit ?? null,
            weight: 100 / example.keyResults.length,
            score: cycle.status === "closed" ? 1 : null,
            published_at: publishedAt,
            created_at: publishedAt ?? createdAt,
            updated_at: createdAt,
            responsible_ids: [ownerId],
            user_acl_ids: [],
            group_acl_ids: [],
            breakdowns: [],
          })),
        };
      }),
    };
  }));

  return { cycles, sets };
}
