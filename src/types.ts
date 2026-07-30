export type WorkspaceRole = "owner" | "admin" | "member";
export type WorkspaceInviteRole = Exclude<WorkspaceRole, "owner">;
export type LabelVisibility = "workspace" | "private" | "restricted";
export type TaskStatus = "open" | "completed" | "cancelled";
export type TaskPriority = "none" | "low" | "medium" | "high";
export type ConnectorType = "mock" | "yunxiao" | "dingtalk";
export type TimeFormat = "12h" | "24h";
export type DateFormat = "mdy" | "dmy" | "ymd";
export type TaskListGrouping =
  | "custom"
  | "due"
  | "created"
  | "label"
  | "priority"
  | "assignee"
  | "none";
export type TaskListSort =
  | "custom"
  | "due"
  | "created"
  | "updated"
  | "title"
  | "label"
  | "priority"
  | "assignee";
export type SortDirection = "asc" | "desc";

export type DateTimePreferences = {
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  showLunar: boolean;
  showWeekNumbers: boolean;
  showHolidayAdjustments: boolean;
  timeZoneEnabled: boolean;
};

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

export type Workspace = {
  id: string;
  name: string;
  created_by: string;
  role?: WorkspaceRole;
};

export type Member = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  profile?: Profile;
};

export type WorkspaceInviteLink = {
  id: string;
  workspace_id: string;
  role: WorkspaceInviteRole;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type WorkspaceInvitePreview = {
  workspaceName: string;
  inviterDisplayName: string;
  role: WorkspaceInviteRole;
  status: "active" | "revoked";
};

export type Label = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  color: string;
  visibility: LabelVisibility;
  inherit_permissions: boolean;
  position: number;
  created_by: string;
};

export type LabelAcl = {
  label_id: string;
  user_id: string;
  permission: "view" | "edit";
};

export type Subtask = {
  id: string;
  task_id: string;
  title: string;
  completed: boolean;
  position: number;
};

export type Task = {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  due_start_at: string | null;
  due_is_all_day: boolean;
  due_timezone: string | null;
  assignee_id: string | null;
  created_by: string;
  completed_at: string | null;
  deleted_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  label_ids: string[];
  subtasks: Subtask[];
};

export type TaskListPreference = {
  user_id: string;
  workspace_id: string;
  list_key: string;
  grouping: TaskListGrouping;
  sort: TaskListSort;
  direction: SortDirection;
  show_labels: boolean;
  updated_at?: string;
};

export type TaskSection = {
  id: string;
  workspace_id: string;
  list_key: string;
  name: string;
  position: number;
  created_by: string;
  created_at?: string;
  updated_at?: string;
};

export type TaskPlacement = {
  workspace_id: string;
  list_key: string;
  task_id: string;
  section_id: string | null;
  position: number;
  updated_at?: string;
};

export type Connector = {
  id: string;
  workspace_id: string;
  type: ConnectorType;
  name: string;
  enabled: boolean;
  schedule_minutes: number;
  public_config: Record<string, unknown>;
  credential_hint: string | null;
  last_synced_at: string | null;
  next_sync_at: string;
};

export type SyncRun = {
  id: string;
  connector_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "conflict";
  trigger: string;
  pulled_count: number;
  pushed_count: number;
  conflict_count: number;
  error_message: string | null;
  created_at: string;
};

export type SyncConflict = {
  id: string;
  connector_id: string;
  task_id: string;
  status: "open" | "resolved_local" | "resolved_remote";
  local_snapshot: Record<string, unknown>;
  remote_snapshot: Record<string, unknown>;
  created_at: string;
};

export type WorkspaceBundle = {
  members: Member[];
  labels: Label[];
  labelAcls: LabelAcl[];
  tasks: Task[];
  connectors: Connector[];
  syncRuns: SyncRun[];
  conflicts: SyncConflict[];
  taskListPreferences: TaskListPreference[];
  taskSections: TaskSection[];
  taskPlacements: TaskPlacement[];
};
