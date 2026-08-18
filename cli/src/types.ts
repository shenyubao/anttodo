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
  privateKey: JsonWebKey;
  verificationUrl: string;
  expiresAt: string;
  interval: number;
  serviceKey: string;
  config: ServiceConfig;
};

export type DeviceCiphertext = {
  ephemeralPublicKey: JsonWebKey;
  salt: string;
  iv: string;
  ciphertext: string;
};

export type CliSessionPayload = {
  accessToken: string;
  refreshToken: string;
  userId: string;
};
