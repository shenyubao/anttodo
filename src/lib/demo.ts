import { addDays, subDays } from "date-fns";
import type {
  Connector,
  FocusSession,
  Label,
  Member,
  SyncConflict,
  SyncRun,
  Task,
  Workspace,
  WorkspaceBundle,
} from "../types";
import { DEFAULT_LABEL_COLOR } from "./labels";

const now = new Date();
const userId = "demo-user";

export const demoWorkspaces: Workspace[] = [
  {
    id: "workspace-team",
    name: "AntTodo 产品团队",
    slug: "anttodo-product",
    created_by: userId,
    role: "owner",
  },
  {
    id: "workspace-personal",
    name: "个人空间",
    slug: "personal",
    created_by: userId,
    role: "owner",
  },
];

const labels: Label[] = [
  {
    id: "product",
    workspace_id: "workspace-team",
    parent_id: null,
    name: "产品研发",
    color: DEFAULT_LABEL_COLOR,
    kind: "team",
    view_scope: "all",
    manage_scope: "users",
    inherit_permissions: false,
    position: 0,
    created_by: userId,
  },
  {
    id: "frontend",
    workspace_id: "workspace-team",
    parent_id: "product",
    name: "桌面与 Web",
    color: DEFAULT_LABEL_COLOR,
    kind: "team",
    view_scope: "all",
    manage_scope: "users",
    inherit_permissions: true,
    position: 0,
    created_by: userId,
  },
  {
    id: "backend",
    workspace_id: "workspace-team",
    parent_id: "product",
    name: "Supabase 后端",
    color: DEFAULT_LABEL_COLOR,
    kind: "team",
    view_scope: "users",
    manage_scope: "users",
    inherit_permissions: true,
    position: 1,
    created_by: userId,
  },
  {
    id: "urgent",
    workspace_id: "workspace-team",
    parent_id: null,
    name: "本周必保",
    color: DEFAULT_LABEL_COLOR,
    kind: "team",
    view_scope: "all",
    manage_scope: "users",
    inherit_permissions: false,
    position: 1,
    created_by: userId,
  },
];

const task = (
  id: string,
  title: string,
  options: Partial<Task> & { label_ids: string[] },
): Task => ({
  id,
  workspace_id: "workspace-team",
  title,
  description: "",
  kind: "todo",
  status: "open",
  priority: "none",
  due_at: null,
  due_start_at: null,
  due_is_all_day: false,
  due_timezone: null,
  recurrence: null,
  estimate_hours: null,
  actual_hours: null,
  estimate_pomodoros: null,
  actual_pomodoros: null,
  assignee_id: userId,
  cli_assignee: null,
  created_by: userId,
  completed_at: null,
  deleted_at: null,
  version: 1,
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
  subtasks: [],
  reminders: [],
  reminder_persistent: false,
  participant_ids: [],
  description_mentions: [],
  ...options,
});

const tasks: Task[] = [
  task("task-1", "完成 AntTodo 项目框架验收", {
    description: "验证 Web、Mac 桌面端、Supabase 权限与 Mock 连接器。",
    priority: "high",
    due_at: subDays(now, 1).toISOString(),
    label_ids: ["product", "urgent"],
    participant_ids: ["demo-member"],
    subtasks: [
      {
        id: "sub-1",
        task_id: "task-1",
        title: "运行数据库安全测试",
        description: "",
        completed: true,
        position: 0,
        priority: "high",
        due_at: null,
        estimate_hours: null,
        actual_hours: null,
        estimate_pomodoros: null,
        actual_pomodoros: null,
        assignee_id: userId,
        cli_assignee: null,
        created_by: userId,
        due_start_at: null,
        due_is_all_day: false,
        due_timezone: null,
        reminders: [],
        reminder_persistent: false,
      },
      {
        id: "sub-2",
        task_id: "task-1",
        title: "检查 Mac 安装包",
        description: "",
        completed: false,
        position: 1,
        priority: "medium",
        due_at: addDays(now, 1).toISOString(),
        estimate_hours: null,
        actual_hours: null,
        estimate_pomodoros: null,
        actual_pomodoros: null,
        assignee_id: "demo-member",
        cli_assignee: null,
        created_by: userId,
        due_start_at: null,
        due_is_all_day: false,
        due_timezone: null,
        reminders: [],
        reminder_persistent: false,
      },
    ],
  }),
  task("task-2", "优化任务详情抽屉交互", {
    due_at: addDays(now, 2).toISOString(),
    assignee_id: "demo-member",
    label_ids: ["frontend"],
  }),
  task("task-3", "补齐树形标签 RLS 测试", {
    priority: "medium",
    due_at: addDays(now, 5).toISOString(),
    label_ids: ["backend", "urgent"],
  }),
  task("task-4", "整理云效字段映射表", {
    description: "预留 organizationId、projectId、workItemType 与状态映射。",
    due_at: addDays(now, 14).toISOString(),
    label_ids: ["product"],
  }),
  task("task-5", "记录下一轮产品想法", {
    assignee_id: null,
    label_ids: [],
  }),
  task("task-6", "搭建只读离线缓存", {
    status: "completed",
    completed_at: subDays(now, 1).toISOString(),
    label_ids: ["frontend"],
  }),
];

