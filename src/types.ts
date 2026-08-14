export type WorkspaceRole = "owner" | "admin" | "member";
export type WorkspaceInviteRole = Exclude<WorkspaceRole, "owner">;
export type LabelKind = "private" | "team";
export type LabelAccessScope = "inherit" | "all" | "users" | "groups";
export type LabelPermission = "view" | "edit";
export type LabelPermissionLevel = 1 | 2;
export type TaskStatus = "open" | "completed" | "cancelled";
export type TaskPriority = "none" | "low" | "medium" | "high";
export type TaskKind = "todo" | "note";
export type AiCliTool = "codex" | "claude";
export type AssigneeTarget =
  | { kind: "none" }
  | { kind: "user"; userId: string }
  | { kind: "cli"; tool: AiCliTool };
export type TaskViewMode = "list" | "kanban" | "timeline";
export type ReminderAnchor = "start" | "end";
export type ReminderUnit = "minute" | "hour" | "day" | "week";
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
export type TaskListFilterAssignee = "all" | "unassigned" | "assigned_to_me" | "users";
export type TaskListFilterWatching = "all" | "watching";
export type TaskListFilterCreator = "all" | "created_by_me";
export type TaskListFilterDue =
  | "all"
  | "overdue"
  | "today"
  | "tomorrow"
  | "this_week"
  | "next_7_days"
  | "next_30_days";
export type TaskListFilterDueSelection = TaskListFilterDue[];
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

export type AiWorkSettings = {
  user_id: string;
  workspace_id: string;
  cli_tools: AiCliTool[];
  default_working_path: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AiFeatureSettings = {
  user_id: string;
  smart_format_enabled: boolean;
  smart_format_prompt_override: string | null;
  subtask_decompose_enabled: boolean;
  subtask_decompose_prompt_override: string | null;
  created_at?: string;
  updated_at?: string;
};

export type FocusSessionMode = "pomodoro" | "stopwatch";
export type FocusSessionKind = "focus" | "short_break" | "long_break";

export type FocusSession = {
  id: string;
  user_id: string;
  workspace_id: string;
  task_id: string | null;
  subtask_id: string | null;
  mode: FocusSessionMode;
  kind: FocusSessionKind;
  planned_seconds: number;
  elapsed_seconds: number;
  notes: string | null;
  started_at: string;
  ended_at: string;
  created_at: string;
};

export type FocusSettings = {
  user_id: string;
  workspace_id: string;
  pomodoro_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
  long_break_interval: number;
  auto_start_pomodoro: boolean;
  auto_start_break: boolean;
  show_tab_title: boolean;
  sound_enabled: boolean;
  created_at?: string;
  updated_at?: string;
};

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  created_by: string;
  role?: WorkspaceRole;
};

export type UserQuota = {
  user_id: string;
  workspace_limit: number;
  created_at: string;
  updated_at: string;
};

export type Member = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  profile?: Profile;
};

export type UserGroup = {
  id: string;
  workspace_id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type UserGroupMember = {
  group_id: string;
  workspace_id: string;
  user_id: string;
  added_at: string;
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
  workspaceSlug: string;
  inviterDisplayName: string;
  role: WorkspaceInviteRole;
  status: "active" | "revoked";
  ssoEnabled: boolean;
};

export type Label = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  color: string;
  kind: LabelKind;
  view_scope: LabelAccessScope;
  manage_scope: LabelAccessScope;
  inherit_permissions: boolean;
  position: number;
  created_by: string;
};

export type LabelUserAcl = {
  label_id: string;
  workspace_id: string;
  user_id: string;
  permission: LabelPermission;
};

export type LabelGroupAcl = {
  label_id: string;
  workspace_id: string;
  group_id: string;
  permission: LabelPermission;
};

export type LabelAccessDraft = {
  name: string;
  color: string;
  parentId: string | null;
  kind: LabelKind;
  viewScope: LabelAccessScope;
  manageScope: LabelAccessScope;
  viewSubjectIds: string[];
  manageSubjectIds: string[];
};

export type Subtask = {
  id: string;
  task_id: string;
  title: string;
  description: string;
  completed: boolean;
  position: number;
  priority: TaskPriority;
  due_at: string | null;
  due_start_at: string | null;
  due_is_all_day: boolean;
  due_timezone: string | null;
  estimate_hours: number | null;
  actual_hours: number | null;
  estimate_pomodoros: number | null;
  actual_pomodoros: number | null;
  assignee_id: string | null;
  cli_assignee: AiCliTool | null;
  created_by: string | null;
  reminders: TaskReminder[];
  reminder_persistent: boolean;
};

export type ReminderRule = {
  anchor: ReminderAnchor;
  offset_value: number;
  offset_unit: ReminderUnit;
  local_time: string | null;
};

