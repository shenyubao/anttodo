import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AiFeatureSettings,
  AiWorkSettings,
  AssigneeTarget,
  AppNotification,
  Connector,
  CustomTaskView,
  CustomTaskViewDefinition,
  DateTimePreferences,
  FocusSession,
  FocusSettings,
  Label,
  LabelAccessDraft,
  MatrixQuadrantPreference,
  Member,
  NotificationChannelPreferences,
  NotificationPreferences,
  NotificationScenario,
  ReminderSchedule,
  SyncConflict,
  SyncRun,
  Task,
  TaskDependency,
  TaskReminder,
  TaskActivityEvent,
  TaskActivityPage,
  TaskComment,
  TaskKind,
  TaskListPreference,
  TaskSystemViewPreference,
  TaskSection,
  TaskPriority,
  UserLabelOrder,
  UserSidebarMember,
  UserQuota,
  Workspace,
  WorkspaceBundle,
} from "../types";
import {
  normalizeAiFormatSuggestion,
  type AiFormatSuggestion,
} from "./aiTaskFormat";
import {
  createDefaultAiFeatureSettings,
  normalizeAiFeatureSettings,
} from "./aiFeatureSettings";
import {
  DEFAULT_DATE_TIME_PREFERENCES,
  preferenceModelToRow,
  preferenceRowToModel,
} from "./dateTimePreferences";
import { createDefaultFocusSettings } from "./focusSession";
import { mergeNotificationPreferenceRows } from "./notificationPreferences";
import { coerceHours, coercePomodoros } from "./taskHours";
import { edgeFunctionErrorMessage } from "./sso";
import { mapLabelTaskLimitError } from "./labelTaskLimits";
import {
  isValidWorkspaceSlug,
  normalizeWorkspaceSlug,
  suggestWorkspaceSlug,
} from "./workspaceSlug";

const TASK_DETAIL_SELECT = "*, task_labels(label_id), task_participants(user_id), task_description_mentions(user_id, display_name_snapshot), task_reminders(*), task_reminder_settings(persistent), task_dependencies:task_dependencies!task_dependencies_task_id_fkey(*)";
const TASK_ID_QUERY_BATCH_SIZE = 50;

type TaskRow = Omit<
  Task,
  | "label_ids"
  | "participant_ids"
  | "reminders"
  | "reminder_persistent"
  | "description_mentions"
  | "dependencies"
> & {
  task_labels?: Array<{ label_id: string }>;
  task_participants?: Array<{ user_id: string }>;
  task_description_mentions?: Array<{ user_id: string; display_name_snapshot: string }>;
  task_reminders?: Task["reminders"];
  task_reminder_settings?: Array<{ persistent: boolean }> | { persistent: boolean } | null;
  task_dependencies?: TaskDependency[];
};

export const WORKSPACE_TASK_PAGE_SIZE = 1000;

export type WorkspaceTaskPage = {
  tasks: Task[];
  hasMore: boolean;
};

async function enrichTaskIds(client: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return [] as TaskRow[];
  const rows: TaskRow[] = [];
  for (let offset = 0; offset < ids.length; offset += TASK_ID_QUERY_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + TASK_ID_QUERY_BATCH_SIZE);
    const { data, error } = await client
      .from("tasks")
      .select(TASK_DETAIL_SELECT)
      .in("id", batch);
    assertNoError(error);
    rows.push(...((data ?? []) as TaskRow[]));
  }
  return rows;
}

export async function loadWorkspaceTaskPage(
  client: SupabaseClient,
  workspaceId: string,
  offset = 0,
  limit = WORKSPACE_TASK_PAGE_SIZE,
): Promise<WorkspaceTaskPage> {
  const { data, error } = await client.rpc("get_task_page", {
    p_workspace_id: workspaceId,
    p_offset: offset,
    p_limit: limit,
  });
  assertNoError(error);
  const snapshotRows = (data ?? []) as Array<{ id: string; parent_task_id: string | null }>;
  const rows = await enrichTaskIds(client, snapshotRows.map((row) => row.id));
  const rootCount = snapshotRows.filter((row) => row.parent_task_id === null).length;
  return { tasks: normalizeTaskRows(rows), hasMore: rootCount >= limit };
}

export async function loadTaskTree(client: SupabaseClient, taskId: string) {
  const { data, error } = await client.rpc("get_task_tree", { p_task_id: taskId });
  assertNoError(error);
  const rows = await enrichTaskIds(client, (data ?? []).map((row: { id: string }) => row.id));
  return normalizeTaskRows(rows);
}

export async function loadWorkspaceTasksByIds(client: SupabaseClient, taskIds: string[]) {
  const ids = [...new Set(taskIds.filter((taskId) => taskId.length > 0))];
  if (ids.length === 0) return [] as Task[];
  return normalizeTaskRows(await enrichTaskIds(client, ids));
}

function normalizeTaskRow(row: TaskRow): Task {
  const settings = Array.isArray(row.task_reminder_settings)
    ? row.task_reminder_settings[0]
    : row.task_reminder_settings;
  const allReminders = [...(row.task_reminders ?? [])].sort((a, b) => a.position - b.position);
  const allDependencies = [...(row.task_dependencies ?? [])].sort((a, b) => a.position - b.position);
  return {
    ...row,
    external_id: row.external_id ?? null,
    connector_id: row.connector_id ?? null,
    connector_platform: row.connector_platform ?? null,
    kind: row.kind ?? "todo",
    recurrence: row.recurrence ?? null,
    estimate_hours: coerceHours(row.estimate_hours),
    actual_hours: coerceHours(row.actual_hours),
    estimate_pomodoros: coercePomodoros(row.estimate_pomodoros),
    actual_pomodoros: coercePomodoros(row.actual_pomodoros),
    label_ids: row.task_labels?.map((item) => item.label_id) ?? [],
    participant_ids: row.task_participants?.map((item) => item.user_id) ?? [],
    description_mentions: row.task_description_mentions ?? [],
    dependencies: allDependencies,
    children: [],
    reminders: allReminders,
    reminder_persistent: settings?.persistent ?? false,
  };
}