const connectors: Connector[] = [
  {
    id: "connector-dingtalk-group-robot",
    workspace_id: "workspace-team",
    type: "dingtalk",
    name: "钉钉群机器人",
    enabled: true,
    schedule_minutes: 5,
    public_config: { kind: "group_robot", timezone: "Asia/Shanghai" },
    credential_hint: null,
    last_synced_at: subDays(now, 0.05).toISOString(),
    next_sync_at: addDays(now, 0.01).toISOString(),
  },
];

const syncRuns: SyncRun[] = [];

const conflicts: SyncConflict[] = [];

export function createDemoBundle(): WorkspaceBundle {
  const members: Member[] = [
    {
      workspace_id: "workspace-team",
      user_id: userId,
      role: "owner",
      profile: { id: userId, display_name: "沈宇宝", avatar_url: null },
    },
    {
      workspace_id: "workspace-team",
      user_id: "demo-member",
      role: "member",
      profile: { id: "demo-member", display_name: "产品同学", avatar_url: null },
    },
  ];
  return {
    members,
    userGroups: [
      {
        id: "group-product",
        workspace_id: "workspace-team",
        name: "产品组",
        created_by: userId,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      {
        id: "group-client",
        workspace_id: "workspace-team",
        name: "客户端组",
        created_by: userId,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
    ],
    userGroupMembers: [
      { group_id: "group-product", workspace_id: "workspace-team", user_id: userId, added_at: now.toISOString() },
      { group_id: "group-product", workspace_id: "workspace-team", user_id: "demo-member", added_at: now.toISOString() },
      { group_id: "group-client", workspace_id: "workspace-team", user_id: "demo-member", added_at: now.toISOString() },
    ],
    labels: structuredClone(labels),
    labelUserAcls: [
      {
        label_id: "backend",
        workspace_id: "workspace-team",
        user_id: "demo-member",
        permission: "view",
      },
    ],
    labelGroupAcls: [],
    labelPermissionLevels: Object.fromEntries(labels.map((label) => [label.id, 2])),
    userLabelOrder: [],
    tasks: structuredClone(tasks),
    connectors: structuredClone(connectors),
    syncRuns: structuredClone(syncRuns),
    conflicts: structuredClone(conflicts),
    taskListPreferences: [],
    customTaskViews: [],
    taskSystemViewPreferences: [],
    taskSections: [],
    taskPlacements: [],
  };
}

export function createDemoFocusSessions(workspaceId = "workspace-team"): FocusSession[] {
  const ended = now.toISOString();
  const started = new Date(now.getTime() - 25 * 60_000).toISOString();
  return [
    {
      id: "focus-demo-1",
      user_id: userId,
      workspace_id: workspaceId,
      task_id: "task-2",
      subtask_id: null,
      mode: "pomodoro",
      kind: "focus",
      planned_seconds: 1500,
      elapsed_seconds: 1500,
      notes: "完成详情面板交互核对",
      started_at: started,
      ended_at: ended,
      created_at: ended,
    },
    {
      id: "focus-demo-2",
      user_id: userId,
      workspace_id: workspaceId,
      task_id: null,
      subtask_id: null,
      mode: "stopwatch",
      kind: "focus",
      planned_seconds: 0,
      elapsed_seconds: 900,
      notes: null,
      started_at: subDays(now, 1).toISOString(),
      ended_at: subDays(now, 1).toISOString(),
      created_at: subDays(now, 1).toISOString(),
    },
  ];
}