export type TaskReminder = ReminderRule & {
  id: string;
  task_id: string;
  subtask_id: string | null;
  trigger_at: string;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ReminderSchedule = {
  reminders: ReminderRule[];
  persistent: boolean;
  recurrence: TaskRecurrence | null;
};

export type RecurrenceFreq = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export type TaskRecurrence = {
  freq: RecurrenceFreq;
  interval: 1;
  mode: "due";
};

export type Task = {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  kind: TaskKind;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  due_start_at: string | null;
  due_is_all_day: boolean;
  due_timezone: string | null;
  recurrence: TaskRecurrence | null;
  estimate_hours: number | null;
  actual_hours: number | null;
  estimate_pomodoros: number | null;
  actual_pomodoros: number | null;
  assignee_id: string | null;
  cli_assignee: AiCliTool | null;
  created_by: string;
  completed_at: string | null;
  deleted_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  label_ids: string[];
  participant_ids: string[];
  subtasks: Subtask[];
  reminders: TaskReminder[];
  reminder_persistent: boolean;
  description_mentions: CommentMention[];
};

export type CommentMention = {
  user_id: string;
  display_name_snapshot: string;
};

export type TaskComment = {
  id: string;
  workspace_id: string;
  task_id: string;
  subtask_id: string | null;
  author_id: string;
  body: string;
  image_uris: string[];
  created_at: string;
  updated_at: string;
  author?: Profile;
  mentions: CommentMention[];
};

export type TaskActivityEvent = {
  id: string;
  workspace_id: string;
  task_id: string;
  actor_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
  actor?: Profile;
};

export type TaskActivityPage = {
  items: TaskActivityEvent[];
  nextCursor: { createdAt: string; id: string } | null;
};

export type NotificationScenario =
  | "task_assigned"
  | "task_due_reminder"
  | "task_new_comment"
  | "note_mentioned"
  | "todo_mentioned"
  | "participant_added"
  | "participant_title_changed"
  | "participant_status_changed"
  | "participant_new_comment"
  | "participant_subtask_created"
  | "participant_subtask_status_changed"
  | "participant_subtask_title_changed";

export type NotificationChannelPreferences = {
  systemEnabled: boolean;
  dingtalkEnabled: boolean;
};

export type NotificationPreferences = Record<
  NotificationScenario,
  NotificationChannelPreferences
>;

export type NotificationType =
  | "comment_mention"
  | "todo_mentioned"
  | "task_assigned"
  | "task_new_comment"
  | "note_mentioned"
  | "participant_added"
  | "participant_title_changed"
  | "participant_status_changed"
  | "participant_new_comment"
  | "participant_subtask_created"
  | "participant_subtask_status_changed"
  | "participant_subtask_title_changed";

export type AppNotification = {
  id: string;
  workspace_id: string;
  task_id: string;
  comment_id: string | null;
  recipient_id: string;
  actor_id: string;
  notification_type: NotificationType;
  payload?: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  actor?: Profile;
  task?: Pick<Task, "id" | "title" | "kind"> & { description?: string };
  comment?: Pick<TaskComment, "id" | "body" | "image_uris">;
};

export type TaskListPreference = {
  user_id: string;
  workspace_id: string;
  list_key: string;
  grouping: TaskListGrouping;
  sort: TaskListSort;
  direction: SortDirection;
  filter_assignee: TaskListFilterAssignee;
  filter_assignee_ids: string[];
  filter_watching: TaskListFilterWatching;
  filter_creator: TaskListFilterCreator;
  filter_due: TaskListFilterDueSelection;
  show_labels: boolean;
  show_completed: boolean;
  show_hours: boolean;
  view_mode: TaskViewMode;
  updated_at?: string;
};

export type CustomTaskViewScope = "all" | "label" | "inbox" | "trash";

export type CustomTaskViewDefinition = {
  scope: CustomTaskViewScope;
  label_ids: string[];
  filter_assignee: TaskListFilterAssignee;
  filter_assignee_ids: string[];
  filter_watching: TaskListFilterWatching;
  filter_creator: TaskListFilterCreator;
  filter_due: TaskListFilterDueSelection;
};

export type CustomTaskView = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  definition: CustomTaskViewDefinition;
  visible: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

export type TaskSystemViewPreference = {
  user_id: string;
  workspace_id: string;
  view_key: "all" | "today" | "week" | "assigned" | "watching" | "inbox" | "trash";
  visible: boolean;
  position: number;
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

export type UserLabelOrder = {
  user_id: string;
  workspace_id: string;
  label_id: string;
  position: number;
};

export type WorkspaceBundle = {
  members: Member[];
  userGroups: UserGroup[];
  userGroupMembers: UserGroupMember[];
  labels: Label[];
  labelUserAcls: LabelUserAcl[];
  labelGroupAcls: LabelGroupAcl[];
  labelPermissionLevels: Record<string, LabelPermissionLevel>;
  userLabelOrder: UserLabelOrder[];
  tasks: Task[];
  connectors: Connector[];
  syncRuns: SyncRun[];
  conflicts: SyncConflict[];
  taskListPreferences: TaskListPreference[];
  customTaskViews: CustomTaskView[];
  taskSystemViewPreferences: TaskSystemViewPreference[];
  taskSections: TaskSection[];
  taskPlacements: TaskPlacement[];
};
