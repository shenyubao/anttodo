export type OutputFormat = "json" | "pretty" | "table" | "ndjson" | "csv";
export type TaskPriority = "none" | "low" | "medium" | "high";
export type TaskStatus = "open" | "completed" | "cancelled";
export type LabelAccessScope = "inherit" | "all" | "users" | "groups";
export type LabelKind = "private" | "team";
export type TaskKind = "todo" | "note";
export type FocusSessionMode = "pomodoro" | "stopwatch";
export type FocusSessionKind = "focus" | "short_break" | "long_break";
export type FocusSession = {
  id: string;
  user_id: string;
  workspace_id: string;
  task_id: string | null;
  mode: FocusSessionMode;
  kind: FocusSessionKind;
  planned_seconds: number;
  elapsed_seconds: number;
  notes: string | null;
  started_at: string;
  ended_at: string;
  created_at: string;
};
export type WeeklyReportStatus = "draft" | "published";
export type WeeklyReportVisibility = "workspace" | "users" | "groups";
export type WeeklyReportNotificationSummary = {
  revision: number;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  failed_group_names: string[];
};
export type WeeklyReport = {
  id: string;
  workspace_id: string;
  author_id: string;
  week_start: string;
  okr_progress_text: string;
  completed_text: string;
  next_plan_text: string;
  reflection_text: string;
  status: WeeklyReportStatus;
  visibility: WeeklyReportVisibility;
  user_acl_ids: string[];
  group_acl_ids: string[];
  notification_group_ids: string[];
  notification_revision: number;
  notification_summary: WeeklyReportNotificationSummary | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};
export type ReminderAnchor = "start" | "end";
export type ReminderUnit = "minute" | "hour" | "day" | "week";
export type ReminderRule = {
  anchor: ReminderAnchor;
  offset_value: number;
  offset_unit: ReminderUnit;
  local_time?: string | null;
};
export type RecurrenceFrequency = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
export type RecurrenceRule = { freq: RecurrenceFrequency; interval: 1; mode: "due" };
export type TaskSchedule = {
  dueAt: string | null;
  dueStartAt?: string | null;
  dueIsAllDay?: boolean;
  dueTimezone?: string | null;
  reminders: ReminderRule[];
  persistent: boolean;
  recurrence: RecurrenceRule | null;
};

export type PublicConfig = {
  supabaseUrl: string;
  publishableKey: string;
  appUrl: string;
  deviceAuthorizationEndpoint: string;
  cliAuthProtocol: 2;
};

export type ServiceConfig = PublicConfig & {
  schemaVersion: 1;
  instanceId: string;
  displayName: string;
  serviceKey: string;
  official: boolean;
  source: "builtin" | "network" | "cache" | "environment";
};

export type PendingAuthorization = {
  requestId: string;
  deviceCode: string;
  verificationUrl: string;
  expiresAt: string;
  interval: number;
  serviceKey: string;
  config: ServiceConfig;
};

export type CliCredential = {
  schemaVersion: 2;
  deviceId: string;
  secret: string;
  user: { id: string; email: string | null; phone: string | null };
  credentialExpiresAt: string | null;
  accessToken?: string;
  accessTokenExpiresAt?: string;
};