export async function completeExternalTask(
  client: SupabaseClient,
  taskId: string,
): Promise<Task> {
  const { data, error } = await client.functions.invoke("external-task-complete", {
    body: { taskId },
  });
  if (error) throw new Error(await edgeFunctionErrorMessage(error, data, "云效状态更新失败"));
  if (!data?.task) throw new Error("云效状态更新未返回任务");
  return data.task as Task;
}

export async function setExternalTaskDeletedAt(
  client: SupabaseClient,
  taskId: string,
  deletedAt: string | null,
): Promise<Task> {
  const { data, error } = await client.rpc("set_external_task_deleted_at", {
    p_task_id: taskId,
    p_deleted_at: deletedAt,
  });
  assertNoError(error);
  if (!data) throw new Error("外部任务删除状态更新失败");
  return data as Task;
}

function normalizeTaskRows(rows: TaskRow[]): Task[] {
  const tasks = rows.map(normalizeTaskRow);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const rootOf = (task: Task) => {
    let cursor = task;
    const seen = new Set<string>();
    while (cursor.parent_task_id && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      cursor = byId.get(cursor.parent_task_id) ?? cursor;
      if (cursor.id === task.id) break;
    }
    return cursor;
  };
  return tasks.map((task) => ({
    ...task,
    label_ids: task.parent_task_id ? rootOf(task).label_ids : task.label_ids,
    children: tasks
      .filter((candidate) => candidate.parent_task_id === task.id && !candidate.deleted_at)
      .sort((a, b) => a.position - b.position),
  }));
}

function assertNoError(error: { message: string } | null) {
  if (!error) return;
  throw new Error(mapLabelTaskLimitError(error.message) ?? error.message);
}

function labelAccessRpcParams(draft: LabelAccessDraft) {
  return {
    p_name: draft.name.trim(),
    p_color: draft.color,
    p_kind: draft.kind,
    p_view_scope: draft.viewScope,
    p_manage_scope: draft.manageScope,
    p_view_subject_ids: draft.kind === "team" && ["users", "groups"].includes(draft.viewScope)
      ? draft.viewSubjectIds : [],
    p_manage_subject_ids: draft.kind === "team" && ["users", "groups"].includes(draft.manageScope)
      ? draft.manageSubjectIds : [],
    p_inherit_permissions: Boolean(draft.parentId),
  };
}

export async function createLabelWithAccess(
  client: SupabaseClient,
  workspaceId: string,
  draft: LabelAccessDraft,
) {
  const { data, error } = await client.rpc("create_label_with_access", {
    p_workspace_id: workspaceId,
    p_parent_id: draft.parentId,
    ...labelAccessRpcParams(draft),
  });
  assertNoError(error);
  return data as Label;
}

export async function updateLabelWithAccess(
  client: SupabaseClient,
  labelId: string,
  draft: LabelAccessDraft,
) {
  const { data, error } = await client.rpc("update_label_with_access", {
    p_label_id: labelId,
    ...labelAccessRpcParams(draft),
  });
  assertNoError(error);
  return data as Label;
}

export async function loadTaskComments(
  client: SupabaseClient,
  taskId: string,
): Promise<TaskComment[]> {
  const query = client
    .from("task_comments")
    .select("*, mentions:task_comment_mentions(user_id, display_name_snapshot)")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  const { data, error } = await query;
  assertNoError(error);

  const rows = (data ?? []) as Array<Omit<TaskComment, "author">>;
  const authorIds = [...new Set(rows.map((comment) => comment.author_id))];
  const profilesResult = authorIds.length
    ? await client
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", authorIds)
    : { data: [], error: null };
  assertNoError(profilesResult.error);
  const profiles = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id, profile]),
  );
  return rows.map((comment) => ({
    ...comment,
    task_id: comment.task_id,
    mentions: comment.mentions ?? [],
    author: profiles.get(comment.author_id),
  }));
}

