import { addDays, subDays } from "date-fns";
import type {
  Connector,
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
  assignee_id: userId,
  created_by: userId,
  completed_at: null,
  deleted_at: null,
  version: 1,
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
  subtasks: [],
  reminders: [],
  reminder_persistent: false,
  ...options,
});

const tasks: Task[] = [
  task("task-1", "完成 AntTodo 项目框架验收", {
    description: "验证 Web、Mac 桌面端、Supabase 权限与 Mock 连接器。",
    priority: "high",
    due_at: subDays(now, 1).toISOString(),
    label_ids: ["product", "urgent"],
    subtasks: [
      {
        id: "sub-1",
        task_id: "task-1",
        title: "运行数据库安全测试",
        completed: true,
        position: 0,
        due_at: null,
        assignee_id: userId,
      },
      {
        id: "sub-2",
        task_id: "task-1",
        title: "检查 Mac 安装包",
        completed: false,
        position: 1,
        due_at: addDays(now, 1).toISOString(),
        assignee_id: "demo-member",
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
    id: "connector-mock",
    workspace_id: "workspace-team",
    type: "mock",
    name: "产品演示同步",
    enabled: true,
    schedule_minutes: 5,
    public_config: {},
    credential_hint: null,
    last_synced_at: subDays(now, 0.05).toISOString(),
    next_sync_at: addDays(now, 0.01).toISOString(),
  },
  {
    id: "connector-yunxiao",
    workspace_id: "workspace-team",
    type: "yunxiao",
    name: "云效 · 产品项目",
    enabled: false,
    schedule_minutes: 10,
    public_config: { organizationId: "", projectId: "" },
    credential_hint: null,
    last_synced_at: null,
    next_sync_at: addDays(now, 1).toISOString(),
  },
];

const syncRuns: SyncRun[] = [
  {
    id: "run-1",
    connector_id: "connector-mock",
    status: "succeeded",
    trigger: "cron",
    pulled_count: 2,
    pushed_count: 1,
    conflict_count: 0,
    error_message: null,
    created_at: subDays(now, 0.05).toISOString(),
  },
];

const conflicts: SyncConflict[] = [
  {
    id: "conflict-1",
    connector_id: "connector-mock",
    task_id: "task-2",
    status: "open",
    local_snapshot: { title: "优化任务详情抽屉交互" },
    remote_snapshot: { title: "优化任务详情面板交互（远端）" },
    created_at: subDays(now, 0.02).toISOString(),
  },
];

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
    tasks: structuredClone(tasks),
    connectors: structuredClone(connectors),
    syncRuns: structuredClone(syncRuns),
    conflicts: structuredClone(conflicts),
    taskListPreferences: [],
    taskSections: [],
    taskPlacements: [],
  };
}