export async function loadTaskActivity(
  client: SupabaseClient,
  taskId: string,
  cursor: TaskActivityPage["nextCursor"] = null,
  limit = 50,
): Promise<TaskActivityPage> {
  const { data, error } = await client.rpc("list_task_activity", {
    p_task_id: taskId,
    p_before_created_at: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: limit,
  });
  assertNoError(error);

  const rows = (data ?? []) as Array<Omit<TaskActivityEvent, "actor">>;
  const actorIds = [...new Set(rows.flatMap((event) => event.actor_id ? [event.actor_id] : []))];
  const profilesResult = actorIds.length
    ? await client.from("profiles").select("id, display_name, avatar_url").in("id", actorIds)
    : { data: [], error: null };
  assertNoError(profilesResult.error);
  const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const items = rows.map((event) => ({
    ...event,
    payload: event.payload ?? {},
    actor: event.actor_id ? profiles.get(event.actor_id) : undefined,
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor: items.length === limit && last
      ? { createdAt: last.created_at, id: last.id }
      : null,
  };
}

export async function listTaskCommentCandidateIds(
  client: SupabaseClient,
  taskId: string,
) {
  const { data, error } = await client.rpc("list_task_comment_candidates", {
    p_task_id: taskId,
  });
  assertNoError(error);
  return (data ?? []).map((row: { user_id: string }) => row.user_id);
}

export async function updateTaskDescription(
  client: SupabaseClient,
  input: {
    taskId: string;
    description: string;
    mentionedUserIds: string[];
  },
) {
  const { data, error } = await client.rpc("update_task_description", {
    p_task_id: input.taskId,
    p_description: input.description,
    p_mentioned_user_ids: input.mentionedUserIds,
  });
  assertNoError(error);
  return data as Task;
}

export async function createTaskComment(
  client: SupabaseClient,
  input: {
    taskId: string;
    body: string;
    imageUris: string[];
    mentionedUserIds: string[];
  },
) {
  const { data, error } = await client.rpc("create_task_comment", {
    p_task_id: input.taskId,
    p_body: input.body,
    p_image_uris: input.imageUris,
    p_mentioned_user_ids: input.mentionedUserIds,
  });
  assertNoError(error);
  return data as TaskComment;
}

export async function deleteTaskComment(
  client: SupabaseClient,
  commentId: string,
) {
  const { error } = await client.from("task_comments").delete().eq("id", commentId);
  assertNoError(error);
}

export async function purgeTrashedTask(
  client: SupabaseClient,
  taskId: string,
) {
  const { data, error } = await client
    .from("tasks")
    .delete()
    .eq("id", taskId)
    .not("deleted_at", "is", null)
    .select("id");
  assertNoError(error);
  if (!data?.length) {
    throw new Error("只能彻底删除回收站中的任务");
  }
  // The delete trigger has durably queued every task-owned Storage object.
  // Run the worker now for prompt cleanup; the database cron remains the retry path.
  await client.functions.invoke("attachment-cleanup", {
    body: { reason: "task-purged" },
  }).catch(() => undefined);
}

export async function updateTaskComment(
  client: SupabaseClient,
  input: {
    commentId: string;
    body: string;
    imageUris: string[];
    mentionedUserIds: string[];
  },
) {
  const { data, error } = await client.rpc("update_task_comment", {
    p_comment_id: input.commentId,
    p_body: input.body,
    p_image_uris: input.imageUris,
    p_mentioned_user_ids: input.mentionedUserIds,
  });
  assertNoError(error);
  return data as TaskComment;
}

export async function loadNotifications(
  client: SupabaseClient,
  workspaceId: string,
): Promise<AppNotification[]> {
  const { data, error } = await client
    .from("notifications")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(100);
  assertNoError(error);
  const rows = (data ?? []) as AppNotification[];
  const actorIds = [...new Set(rows.map((item) => item.actor_id))];
  const taskIds = [...new Set(rows.map((item) => item.task_id))];
  const commentIds = [...new Set(
    rows.flatMap((item) => (item.comment_id ? [item.comment_id] : [])),
  )];
  const [profilesResult, tasksResult, commentsResult] = await Promise.all([
    actorIds.length
      ? client.from("profiles").select("id, display_name, avatar_url").in("id", actorIds)
      : Promise.resolve({ data: [], error: null }),
    taskIds.length
      ? client.from("tasks").select("id, title, kind, description").in("id", taskIds)
      : Promise.resolve({ data: [], error: null }),
    commentIds.length
      ? client.from("task_comments").select("id, body, image_uris").in("id", commentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  assertNoError(profilesResult.error);
  assertNoError(tasksResult.error);
  assertNoError(commentsResult.error);
  const profiles = new Map((profilesResult.data ?? []).map((item) => [item.id, item]));
  const tasks = new Map((tasksResult.data ?? []).map((item) => [item.id, item]));
  const comments = new Map((commentsResult.data ?? []).map((item) => [item.id, item]));
  return rows.flatMap((item) => {
    const task = tasks.get(item.task_id);
    if (!task) return [];
    const comment = item.comment_id ? comments.get(item.comment_id) : undefined;
    return [{ ...item, actor: profiles.get(item.actor_id), task, comment }];
  });
}

export async function loadNotificationPreferences(
  client: SupabaseClient,
  userId: string,
): Promise<NotificationPreferences> {
  const { data, error } = await client
    .from("user_notification_preferences")
    .select("scenario, system_enabled, dingtalk_enabled")
    .eq("user_id", userId);
  assertNoError(error);
  return mergeNotificationPreferenceRows(data ?? []);
}

export async function saveNotificationPreference(
  client: SupabaseClient,
  userId: string,
  scenario: NotificationScenario,
  preferences: NotificationChannelPreferences,
) {
  const { error } = await client
    .from("user_notification_preferences")
    .upsert({
      user_id: userId,
      scenario,
      system_enabled: preferences.systemEnabled,
      dingtalk_enabled: preferences.dingtalkEnabled,
      updated_at: new Date().toISOString(),
    });
  assertNoError(error);
  return preferences;
}

export async function markNotificationRead(
  client: SupabaseClient,
  notificationId: string,
) {
  const { error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId);
  assertNoError(error);
}

export async function markAllNotificationsRead(
  client: SupabaseClient,
  workspaceId: string,
) {
  const { error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .is("read_at", null);
  assertNoError(error);
}

export async function loadWorkspaces(
  client: SupabaseClient,
  userId: string,
): Promise<Workspace[]> {
  // RLS lets members read every row in their workspaces; filter to the current
  // user so the switcher is one entry per joined team, not one per teammate.
  // Query the two tables separately. Join-table FKs make PostgREST embeds of
  // workspaces from workspace_members ambiguous (PGRST201).
  const { data: memberships, error } = await client
    .from("workspace_members")
    .select("role, workspace_id")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true });
  assertNoError(error);

  const workspaceIds = [...new Set((memberships ?? []).map((row) => row.workspace_id))];
  const { data: workspaceRows, error: workspacesError } = workspaceIds.length
    ? await client.from("workspaces").select("*").in("id", workspaceIds)
    : { data: [], error: null };
  assertNoError(workspacesError);

  const workspacesById = new Map(
    (workspaceRows ?? []).map((workspace) => [workspace.id, workspace as Workspace]),
  );
  const seen = new Set<string>();
  const workspaces: Workspace[] = [];
  for (const membership of memberships ?? []) {
    const workspace = workspacesById.get(membership.workspace_id);
    if (!workspace || seen.has(workspace.id)) continue;
    seen.add(workspace.id);
    workspaces.push({ ...workspace, role: membership.role });
  }
  return workspaces;
}

export async function loadUserQuota(
  client: SupabaseClient,
  userId: string,
): Promise<UserQuota> {
  const { data, error } = await client
    .from("user_quotas")
    .select("user_id, workspace_limit, created_at, updated_at")
    .eq("user_id", userId)
    .single();
  assertNoError(error);
  return data as UserQuota;
}

export async function loadDateTimePreferences(
  client: SupabaseClient,
  userId: string,
): Promise<DateTimePreferences> {
  const { data, error } = await client
    .from("user_date_time_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  assertNoError(error);
  return preferenceRowToModel(data);
}

export async function loadAiWorkSettings(
  client: SupabaseClient,
  userId: string,
  workspaceId: string,
): Promise<AiWorkSettings> {
  const { data, error } = await client
    .from("user_ai_work_settings")
    .select("*")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  assertNoError(error);
  return (data as AiWorkSettings | null) ?? {
    user_id: userId,
    workspace_id: workspaceId,
    cli_tools: [],
    default_working_path: null,
  };
}

export async function loadAiFeatureSettings(
  client: SupabaseClient,
  userId: string,
): Promise<AiFeatureSettings> {
  const { data, error } = await client
    .from("user_ai_feature_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  assertNoError(error);
  return data
    ? normalizeAiFeatureSettings(data as AiFeatureSettings)
    : createDefaultAiFeatureSettings(userId);
}

export async function saveAiFeatureSettings(
  client: SupabaseClient,
  settings: AiFeatureSettings,
) {
  const normalized = normalizeAiFeatureSettings(settings);
  const { data, error } = await client
    .from("user_ai_feature_settings")
    .upsert({
      user_id: normalized.user_id,
      smart_format_enabled: normalized.smart_format_enabled,
      smart_format_prompt_override: normalized.smart_format_prompt_override,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" })
    .select("*")
    .single();
  assertNoError(error);
  return normalizeAiFeatureSettings(data as AiFeatureSettings);
}

export async function saveAiWorkSettings(
  client: SupabaseClient,
  settings: AiWorkSettings,
) {
  const { data, error } = await client
    .from("user_ai_work_settings")
    .upsert({
      user_id: settings.user_id,
      workspace_id: settings.workspace_id,
      cli_tools: settings.cli_tools,
      default_working_path: settings.default_working_path,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,workspace_id" })
    .select("*")
    .single();
  assertNoError(error);
  return data as AiWorkSettings;
}

export async function loadFocusSettings(
  client: SupabaseClient,
  userId: string,
  workspaceId: string,
): Promise<FocusSettings> {
  const { data, error } = await client
    .from("user_focus_settings")
    .select("*")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  assertNoError(error);
  return (data as FocusSettings | null) ?? createDefaultFocusSettings(userId, workspaceId);
}

export async function saveFocusSettings(
  client: SupabaseClient,
  settings: FocusSettings,
) {
  const { data, error } = await client
    .from("user_focus_settings")
    .upsert({
      user_id: settings.user_id,
      workspace_id: settings.workspace_id,
      pomodoro_minutes: settings.pomodoro_minutes,
      short_break_minutes: settings.short_break_minutes,
      long_break_minutes: settings.long_break_minutes,
      long_break_interval: settings.long_break_interval,
      auto_start_pomodoro: settings.auto_start_pomodoro,
      auto_start_break: settings.auto_start_break,
      show_tab_title: settings.show_tab_title,
      sound_enabled: settings.sound_enabled,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,workspace_id" })
    .select("*")
    .single();
  assertNoError(error);
  return data as FocusSettings;
}

export async function loadFocusSessions(
  client: SupabaseClient,
  userId: string,
  workspaceId: string,
  limit = 100,
): Promise<FocusSession[]> {
  const { data, error } = await client
    .from("focus_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .order("started_at", { ascending: false })
    .limit(limit);
  assertNoError(error);
  return (data ?? []) as FocusSession[];
}

export async function createFocusSession(
  client: SupabaseClient,
  input: Omit<FocusSession, "id" | "created_at"> & { id?: string; created_at?: string },
) {
  const { data, error } = await client
    .from("focus_sessions")
    .insert({
      id: input.id,
      user_id: input.user_id,
      workspace_id: input.workspace_id,
      task_id: input.task_id,
      mode: input.mode,
      kind: input.kind,
      planned_seconds: input.planned_seconds,
      elapsed_seconds: input.elapsed_seconds,
      notes: input.notes,
      started_at: input.started_at,
      ended_at: input.ended_at,
    })
    .select("*")
    .single();
  assertNoError(error);
  return data as FocusSession;
}

export async function saveDateTimePreferences(
  client: SupabaseClient,
  userId: string,
  preferences: DateTimePreferences,
) {
  const { error } = await client
    .from("user_date_time_preferences")
    .upsert({
      user_id: userId,
      ...preferenceModelToRow(preferences),
      updated_at: new Date().toISOString(),
    });
  assertNoError(error);
  return preferences ?? DEFAULT_DATE_TIME_PREFERENCES;
}

export async function loadWorkspaceBundle(
  client: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceBundle> {
  const [
    membersResult,
    labelsResult,
    tasksResult,
    connectorsResult,
    preferencesResult,
    sectionsResult,
    placementsResult,
    customTaskViewsResult,
    taskSystemViewPreferencesResult,
    matrixQuadrantPreferencesResult,
    userGroupsResult,
    userGroupMembersResult,
    labelPermissionLevelsResult,
    userLabelOrderResult,
    userSidebarMembersResult,
    labelTaskCountsResult,
  ] = await Promise.all([
    client
      .from("workspace_members")
      .select("workspace_id, user_id, role")
      .eq("workspace_id", workspaceId),
    client.from("labels").select("*").eq("workspace_id", workspaceId).order("position"),
    (async () => {
      const page = await loadWorkspaceTaskPage(client, workspaceId);
      const { data: deleted, error } = await client
        .from("tasks")
        .select(TASK_DETAIL_SELECT)
        .eq("workspace_id", workspaceId)
        .not("deleted_at", "is", null)
        .gte("deleted_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order("deleted_at", { ascending: false })
        .limit(WORKSPACE_TASK_PAGE_SIZE);
      assertNoError(error);
      const byId = new Map([...page.tasks, ...normalizeTaskRows((deleted ?? []) as TaskRow[])]
        .map((task) => [task.id, task]));
      return { data: [...byId.values()], error: null };
    })(),
    client
      .from("connector_instances")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    client
      .from("task_list_preferences")
      .select("*")
      .eq("workspace_id", workspaceId),
    client
      .from("task_sections")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: true }),
    client
      .from("task_list_placements")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: true }),
    client
      .from("custom_task_views")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    client
      .from("task_system_view_preferences")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: true }),
    client
      .from("task_matrix_quadrants")
      .select("*")
      .eq("workspace_id", workspaceId),
    client
      .from("user_groups")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    client
      .from("user_group_members")
      .select("group_id, workspace_id, user_id, added_at")
      .eq("workspace_id", workspaceId),
    client.rpc("list_label_permission_levels", { p_workspace_id: workspaceId }),
    client
      .from("user_label_order")
      .select("user_id, workspace_id, label_id, position")
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: true }),
    client
      .from("user_sidebar_members")
      .select("user_id, workspace_id, member_user_id, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    client.rpc("list_label_task_counts", { p_workspace_id: workspaceId }),
  ]);
  assertNoError(membersResult.error);
  assertNoError(labelsResult.error);
  assertNoError(tasksResult.error);
  assertNoError(connectorsResult.error);
  assertNoError(preferencesResult.error);
  assertNoError(sectionsResult.error);
  assertNoError(placementsResult.error);
  assertNoError(customTaskViewsResult.error);
  assertNoError(taskSystemViewPreferencesResult.error);
  assertNoError(matrixQuadrantPreferencesResult.error);
  assertNoError(userGroupsResult.error);
  assertNoError(userGroupMembersResult.error);
  assertNoError(labelPermissionLevelsResult.error);
  assertNoError(userLabelOrderResult.error);
  assertNoError(userSidebarMembersResult.error);
  assertNoError(labelTaskCountsResult.error);

  const memberIds = (membersResult.data ?? []).map((member) => member.user_id);
  const profilesResult = memberIds.length
    ? await client
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", memberIds)
    : { data: [], error: null };
  assertNoError(profilesResult.error);
  const profilesById = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id, profile]),
  );

  const connectors = (connectorsResult.data ?? []) as Connector[];
  const labelIds = (labelsResult.data ?? []).map((label) => label.id);
  const [labelUserAclsResult, labelGroupAclsResult] = labelIds.length
    ? await Promise.all([
        client
          .from("label_user_acl")
          .select("label_id, workspace_id, user_id, permission")
          .in("label_id", labelIds),
        client
          .from("label_group_acl")
          .select("label_id, workspace_id, group_id, permission")
          .in("label_id", labelIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  assertNoError(labelUserAclsResult.error);
  assertNoError(labelGroupAclsResult.error);
  const connectorIds = connectors.map((connector) => connector.id);
  const [runsResult, conflictsResult] =
    connectorIds.length > 0
      ? await Promise.all([
          client
            .from("sync_runs")
            .select("*")
            .in("connector_id", connectorIds)
            .order("created_at", { ascending: false })
            .limit(30),
          client
            .from("sync_conflicts")
            .select("*")
            .in("connector_id", connectorIds)
            .order("created_at", { ascending: false }),
        ])
      : [
          { data: [] as SyncRun[], error: null },
          { data: [] as SyncConflict[], error: null },
        ];
  assertNoError(runsResult.error);
  assertNoError(conflictsResult.error);

  return {
    members: (membersResult.data ?? []).map((row) => ({
      workspace_id: row.workspace_id,
      user_id: row.user_id,
      role: row.role,
      profile: profilesById.get(row.user_id),
    })) as Member[],
    userGroups: (userGroupsResult.data ?? []) as WorkspaceBundle["userGroups"],
    userGroupMembers: (userGroupMembersResult.data ?? []) as WorkspaceBundle["userGroupMembers"],
    labels: (labelsResult.data ?? []) as Label[],
    labelUserAcls: labelUserAclsResult.data ?? [],
    labelGroupAcls: labelGroupAclsResult.data ?? [],
    labelPermissionLevels: Object.fromEntries(
      (labelPermissionLevelsResult.data ?? []).map(
        (row: { label_id: string; permission_level: number }) => [
          row.label_id,
          row.permission_level === 2 ? 2 : 1,
        ],
      ),
    ),
    tasks: (tasksResult.data ?? []) as Task[],
    connectors,
    syncRuns: (runsResult.data ?? []) as SyncRun[],
    conflicts: (conflictsResult.data ?? []) as SyncConflict[],
    userLabelOrder: (userLabelOrderResult.data ?? []) as UserLabelOrder[],
    userSidebarMembers: (userSidebarMembersResult.data ?? []) as UserSidebarMember[],
    labelTaskCounts: Object.fromEntries(
      (labelTaskCountsResult.data ?? []).map(
        (row: { label_id: string; task_count: number }) => [row.label_id, row.task_count],
      ),
    ),
    taskListPreferences: (preferencesResult.data ?? []) as WorkspaceBundle["taskListPreferences"],
    customTaskViews: (customTaskViewsResult.data ?? []) as CustomTaskView[],
    taskSystemViewPreferences: (taskSystemViewPreferencesResult.data ?? []) as TaskSystemViewPreference[],
    matrixQuadrantPreferences: (matrixQuadrantPreferencesResult.data ?? []) as MatrixQuadrantPreference[],
    taskSections: (sectionsResult.data ?? []) as WorkspaceBundle["taskSections"],
    taskPlacements: (placementsResult.data ?? []) as WorkspaceBundle["taskPlacements"],
  };
}

export async function addUserSidebarMember(
  client: SupabaseClient,
  input: Pick<UserSidebarMember, "user_id" | "workspace_id" | "member_user_id">,
) {
  const { data, error } = await client
    .from("user_sidebar_members")
    .insert(input)
    .select("user_id, workspace_id, member_user_id, created_at")
    .single();
  assertNoError(error);
  return data as UserSidebarMember;
}

export async function removeUserSidebarMember(
  client: SupabaseClient,
  workspaceId: string,
  memberUserId: string,
) {
  const { error } = await client
    .from("user_sidebar_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("member_user_id", memberUserId);
  assertNoError(error);
}

export async function loadWorkspaceTasksPage(
  client: SupabaseClient,
  workspaceId: string,
  offset: number,
): Promise<WorkspaceTaskPage> {
  const { data, error } = await client
    .from("tasks")
    .select(TASK_DETAIL_SELECT)
    .eq("workspace_id", workspaceId)
    .or(`deleted_at.is.null,deleted_at.gte.${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()}`)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + WORKSPACE_TASK_PAGE_SIZE - 1);
  assertNoError(error);
  const tasks = normalizeTaskRows((data ?? []) as TaskRow[]);
  return {
    tasks,
    hasMore: tasks.length === WORKSPACE_TASK_PAGE_SIZE,
  };
}

/** Load one task for a DeepLink without requiring it to be in the first page. */
export async function loadWorkspaceTask(
  client: SupabaseClient,
  workspaceId: string,
  taskId: string,
): Promise<Task | null> {
  const { data, error } = await client
    .from("tasks")
    .select(TASK_DETAIL_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("id", taskId)
    .or(`deleted_at.is.null,deleted_at.gte.${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()}`)
    .maybeSingle();
  assertNoError(error);
  return data ? normalizeTaskRows([data as TaskRow])[0] ?? null : null;
}

export async function reorderChildLabels(
  client: SupabaseClient,
  parentId: string,
  orderedIds: string[],
) {
  const { error } = await client.rpc("reorder_child_labels", {
    p_parent_id: parentId,
    p_ordered_ids: orderedIds,
  });
  assertNoError(error);
}

export async function setUserTopLevelLabelOrder(
  client: SupabaseClient,
  workspaceId: string,
  orderedIds: string[],
) {
  const { error } = await client.rpc("set_user_top_level_label_order", {
    p_workspace_id: workspaceId,
    p_ordered_ids: orderedIds,
  });
  assertNoError(error);
}

export async function saveTaskSchedule(
  client: SupabaseClient,
  taskId: string,
  patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
  schedule: ReminderSchedule,
) {
  const { data, error } = await client.rpc("save_task_schedule", {
    p_task_id: taskId,
    p_due_at: patch.due_at,
    p_due_start_at: patch.due_start_at,
    p_due_is_all_day: patch.due_is_all_day,
    p_due_timezone: patch.due_timezone,
    p_reminders: schedule.reminders,
    p_persistent: schedule.persistent,
    p_recurrence: schedule.recurrence,
  });
  assertNoError(error);
  return (data ?? []) as TaskReminder[];
}

export async function saveTaskListPreference(
  client: SupabaseClient,
  preference: TaskListPreference,
) {
  const { data, error } = await client
    .from("task_list_preferences")
    .upsert(preference, { onConflict: "user_id,workspace_id,list_key" })
    .select("*")
    .single();
  assertNoError(error);
  return data as TaskListPreference;
}

export async function createCustomTaskView(
  client: SupabaseClient,
  input: {
    workspace_id: string;
    user_id: string;
    name: string;
    definition: CustomTaskViewDefinition;
    position?: number;
  },
) {
  const { data, error } = await client
    .from("custom_task_views")
    .insert({ ...input, name: input.name.trim() })
    .select("*")
    .single();
  assertNoError(error);
  return data as CustomTaskView;
}

export async function deleteCustomTaskView(
  client: SupabaseClient,
  viewId: string,
) {
  const { error } = await client
    .from("custom_task_views")
    .delete()
    .eq("id", viewId);
  assertNoError(error);
}

export async function saveTaskSystemViewPreference(
  client: SupabaseClient,
  preference: TaskSystemViewPreference,
) {
  const { data, error } = await client
    .from("task_system_view_preferences")
    .upsert(preference, { onConflict: "user_id,workspace_id,view_key" })
    .select("*")
    .single();
  assertNoError(error);
  return data as TaskSystemViewPreference;
}

export async function saveMatrixQuadrantPreference(
  client: SupabaseClient,
  preference: MatrixQuadrantPreference,
) {
  const { data, error } = await client
    .from("task_matrix_quadrants")
    .upsert(preference, { onConflict: "user_id,workspace_id,quadrant_key" })
    .select("*")
    .single();
  assertNoError(error);
  return data as MatrixQuadrantPreference;
}

export async function reorderSystemSmartViews(
  client: SupabaseClient,
  preferences: TaskSystemViewPreference[],
) {
  if (preferences.length === 0) return [] as TaskSystemViewPreference[];
  const { data, error } = await client
    .from("task_system_view_preferences")
    .upsert(preferences, { onConflict: "user_id,workspace_id,view_key" })
    .select("*");
  assertNoError(error);
  return (data ?? []) as TaskSystemViewPreference[];
}

export async function reorderCustomTaskViews(
  client: SupabaseClient,
  orderedIds: string[],
) {
  await Promise.all(orderedIds.map((id, position) =>
    client
      .from("custom_task_views")
      .update({ position })
      .eq("id", id)
      .then(({ error }) => {
        assertNoError(error);
      })));
}

export async function createTaskSection(
  client: SupabaseClient,
  input: Omit<TaskSection, "id" | "created_at" | "updated_at">,
) {
  const { data, error } = await client
    .from("task_sections")
    .insert(input)
    .select("*")
    .single();
  assertNoError(error);
  return data as TaskSection;
}

export async function updateTaskSection(
  client: SupabaseClient,
  sectionId: string,
  patch: Partial<Pick<TaskSection, "name" | "position">>,
) {
  const { data, error } = await client
    .from("task_sections")
    .update(patch)
    .eq("id", sectionId)
    .select("*")
    .single();
  assertNoError(error);
  return data as TaskSection;
}

export async function deleteTaskSection(client: SupabaseClient, sectionId: string) {
  const { error } = await client.from("task_sections").delete().eq("id", sectionId);
  assertNoError(error);
}

export async function setTaskListOrder(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    listKey: string;
    sectionId: string | null;
    taskIds: string[];
  },
) {
  const { error } = await client.rpc("set_task_list_order", {
    p_workspace_id: input.workspaceId,
    p_list_key: input.listKey,
    p_section_id: input.sectionId,
    p_task_ids: input.taskIds,
  });
  assertNoError(error);
}

function mapWorkspaceWriteError(error: {
  message: string;
  code?: string;
}): Error {
  if (error.message.includes("workspace_owner_quota_exceeded")) {
    return new Error("已达到可拥有的团队数量上限。");
  }
  if (error.code === "23505") {
    return new Error("团队 Slug 已被占用，请换一个。");
  }
  if (error.code === "23514") {
    return new Error("团队名称或 Slug 格式不正确。");
  }
  return new Error(error.message);
}

export async function createWorkspace(
  client: SupabaseClient,
  input: { name: string; slug?: string },
  userId: string,
) {
  const trimmedName = input.name.trim();
  const requestedSlug = input.slug === undefined
    ? suggestWorkspaceSlug(trimmedName)
    : normalizeWorkspaceSlug(input.slug);
  if (!isValidWorkspaceSlug(requestedSlug)) {
    throw new Error("团队 Slug 格式不正确。");
  }
  let slug = requestedSlug;
  const explicitSlug = input.slug !== undefined;

  for (let attempt = 0; attempt < (explicitSlug ? 1 : 3); attempt += 1) {
    const { data, error } = await client
      .from("workspaces")
      .insert({ name: trimmedName, slug, created_by: userId })
      .select()
      .single();
    if (!error) return data as Workspace;
    if (error.code !== "23505") throw mapWorkspaceWriteError(error);
    slug = `${suggestWorkspaceSlug(trimmedName).slice(0, 36)}-${crypto
      .randomUUID()
      .replace(/-/g, "")
      .slice(0, 6)}`;
  }

  throw new Error("团队 Slug 已被占用，请换一个。");
}

export async function deleteWorkspace(
  client: SupabaseClient,
  workspaceId: string,
  confirmationName: string,
) {
  const { data, error } = await client.functions.invoke("workspace-admin", {
    body: { action: "delete", workspaceId, confirmationName },
  });
  if (error) {
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : "团队暂时无法删除，请稍后重试。",
    );
  }
}

export async function updateWorkspace(
  client: SupabaseClient,
  workspaceId: string,
  patch: { name?: string; slug?: string },
) {
  const payload: { name?: string; slug?: string } = {};
  if (patch.name !== undefined) {
    payload.name = patch.name.trim();
  }
  if (patch.slug !== undefined) {
    const slug = normalizeWorkspaceSlug(patch.slug);
    if (!isValidWorkspaceSlug(slug)) {
      throw new Error("团队 Slug 格式不正确。");
    }
    payload.slug = slug;
  }

  const { data, error } = await client
    .from("workspaces")
    .update(payload)
    .eq("id", workspaceId)
    .select()
    .single();
  if (error) throw mapWorkspaceWriteError(error);
  return data as Workspace;
}

export async function isWorkspaceSlugAvailable(
  client: SupabaseClient,
  slug: string,
  workspaceId?: string,
) {
  const normalized = normalizeWorkspaceSlug(slug);
  if (!isValidWorkspaceSlug(normalized)) return false;
  const { data, error } = await client.rpc("is_workspace_slug_available", {
    p_slug: normalized,
    p_workspace_id: workspaceId ?? null,
  });
  assertNoError(error);
  return Boolean(data);
}

export async function createTask(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    title: string;
    labelIds: string[];
    description?: string;
    dueAt?: string | null;
    dueTimezone?: string | null;
    estimateHours?: number | null;
    priority?: TaskPriority;
    kind?: TaskKind;
    assigneeId?: string | null;
    parentTaskId?: string | null;
    position?: number;
  },
) {
  if (input.parentTaskId) {
    const { data: userData, error: userError } = await client.auth.getUser();
    assertNoError(userError);
    const taskId = crypto.randomUUID();
    const { error } = await client.from("tasks").insert({
      id: taskId,
      workspace_id: input.workspaceId,
      parent_task_id: input.parentTaskId,
      position: input.position ?? 0,
      title: input.title,
      description: input.description ?? "",
      due_at: input.dueAt ?? null,
      due_timezone: input.dueTimezone ?? null,
      priority: input.priority ?? "low",
      kind: "todo",
      created_by: userData.user?.id,
      estimate_hours: input.estimateHours ?? null,
    });
    assertNoError(error);

    // Do not use INSERT ... RETURNING here. The task SELECT policy resolves
    // visibility by querying the tasks table itself, which cannot see the
    // just-inserted row during RETURNING. Fetching it in a separate statement
    // keeps the insert compatible with the production RLS policy.
    const { data, error: selectError } = await client
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .single();
    assertNoError(selectError);
    return normalizeTaskRow(data as TaskRow);
  }
  const { data, error } = await client.rpc("create_task_with_labels", {
    p_workspace_id: input.workspaceId,
    p_title: input.title,
    p_label_ids: input.labelIds,
    p_description: input.description ?? "",
    p_due_at: input.dueAt ?? null,
    p_due_timezone: input.dueTimezone ?? null,
    p_priority: input.priority ?? "low",
    p_assignee_id: input.assigneeId ?? null,
    p_kind: input.kind ?? "todo",
  });
  assertNoError(error);
  const created = data as Task;
  if (input.estimateHours == null) {
    return {
      ...created,
      estimate_hours: coerceHours(created.estimate_hours),
      actual_hours: coerceHours(created.actual_hours),
      estimate_pomodoros: coercePomodoros(created.estimate_pomodoros),
      actual_pomodoros: coercePomodoros(created.actual_pomodoros),
      description_mentions: created.description_mentions ?? [],
      parent_task_id: created.parent_task_id ?? null,
      position: created.position ?? 0,
      label_ids: created.label_ids ?? input.labelIds,
      participant_ids: created.participant_ids ?? [],
      children: [],
      reminders: created.reminders ?? [],
      reminder_persistent: created.reminder_persistent ?? false,
      dependencies: created.dependencies ?? [],
    };
  }

  const { data: updated, error: updateError } = await client
    .from("tasks")
    .update({ estimate_hours: input.estimateHours })
    .eq("id", created.id)
    .select("*")
    .single();
  assertNoError(updateError);
  const next = { ...created, ...updated } as Task;
  return {
    ...next,
    estimate_hours: coerceHours(next.estimate_hours),
    actual_hours: coerceHours(next.actual_hours),
    estimate_pomodoros: coercePomodoros(next.estimate_pomodoros),
    actual_pomodoros: coercePomodoros(next.actual_pomodoros),
    description_mentions: next.description_mentions ?? [],
    parent_task_id: next.parent_task_id ?? null,
    position: next.position ?? 0,
    label_ids: next.label_ids ?? input.labelIds,
    participant_ids: next.participant_ids ?? [],
    children: [],
    reminders: next.reminders ?? [],
    reminder_persistent: next.reminder_persistent ?? false,
    dependencies: next.dependencies ?? [],
  };
}

export async function moveTask(
  client: SupabaseClient,
  taskId: string,
  parentTaskId: string | null,
  position = 0,
) {
  const { data, error } = await client.rpc("move_task", {
    p_task_id: taskId,
    p_parent_task_id: parentTaskId,
    p_position: position,
  });
  assertNoError(error);
  return data as Task;
}

export async function listTaskAssigneeIds(
  client: SupabaseClient,
  taskId: string,
) {
  const { data, error } = await client.rpc("list_task_assignees", {
    p_task_id: taskId,
  });
  assertNoError(error);
  return (data ?? []).map((row: { user_id: string }) => row.user_id);
}

export async function assignTask(
  client: SupabaseClient,
  taskId: string,
  target: AssigneeTarget,
) {
  const { data, error } = await client.rpc("assign_task", {
    p_task_id: taskId,
    p_assignee_id: target.kind === "user" ? target.userId : null,
    p_cli_assignee: target.kind === "cli" ? target.tool : null,
  });
  assertNoError(error);
  return data as Task;
}

export async function toggleTaskLabel(
  client: SupabaseClient,
  taskId: string,
  labelId: string,
  selected: boolean,
) {
  const { error } = selected
    ? await client.from("task_labels").insert({ task_id: taskId, label_id: labelId })
    : await client
        .from("task_labels")
        .delete()
        .eq("task_id", taskId)
        .eq("label_id", labelId);
  assertNoError(error);
}

export async function toggleTaskParticipant(
  client: SupabaseClient,
  taskId: string,
  userId: string,
  selected: boolean,
) {
  const { error } = selected
    ? await client.from("task_participants").insert({ task_id: taskId, user_id: userId })
    : await client
        .from("task_participants")
        .delete()
        .eq("task_id", taskId)
        .eq("user_id", userId);
  assertNoError(error);
}

export async function insertTaskDependency(
  client: SupabaseClient,
  row: {
    id: string;
    workspaceId: string;
    taskId: string;
    dependsOnTaskId: string;
  },
) {
  const { data, error } = await client
    .from("task_dependencies")
    .insert({
      id: row.id,
      workspace_id: row.workspaceId,
      task_id: row.taskId,
      depends_on_task_id: row.dependsOnTaskId,
    })
    .select("*")
    .single();
  assertNoError(error);
  return data as TaskDependency;
}

export async function deleteTaskDependency(client: SupabaseClient, dependencyId: string) {
  const { error } = await client.from("task_dependencies").delete().eq("id", dependencyId);
  assertNoError(error);
}

export async function formatTaskWithAi(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    taskId: string;
    nowIso: string;
    timeZone: string;
  },
): Promise<AiFormatSuggestion> {
  const {
    data: { session },
  } = await client.auth.getSession();
  const accessToken = session?.access_token?.trim();
  if (!accessToken) {
    throw new Error("请先登录后再使用智能格式化。");
  }

  const { data, error } = await client.functions.invoke("ai-task-format", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Cache-Control": "no-store",
    },
    body: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      nowIso: input.nowIso,
      timeZone: input.timeZone,
      clientRequestId: crypto.randomUUID(),
    },
  });
  if (error) {
    const message = await edgeFunctionErrorMessage(
      error,
      data,
      "智能格式化失败，请稍后重试。",
    );
    if (/authentication required/i.test(message)) {
      throw new Error("登录已失效，请重新登录后再使用智能格式化。");
    }
    throw new Error(message);
  }
  if (data && typeof data === "object" && data !== null && "error" in data) {
    const message = (data as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) {
      if (/authentication required/i.test(message)) {
        throw new Error("登录已失效，请重新登录后再使用智能格式化。");
      }
      throw new Error(message.trim());
    }
  }
  const suggestion = normalizeAiFormatSuggestion(data);
  if (!suggestion) {
    throw new Error("未能生成可用的格式化建议，请完善任务内容后重试。");
  }
  return suggestion;
}
