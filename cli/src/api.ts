import type { SupabaseClient, User } from "@supabase/supabase-js";
import { basename, extname } from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";
import { CliError } from "./errors.js";
import {
  getDefaultWorkspace,
  setDefaultWorkspace,
} from "./storage.js";
import {
  invalidateTaskCachesForWorkspace,
  invalidateWorkspaceListCaches,
  readThroughCache,
  taskCacheKey,
  taskListCacheKey,
  workspaceCacheKey,
  type CacheReadOptions,
  type TaskListCacheOptions,
} from "./cache.js";
import { getActiveServiceKey } from "./storage.js";
import type {
  FocusSession,
  LabelAccessScope,
  LabelKind,
  RecurrenceRule,
  ReminderRule,
  TaskKind,
  TaskPriority,
  TaskSchedule,
  TaskStatus,
  WeeklyReport,
  WeeklyReportNotificationSummary,
  WeeklyReportStatus,
  WeeklyReportVisibility,
} from "./types.js";
import {
  assertWeeklyReportCanPublish,
  assertWeeklyReportSubjects,
  canCreateWeeklyReportForWeek,
} from "./validation.js";

type Workspace = { id: string; name: string; slug: string; role: string };
type ApiContext = { client: SupabaseClient; user: User };

async function invalidateTaskCache(workspaceId: string) {
  await invalidateTaskCachesForWorkspace(workspaceId, getActiveServiceKey() ?? "official").catch(() => undefined);
}

function throwError(error: { message: string; code?: string; details?: string } | null) {
  if (!error) return;
  const message = error.message.toLowerCase();
  if (message.includes("label_task_limit_exceeded")) {
    throw new CliError({
      type: "api",
      code: "label_task_limit_exceeded",
      message: "This tag already has the maximum number of tasks. Clean up tasks in the tag before adding more.",
      details: error.details,
    });
  }
  if (
    error.code === "401"
    || error.code === "PGRST301"
    || message.includes("jwt")
    || message.includes("unauthorized")
    || message.includes("token is expired")
  ) {
    throw new CliError({
      type: "authentication",
      code: "invalid_session",
      message: "The saved session is no longer valid",
      hint: "Run `anttodo auth login` again",
      details: error.details,
    });
  }
  throw new CliError({
    type: error.code === "42501" ? "authorization" : "api",
    code: error.code ?? "supabase_error",
    message: error.message,
    details: error.details,
  });
}

function requireRow<T>(data: T | null, resource: string): T {
  if (data) return data;
  throw new CliError({ type: "not_found", code: "not_found", message: `${resource} not found or not accessible` });
}

async function listWorkspacesFromApi({ client, user }: ApiContext): Promise<Workspace[]> {
  const { data: memberships, error } = await client
    .from("workspace_members")
    .select("role, workspace_id")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });
  throwError(error);
  const workspaceIds = [...new Set((memberships ?? []).map((row) => row.workspace_id))];
  const { data: workspaceRows, error: workspacesError } = workspaceIds.length
    ? await client.from("workspaces").select("id, name, slug").in("id", workspaceIds)
    : { data: [], error: null };
  throwError(workspacesError);
  const workspacesById = new Map(
    (workspaceRows ?? []).map((workspace) => [workspace.id, workspace]),
  );
  return (memberships ?? []).flatMap((row) => {
    const workspace = workspacesById.get(row.workspace_id);
    return workspace ? [{ ...workspace, role: row.role }] : [];
  });
}

export async function listWorkspaces(
  context: ApiContext,
  cache?: CacheReadOptions,
): Promise<Workspace[]> {
  if (!cache) return listWorkspacesFromApi(context);
  return readThroughCache(
    workspaceCacheKey(cache.userId),
    cache,
    () => listWorkspacesFromApi(context),
  );
}

export async function resolveWorkspace(
  context: ApiContext,
  requested?: string,
  cache?: CacheReadOptions,
): Promise<Workspace> {
  const workspaces = await listWorkspaces(context, cache);
  if (!workspaces.length) {
    throw new CliError({ type: "not_found", code: "no_workspace", message: "No AntTodo workspace is available" });
  }
  const configured = requested ?? await getDefaultWorkspace(context.user.id);
  if (configured) {
    const match = workspaces.find((workspace) => workspace.id === configured || workspace.slug === configured);
    if (match) return match;
    if (requested) {
      throw new CliError({
        type: "not_found",
        code: "workspace_not_found",
        message: `Workspace ${requested} was not found or is not accessible`,
        details: { workspaces },
      });
    }
  }
  if (workspaces.length === 1) {
    await setDefaultWorkspace(context.user.id, workspaces[0].id);
    return workspaces[0];
  }
  throw new CliError({
    type: "configuration",
    code: "workspace_required",
    message: "Choose a default workspace before running this command",
    hint: "Run `anttodo workspace use <id|slug>` or pass --workspace",
    details: { workspaces },
  });
}

export async function useWorkspace(context: ApiContext, idOrSlug: string) {
  const workspace = await resolveWorkspace(context, idOrSlug);
  await setDefaultWorkspace(context.user.id, workspace.id);
  return workspace;
}

const taskSelect = "*, task_labels(label_id), task_participants(user_id), task_reminders(*), task_reminder_settings(persistent), task_dependencies:task_dependencies!task_dependencies_task_id_fkey(*)";

function normalizeTask(row: Record<string, unknown>) {
  const allReminders = (row.task_reminders ?? []) as Array<Record<string, unknown>>;
  return {
    ...row,
    label_ids: ((row.task_labels ?? []) as Array<{ label_id: string }>).map((item) => item.label_id),
    participant_ids: ((row.task_participants ?? []) as Array<{ user_id: string }>).map((item) => item.user_id),
    reminders: allReminders,
    dependencies: row.task_dependencies ?? [],
    reminder_persistent: Array.isArray(row.task_reminder_settings)
      ? Boolean((row.task_reminder_settings as Array<{ persistent: boolean }>)[0]?.persistent)
      : Boolean((row.task_reminder_settings as { persistent?: boolean } | null)?.persistent),
    task_labels: undefined,
    task_participants: undefined,
    task_reminders: undefined,
    task_reminder_settings: undefined,
  };
}

async function listTasksFromApi(
  client: SupabaseClient,
  workspaceId: string,
  kind: "todo" | "note",
  options: {
    status?: TaskStatus | "all";
    priority?: TaskPriority;
    assignee?: string;
    tag?: string;
    search?: string;
    trash?: boolean;
    includeTrash?: boolean;
    parent?: string | null;
    limit: number;
    offset: number;
  },
) {
  let allowedTaskIds: string[] | null = null;
  if (options.tag) {
    const { data, error } = await client.from("task_labels").select("task_id").eq("label_id", options.tag);
    throwError(error);
    allowedTaskIds = (data ?? []).map((row) => row.task_id);
    if (!allowedTaskIds.length) return [];
  }
  let query = client
    .from("tasks")
    .select(taskSelect)
    .eq("workspace_id", workspaceId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .range(options.offset, options.offset + options.limit - 1);
  if (options.trash) query = query.not("deleted_at", "is", null);
  else if (!options.includeTrash) query = query.is("deleted_at", null);
  if (options.status && options.status !== "all") query = query.eq("status", options.status);
  if (options.priority) query = query.eq("priority", options.priority);
  if (options.assignee) query = query.eq("assignee_id", options.assignee);
  if (options.parent) query = query.eq("parent_task_id", options.parent);
  else if (options.parent === null) query = query.is("parent_task_id", null);
  if (options.search?.trim()) {
    const pattern = options.search.trim().replace(/[(),]/g, " ");
    query = query.or(`title.ilike.%${pattern}%,description.ilike.%${pattern}%`);
  }
  if (allowedTaskIds) query = query.in("id", allowedTaskIds);
  const { data, error } = await query;
  throwError(error);
  return (data ?? []).map((row) => normalizeTask(row as Record<string, unknown>));
}

export async function listTasks(
  client: SupabaseClient,
  workspaceId: string,
  kind: "todo" | "note",
  options: TaskListCacheOptions,
  cache?: CacheReadOptions,
) {
  if (!cache) return listTasksFromApi(client, workspaceId, kind, options);
  return readThroughCache(
    taskListCacheKey(cache.userId, workspaceId, kind, options),
    cache,
    () => listTasksFromApi(client, workspaceId, kind, options),
  );
}

async function getTaskFromApi(client: SupabaseClient, workspaceId: string, id: string, kind: "todo" | "note") {
  const { data, error } = await client
    .from("tasks")
    .select(taskSelect)
    .eq("workspace_id", workspaceId)
    .eq("kind", kind)
    .eq("id", id)
    .maybeSingle();
  throwError(error);
  return normalizeTask(requireRow(data as Record<string, unknown> | null, kind === "note" ? "Note" : "Task"));
}

export async function getTask(
  client: SupabaseClient,
  workspaceId: string,
  id: string,
  kind: "todo" | "note",
  cache?: CacheReadOptions,
) {
  if (!cache) return getTaskFromApi(client, workspaceId, id, kind);
  return readThroughCache(
    taskCacheKey(cache.userId, workspaceId, kind, id),
    cache,
    () => getTaskFromApi(client, workspaceId, id, kind),
  );
}

export async function createFocusSession(
  client: SupabaseClient,
  input: {
    userId: string;
    workspaceId: string;
    taskId: string | null;
    mode: FocusSession["mode"];
    plannedSeconds: number;
    elapsedSeconds: number;
    notes: string | null;
    startedAt: string;
    endedAt: string;
  },
) {
  if (input.taskId) await getTask(client, input.workspaceId, input.taskId, "todo");
  const { data, error } = await client
    .from("focus_sessions")
    .insert({
      user_id: input.userId,
      workspace_id: input.workspaceId,
      task_id: input.taskId,
      mode: input.mode,
      kind: "focus",
      planned_seconds: input.plannedSeconds,
      elapsed_seconds: input.elapsedSeconds,
      notes: input.notes,
      started_at: input.startedAt,
      ended_at: input.endedAt,
    })
    .select("*")
    .single();
  throwError(error);
  return requireRow(data as FocusSession | null, "Focus session");
}

export async function createTask(client: SupabaseClient, input: {
  workspaceId: string;
  kind: "todo" | "note";
  title: string;
  description?: string;
  labelIds: string[];
  priority?: TaskPriority;
  dueAt?: string | null;
  dueTimezone?: string | null;
  assigneeId?: string | null;
  parentTaskId?: string | null;
  position?: number;
}) {
  if (input.parentTaskId) {
    const { data: authData, error: authError } = await client.auth.getUser();
    throwError(authError);
    const taskId = crypto.randomUUID();
    const { error } = await client.from("tasks").insert({
      id: taskId,
      workspace_id: input.workspaceId,
      parent_task_id: input.parentTaskId,
      position: input.position ?? 0,
      title: input.title.trim(),
      description: input.description ?? "",
      priority: input.priority ?? "low",
      due_at: input.dueAt ?? null,
      due_timezone: input.dueTimezone ?? null,
      created_by: authData.user?.id,
    });
    throwError(error);
    const { data, error: selectError } = await client
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .single();
    throwError(selectError);
    await invalidateTaskCache(input.workspaceId);
    return requireRow(data, "Task");
  }
  const { data, error } = await client.rpc("create_task_with_labels", {
    p_workspace_id: input.workspaceId,
    p_title: input.title.trim(),
    p_label_ids: input.labelIds,
    p_description: input.description ?? "",
    p_due_at: input.dueAt ?? null,
    p_due_timezone: input.dueTimezone ?? null,
    p_priority: input.kind === "note" ? "none" : input.priority ?? "low",
    p_assignee_id: input.kind === "note" ? null : input.assigneeId ?? null,
    p_kind: input.kind,
  });
  throwError(error);
  await invalidateTaskCache(input.workspaceId);
  return data;
}

export async function moveTask(
  client: SupabaseClient,
  workspaceId: string,
  taskId: string,
  parentTaskId: string | null,
) {
  await getTask(client, workspaceId, taskId, "todo");
  const { data, error } = await client.rpc("move_task", {
    p_task_id: taskId,
    p_parent_task_id: parentTaskId,
    p_position: 0,
  });
  throwError(error);
  await invalidateTaskCache(workspaceId);
  return data;
}

export async function assignTask(client: SupabaseClient, workspaceId: string, taskId: string, userId: string | null) {
  await getTask(client, workspaceId, taskId, "todo");
  let result = await client.rpc("assign_task", {
    p_task_id: taskId,
    p_assignee_id: userId,
    p_cli_assignee: null,
  });
  if (result.error?.code === "PGRST202") {
    result = await client.rpc("assign_task", {
      p_task_id: taskId,
      p_assignee_id: userId,
    });
  }
  throwError(result.error);
  await invalidateTaskCache(workspaceId);
  return result.data;
}

export async function setTaskPriority(
  client: SupabaseClient,
  workspaceId: string,
  taskId: string,
  priority: TaskPriority,
) {
  await getTask(client, workspaceId, taskId, "todo");
  const { data, error } = await client.from("tasks").update({ priority }).eq("id", taskId).select("*").maybeSingle();
  throwError(error);
  await invalidateTaskCache(workspaceId);
  return requireRow(data, "Task");
}

export async function setTaskDueTime(
  client: SupabaseClient,
  workspaceId: string,
  taskId: string,
  dueAt: string | null,
  dueTimezone: string | null,
) {
  const task = await getTask(client, workspaceId, taskId, "todo") as Record<string, unknown>;
  const reminders = (task.reminders as Array<Record<string, unknown>>).map((reminder) => ({
    anchor: reminder.anchor,
    offset_value: reminder.offset_value,
    offset_unit: reminder.offset_unit,
    local_time: reminder.local_time,
  }));
  const { error } = await client.rpc("save_task_schedule", {
    p_task_id: taskId,
    p_due_at: dueAt,
    p_due_start_at: null,
    p_due_is_all_day: false,
    p_due_timezone: dueAt ? dueTimezone : null,
    p_reminders: dueAt ? reminders : [],
    p_persistent: dueAt ? Boolean(task.reminder_persistent) : false,
    p_recurrence: dueAt ? task.recurrence : null,
  });
  throwError(error);
  await invalidateTaskCache(workspaceId);
  return getTask(client, workspaceId, taskId, "todo");
}

export async function softDeleteTask(client: SupabaseClient, workspaceId: string, taskId: string, kind: "todo" | "note") {
  await getTask(client, workspaceId, taskId, kind);
  const { data, error } = await client
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", taskId)
    .select("*")
    .maybeSingle();
  throwError(error);
  await invalidateTaskCache(workspaceId);
  return requireRow(data, kind === "note" ? "Note" : "Task");
}

export async function listTags(client: SupabaseClient, workspaceId: string) {
  const { data, error } = await client.from("labels").select("*").eq("workspace_id", workspaceId).order("position");
  throwError(error);
  return (data ?? []).filter((tag) => !tag.is_system);
}

export async function getTag(client: SupabaseClient, workspaceId: string, id: string) {
  const { data, error } = await client.from("labels").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  throwError(error);
  return requireRow(data, "Tag");
}

export async function createTag(client: SupabaseClient, userId: string, input: {
  workspaceId: string;
  name: string;
  color: string;
  parentId: string | null;
  kind: LabelKind;
  viewScope: LabelAccessScope;
  manageScope: LabelAccessScope;
  viewSubjectIds: string[];
  manageSubjectIds: string[];
}) {
  let kind = input.kind;
  let viewScope = input.viewScope;
  let manageScope = input.manageScope;
  if (input.parentId) {
    const parent = await getTag(client, input.workspaceId, input.parentId) as { kind: LabelKind };
    kind = parent.kind;
    viewScope = "inherit";
    manageScope = "inherit";
  }
  const { data, error } = await client.rpc("create_label_with_access", {
    p_workspace_id: input.workspaceId,
    p_parent_id: input.parentId,
    p_name: input.name.trim(),
    p_color: input.color,
    p_kind: kind,
    p_view_scope: viewScope,
    p_manage_scope: manageScope,
    p_view_subject_ids: kind === "team" && ["users", "groups"].includes(viewScope) ? input.viewSubjectIds : [],
    p_manage_subject_ids: kind === "team" && ["users", "groups"].includes(manageScope)
      ? input.manageSubjectIds.length ? input.manageSubjectIds : [userId]
      : [],
    p_inherit_permissions: Boolean(input.parentId),
  });
  throwError(error);
  await invalidateTaskCache(input.workspaceId);
  return data;
}

export async function tagDeletePreview(client: SupabaseClient, workspaceId: string, id: string) {
  const root = await getTag(client, workspaceId, id);
  const tags = await listTags(client, workspaceId) as Array<{ id: string; parent_id: string | null }>;
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const tag of tags) {
      if (tag.parent_id && ids.has(tag.parent_id) && !ids.has(tag.id)) {
        ids.add(tag.id);
        changed = true;
      }
    }
  }
  const { data: taskLinks, error } = await client
    .from("task_labels")
    .select("task_id")
    .in("label_id", [...ids]);
  throwError(error);
  const affectedTaskCount = new Set((taskLinks ?? []).map((link) => link.task_id)).size;
  return { tag: root, descendantCount: ids.size - 1, affectedTaskCount };
}

export async function deleteTag(client: SupabaseClient, workspaceId: string, id: string) {
  const preview = await tagDeletePreview(client, workspaceId, id);
  const { data, error } = await client.from("labels").delete().eq("id", id).select("id").maybeSingle();
  throwError(error);
  requireRow(data, "Tag");
  await invalidateTaskCache(workspaceId);
  return preview;
}

export async function listUsers(client: SupabaseClient, workspaceId: string) {
  const { data: members, error } = await client
    .from("workspace_members")
    .select("workspace_id, user_id, role")
    .eq("workspace_id", workspaceId)
    .order("joined_at");
  throwError(error);
  const ids = (members ?? []).map((member) => member.user_id);
  const profilesResult = ids.length
    ? await client.from("profiles").select("id, display_name, avatar_url").in("id", ids)
    : { data: [], error: null };
  throwError(profilesResult.error);
  const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  return (members ?? []).map((member) => ({
    user_id: member.user_id,
    display_name: profiles.get(member.user_id)?.display_name ?? "",
    avatar_url: profiles.get(member.user_id)?.avatar_url ?? null,
    role: member.role,
  }));
}

type TaskPatch = {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  deleted_at?: string | null;
  completed_at?: string | null;
};

export async function updateTask(
  client: SupabaseClient,
  workspaceId: string,
  taskId: string,
  kind: TaskKind,
  patch: TaskPatch,
  labelIds?: string[],
) {
  await getTask(client, workspaceId, taskId, kind);
  if (Object.keys(patch).length) {
    const { error } = await client.from("tasks").update(patch).eq("id", taskId);
    throwError(error);
  }
  if (labelIds) {
    const { error: removeError } = await client.from("task_labels").delete().eq("task_id", taskId);
    throwError(removeError);
    if (labelIds.length) {
      const { error: addError } = await client.from("task_labels").insert(
        labelIds.map((labelId) => ({ task_id: taskId, label_id: labelId })),
      );
      throwError(addError);
    }
  }
  const result = await getTask(client, workspaceId, taskId, kind);
  await invalidateTaskCache(workspaceId);
  return result;
}

export async function setTaskStatus(
  client: SupabaseClient,
  workspaceId: string,
  taskId: string,
  kind: TaskKind,
  status: TaskStatus,
) {
  return updateTask(client, workspaceId, taskId, kind, {
    status,
    completed_at: status === "completed" ? new Date().toISOString() : null,
  });
}

export async function restoreTask(client: SupabaseClient, workspaceId: string, taskId: string, kind: TaskKind) {
  return updateTask(client, workspaceId, taskId, kind, {
    deleted_at: null,
    status: "open",
    completed_at: null,
  });
}

export async function purgeTask(client: SupabaseClient, workspaceId: string, taskId: string, kind: TaskKind) {
  const task = await getTask(client, workspaceId, taskId, kind) as Record<string, unknown>;
  if (!task.deleted_at) {
    throw new CliError({ type: "validation", code: "task_not_trashed", message: "Only trashed items can be permanently deleted" });
  }
  const { data, error } = await client.from("tasks").delete().eq("id", taskId).select("id").maybeSingle();
  throwError(error);
  await invalidateTaskCache(workspaceId);
  return requireRow(data, kind === "note" ? "Note" : "Task");
}

export async function bulkTaskAction(
  client: SupabaseClient,
  workspaceId: string,
  taskIds: string[],
  action: "complete" | "cancel" | "restore" | "delete" | "purge" | "set-priority" | "assign",
  options: { priority?: TaskPriority; assigneeId?: string | null } = {},
) {
  const results: Array<{ id: string; ok: boolean; data?: unknown; error?: string }> = [];
  for (const taskId of taskIds) {
    try {
      let data: unknown;
      if (action === "complete") data = await setTaskStatus(client, workspaceId, taskId, "todo", "completed");
      else if (action === "cancel") data = await setTaskStatus(client, workspaceId, taskId, "todo", "cancelled");
      else if (action === "restore") data = await restoreTask(client, workspaceId, taskId, "todo");
      else if (action === "delete") data = await softDeleteTask(client, workspaceId, taskId, "todo");
      else if (action === "purge") data = await purgeTask(client, workspaceId, taskId, "todo");
      else if (action === "set-priority") data = await setTaskPriority(client, workspaceId, taskId, options.priority ?? "none");
      else data = await assignTask(client, workspaceId, taskId, options.assigneeId ?? null);
      results.push({ id: taskId, ok: true, data });
    } catch (error) {
      results.push({ id: taskId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

export async function saveTaskSchedule(
  client: SupabaseClient,
  workspaceId: string,
  taskId: string,
  schedule: TaskSchedule,
) {
  const currentTask = await getTask(client, workspaceId, taskId, "todo") as Record<string, unknown>;
  const dueAt = schedule.dueAt;
  const { data, error } = await client.rpc("save_task_schedule", {
    p_task_id: taskId,
    p_due_at: dueAt,
    p_due_start_at: schedule.dueStartAt ?? null,
    p_due_is_all_day: Boolean(schedule.dueIsAllDay),
    p_due_timezone: dueAt ? schedule.dueTimezone ?? currentTask.due_timezone ?? null : null,
    p_reminders: schedule.reminders,
    p_persistent: schedule.persistent,
    p_recurrence: schedule.recurrence,
  });
  throwError(error);
  const updatedTask = await getTask(client, workspaceId, taskId, "todo");
  await invalidateTaskCache(workspaceId);
  return { task: updatedTask, reminders: data ?? [] };
}

export async function updateTag(
  client: SupabaseClient,
  workspaceId: string,
  tagId: string,
  patch: { name?: string; color?: string; parentId?: string | null; viewScope?: LabelAccessScope; manageScope?: LabelAccessScope; viewSubjectIds?: string[]; manageSubjectIds?: string[] },
) {
  const current = await getTag(client, workspaceId, tagId) as Record<string, unknown>;
  const labelKind = (current.kind ?? "private") as LabelKind;
  const viewScope = patch.viewScope ?? (current.view_scope as LabelAccessScope ?? "all");
  const manageScope = patch.manageScope ?? (current.manage_scope as LabelAccessScope ?? "users");
  const [userAcl, groupAcl] = await Promise.all([
    client.from("label_user_acl").select("user_id, permission").eq("label_id", tagId),
    client.from("label_group_acl").select("group_id, permission").eq("label_id", tagId),
  ]);
  throwError(userAcl.error); throwError(groupAcl.error);
  const existingViewUsers = (userAcl.data ?? []).filter((row) => ["view", "edit"].includes(row.permission)).map((row) => row.user_id);
  const existingManageUsers = (userAcl.data ?? []).filter((row) => row.permission === "edit").map((row) => row.user_id);
  const existingViewGroups = (groupAcl.data ?? []).filter((row) => ["view", "edit"].includes(row.permission)).map((row) => row.group_id);
  const existingManageGroups = (groupAcl.data ?? []).filter((row) => row.permission === "edit").map((row) => row.group_id);
  const viewSubjectIds = patch.viewSubjectIds ?? (viewScope === "groups" ? existingViewGroups : existingViewUsers);
  const manageSubjectIds = patch.manageSubjectIds ?? (manageScope === "groups" ? existingManageGroups : existingManageUsers);
  if (patch.parentId) {
    let cursor: string | null = patch.parentId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === tagId || visited.has(cursor)) {
        throw new CliError({ type: "validation", code: "label_cycle", message: "A tag cannot be moved under itself or its descendants" });
      }
      visited.add(cursor);
      const parent = await getTag(client, workspaceId, cursor) as { parent_id?: string | null };
      cursor = parent.parent_id ?? null;
    }
  }
  const { data, error } = await client.rpc("update_label_with_access", {
    p_label_id: tagId,
    p_name: patch.name ?? String(current.name),
    p_color: patch.color ?? String(current.color),
    p_kind: labelKind,
    p_view_scope: viewScope,
    p_manage_scope: manageScope,
    p_view_subject_ids: viewScope === "users" ? viewSubjectIds : viewScope === "groups" ? viewSubjectIds : [],
    p_manage_subject_ids: manageScope === "users" ? manageSubjectIds : manageScope === "groups" ? manageSubjectIds : [],
    p_inherit_permissions: Boolean(current.parent_id),
  });
  throwError(error);
  if (patch.parentId !== undefined && patch.parentId !== current.parent_id) {
    const { error: moveError } = await client.from("labels").update({ parent_id: patch.parentId }).eq("id", tagId);
    throwError(moveError);
  }
  const result = data ?? await getTag(client, workspaceId, tagId);
  await invalidateTaskCache(workspaceId);
  return result;
}

export async function reorderTags(client: SupabaseClient, workspaceId: string, parentId: string | null, orderedIds: string[]) {
  if (parentId) {
    const { error } = await client.rpc("reorder_child_labels", { p_parent_id: parentId, p_ordered_ids: orderedIds });
    throwError(error);
  } else {
    const { error } = await client.rpc("set_user_top_level_label_order", { p_workspace_id: workspaceId, p_ordered_ids: orderedIds });
    throwError(error);
  }
  const result = await listTags(client, workspaceId);
  await invalidateTaskCache(workspaceId);
  return result;
}

export async function listUserGroups(client: SupabaseClient, workspaceId: string) {
  const { data, error } = await client.from("user_groups").select("*").eq("workspace_id", workspaceId).order("name");
  throwError(error);
  const groups = data ?? [];
  if (!groups.length) return [];
  const { data: members, error: membersError } = await client.from("user_group_members").select("group_id, user_id, added_at").eq("workspace_id", workspaceId).in("group_id", groups.map((group) => group.id));
  throwError(membersError);
  return groups.map((group) => ({ ...group, members: (members ?? []).filter((member) => member.group_id === group.id) }));
}

type WeeklyReportRow = Omit<WeeklyReport,
  "user_acl_ids" | "group_acl_ids" | "notification_group_ids" | "notification_summary">;

function weeklyReportNotificationSummary(
  revision: number,
  deliveries: Array<{ notification_group_id: unknown; status: unknown }>,
  groupNames: Map<string, string>,
): WeeklyReportNotificationSummary | null {
  if (!deliveries.length) return null;
  const failed = deliveries.filter((item) => item.status === "failed");
  return {
    revision: Number(revision),
    total: deliveries.length,
    sent: deliveries.filter((item) => item.status === "sent").length,
    failed: failed.length,
    pending: deliveries.filter((item) => item.status === "pending" || item.status === "sending").length,
    failed_group_names: failed.map((item) =>
      groupNames.get(String(item.notification_group_id)) ?? "deleted notification group"),
  };
}

async function attachWeeklyReportAcl(client: SupabaseClient, rows: WeeklyReportRow[]) {
  if (!rows.length) return [] as WeeklyReport[];
  const reportIds = rows.map((row) => row.id);
  const [usersResult, groupsResult, targetsResult, deliveriesResult] = await Promise.all([
    client.from("weekly_report_user_acl").select("report_id,user_id").in("report_id", reportIds),
    client.from("weekly_report_group_acl").select("report_id,group_id").in("report_id", reportIds),
    client.from("weekly_report_notification_targets")
      .select("report_id,notification_group_id").in("report_id", reportIds),
    client.from("weekly_report_notification_deliveries")
      .select("report_id,revision,notification_group_id,status").in("report_id", reportIds),
  ]);
  throwError(usersResult.error);
  throwError(groupsResult.error);
  throwError(targetsResult.error);
  throwError(deliveriesResult.error);
  const failedGroupIds = [...new Set((deliveriesResult.data ?? [])
    .filter((item) => item.status === "failed")
    .map((item) => String(item.notification_group_id)))];
  const notificationGroupsResult = failedGroupIds.length
    ? await client.from("weekly_report_notification_groups").select("id,name").in("id", failedGroupIds)
    : { data: [], error: null };
  throwError(notificationGroupsResult.error);
  const notificationGroupNames = new Map(
    (notificationGroupsResult.data ?? []).map((item) => [String(item.id), String(item.name)]),
  );
  return rows.map((row) => ({
    ...row,
    week_start: String(row.week_start).slice(0, 10),
    user_acl_ids: (usersResult.data ?? [])
      .filter((item) => item.report_id === row.id)
      .map((item) => String(item.user_id)),
    group_acl_ids: (groupsResult.data ?? [])
      .filter((item) => item.report_id === row.id)
      .map((item) => String(item.group_id)),
    notification_group_ids: (targetsResult.data ?? [])
      .filter((item) => item.report_id === row.id)
      .map((item) => String(item.notification_group_id)),
    notification_summary: weeklyReportNotificationSummary(
      row.notification_revision,
      (deliveriesResult.data ?? []).filter((item) =>
        item.report_id === row.id && Number(item.revision) === Number(row.notification_revision)),
      notificationGroupNames,
    ),
  })) as WeeklyReport[];
}

export type WeeklyReportListOptions = {
  weekStart: string;
  author?: string;
  status?: WeeklyReportStatus | "all";
  limit: number;
  offset: number;
};

export async function listWeeklyReports(
  client: SupabaseClient,
  workspaceId: string,
  options: WeeklyReportListOptions,
) {
  let query = client
    .from("weekly_reports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("week_start", options.weekStart);
  if (options.author) query = query.eq("author_id", options.author);
  if (options.status && options.status !== "all") query = query.eq("status", options.status);
  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .range(options.offset, options.offset + options.limit - 1);
  throwError(error);
  return attachWeeklyReportAcl(client, (data ?? []) as WeeklyReportRow[]);
}

export async function getWeeklyReport(client: SupabaseClient, workspaceId: string, reportId: string) {
  const { data, error } = await client.from("weekly_reports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", reportId)
    .maybeSingle();
  throwError(error);
  const report = data
    ? (await attachWeeklyReportAcl(client, [data as WeeklyReportRow]))[0]
    : null;
  return requireRow(report ?? null, "Weekly report");
}

export type SaveWeeklyReportInput = {
  id?: string | null;
  workspaceId: string;
  weekStart: string;
  completedText: string;
  nextPlanText: string;
  reflectionText: string;
  visibility: WeeklyReportVisibility;
  userIds: string[];
  groupIds: string[];
  notificationGroupIds: string[];
  publish: boolean;
};

function prepareWeeklyReportSave(input: SaveWeeklyReportInput) {
  assertWeeklyReportSubjects(input.visibility, input.userIds, input.groupIds);
  if (input.publish) {
    assertWeeklyReportCanPublish({
      completedText: input.completedText,
      nextPlanText: input.nextPlanText,
      reflectionText: input.reflectionText,
      visibility: input.visibility,
      userIds: input.userIds,
      groupIds: input.groupIds,
    });
  }
  return {
    p_workspace_id: input.workspaceId,
    p_week_start: input.weekStart,
    p_completed_text: input.completedText,
    p_next_plan_text: input.nextPlanText,
    p_reflection_text: input.reflectionText,
    p_visibility: input.visibility,
    p_user_ids: input.visibility === "users" ? input.userIds : [],
    p_group_ids: input.visibility === "groups" ? input.groupIds : [],
    p_report_id: input.id ?? null,
    p_publish: input.publish,
    p_notification_group_ids: input.notificationGroupIds,
  };
}

export async function saveWeeklyReport(client: SupabaseClient, input: SaveWeeklyReportInput) {
  const { data, error } = await client.rpc("save_weekly_report", prepareWeeklyReportSave(input));
  throwError(error);
  const savedRow = Array.isArray(data) ? data[0] : data;
  if (!savedRow) {
    throw new CliError({ type: "api", code: "weekly_report_missing", message: "Weekly report was saved but the server did not return a record" });
  }
  return {
    ...(savedRow as WeeklyReportRow),
    week_start: String((savedRow as WeeklyReportRow).week_start).slice(0, 10),
    user_acl_ids: input.visibility === "users" ? input.userIds : [],
    group_acl_ids: input.visibility === "groups" ? input.groupIds : [],
    notification_group_ids: input.notificationGroupIds,
    notification_summary: null,
  } satisfies WeeklyReport;
}

export async function findOwnWeeklyReportForWeek(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
  weekStart: string,
) {
  const { data, error } = await client.from("weekly_reports")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("author_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  throwError(error);
  return data as { id: string } | null;
}

export async function createWeeklyReport(
  client: SupabaseClient,
  userId: string,
  input: SaveWeeklyReportInput,
) {
  if (!canCreateWeeklyReportForWeek(input.weekStart)) {
    throw new CliError({
      type: "validation",
      code: "invalid_weekly_report_week",
      message: "Weekly reports can only be created for this week or last week",
    });
  }
  const existing = await findOwnWeeklyReportForWeek(client, input.workspaceId, userId, input.weekStart);
  if (existing) {
    throw new CliError({
      type: "validation",
      code: "already_exists",
      message: "A weekly report already exists for this week",
      hint: `Run \`anttodo weekly-report update ${existing.id}\``,
      details: { id: existing.id, week_start: input.weekStart },
    });
  }
  return saveWeeklyReport(client, { ...input, id: null });
}

export type UpdateWeeklyReportInput = {
  completedText?: string;
  nextPlanText?: string;
  reflectionText?: string;
  visibility?: WeeklyReportVisibility;
  userIds?: string[];
  clearUsers?: boolean;
  groupIds?: string[];
  clearGroups?: boolean;
  notificationGroupIds?: string[];
  clearNotificationGroups?: boolean;
  publish?: boolean;
};

function mergeWeeklyReportUpdate(current: WeeklyReport, patch: UpdateWeeklyReportInput): SaveWeeklyReportInput {
  const visibility = patch.visibility ?? current.visibility;
  const userIds = visibility === "users"
    ? (patch.clearUsers ? [] : patch.userIds ?? current.user_acl_ids)
    : [];
  const groupIds = visibility === "groups"
    ? (patch.clearGroups ? [] : patch.groupIds ?? current.group_acl_ids)
    : [];
  const notificationGroupIds = patch.clearNotificationGroups
    ? []
    : patch.notificationGroupIds ?? current.notification_group_ids;
  const publish = Boolean(patch.publish || current.status === "published");
  return {
    id: current.id,
    workspaceId: current.workspace_id,
    weekStart: String(current.week_start).slice(0, 10),
    completedText: patch.completedText ?? current.completed_text,
    nextPlanText: patch.nextPlanText ?? current.next_plan_text,
    reflectionText: patch.reflectionText ?? current.reflection_text,
    visibility,
    userIds,
    groupIds,
    notificationGroupIds,
    publish,
  };
}

export async function updateWeeklyReport(
  client: SupabaseClient,
  workspaceId: string,
  reportId: string,
  patch: UpdateWeeklyReportInput,
) {
  const current = await getWeeklyReport(client, workspaceId, reportId);
  return saveWeeklyReport(client, mergeWeeklyReportUpdate(current, patch));
}

export async function publishWeeklyReport(client: SupabaseClient, workspaceId: string, reportId: string) {
  return updateWeeklyReport(client, workspaceId, reportId, { publish: true });
}

export async function createWorkspace(client: SupabaseClient, userId: string, name: string, slug?: string) {
  const normalized = slug?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const { data, error } = await client.from("workspaces").insert({ name: name.trim(), slug: normalized || undefined, created_by: userId }).select("*").single();
  throwError(error);
  await invalidateWorkspaceListCaches(getActiveServiceKey() ?? "official").catch(() => undefined);
  return data;
}

export async function updateWorkspace(client: SupabaseClient, workspaceId: string, patch: { name?: string; slug?: string }) {
  const payload = { ...patch, ...(patch.name === undefined ? {} : { name: patch.name.trim() }), ...(patch.slug === undefined ? {} : { slug: patch.slug.trim().toLowerCase() }) };
  const { data, error } = await client.from("workspaces").update(payload).eq("id", workspaceId).select("*").single();
  throwError(error);
  await invalidateWorkspaceListCaches(getActiveServiceKey() ?? "official").catch(() => undefined);
  return data;
}

export async function deleteWorkspace(client: SupabaseClient, workspaceId: string, confirmationName: string) {
  const { data, error } = await client.functions.invoke("workspace-admin", { body: { action: "delete", workspaceId, confirmationName } });
  if (error) throw new CliError({ type: "api", code: "workspace_delete_failed", message: typeof data?.error === "string" ? data.error : error.message, details: data });
  await invalidateWorkspaceListCaches(getActiveServiceKey() ?? "official").catch(() => undefined);
  await invalidateTaskCache(workspaceId);
  return data;
}

export async function updateWorkspaceMemberRole(client: SupabaseClient, workspaceId: string, userId: string, role: "admin" | "member") {
  const current = await client.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  throwError(current.error);
  if (!current.data) throw new CliError({ type: "not_found", code: "member_not_found", message: "Workspace member not found" });
  if (current.data.role === "owner") throw new CliError({ type: "authorization", code: "owner_protected", message: "The workspace owner role cannot be changed" });
  const { data, error } = await client.from("workspace_members").update({ role }).eq("workspace_id", workspaceId).eq("user_id", userId).select("*").maybeSingle();
  throwError(error);
  await invalidateWorkspaceListCaches(getActiveServiceKey() ?? "official").catch(() => undefined);
  return requireRow(data, "Workspace member");
}

export async function removeWorkspaceMember(client: SupabaseClient, workspaceId: string, userId: string) {
  const current = await client.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  throwError(current.error);
  if (!current.data) throw new CliError({ type: "not_found", code: "member_not_found", message: "Workspace member not found" });
  if (current.data.role === "owner") throw new CliError({ type: "authorization", code: "owner_protected", message: "The workspace owner cannot be removed" });
  const { data, error } = await client.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("user_id", userId).neq("role", "owner").select("user_id").maybeSingle();
  throwError(error);
  await invalidateWorkspaceListCaches(getActiveServiceKey() ?? "official").catch(() => undefined);
  return requireRow(data, "Workspace member");
}

export async function workspaceInvite(client: SupabaseClient, body: Record<string, unknown>) {
  const { data, error } = await client.functions.invoke("workspace-invite", { body });
  if (error) throw new CliError({ type: "api", code: "workspace_invite_failed", message: typeof data?.error === "string" ? data.error : error.message, details: data });
  return data;
}

export async function listComments(client: SupabaseClient, taskId: string) {
  const query = client.from("task_comments").select("*, mentions:task_comment_mentions(user_id, display_name_snapshot)").eq("task_id", taskId).order("created_at");
  const { data, error } = await query;
  throwError(error);
  const comments = data ?? [];
  const ids = [...new Set(comments.map((comment) => comment.author_id))];
  const profiles = ids.length ? await client.from("profiles").select("id, display_name, avatar_url").in("id", ids) : { data: [], error: null };
  throwError(profiles.error);
  const byId = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
  return comments.map((comment) => ({ ...comment, mentions: comment.mentions ?? [], author: byId.get(comment.author_id) }));
}

export async function createComment(client: SupabaseClient, input: { taskId: string; body: string; imageUris: string[]; mentionedUserIds: string[] }) {
  const { data, error } = await client.rpc("create_task_comment", { p_task_id: input.taskId, p_body: input.body, p_image_uris: input.imageUris, p_mentioned_user_ids: input.mentionedUserIds });
  throwError(error);
  return data;
}

export async function updateComment(client: SupabaseClient, input: { commentId: string; body: string; imageUris: string[]; mentionedUserIds: string[] }) {
  const { data, error } = await client.rpc("update_task_comment", { p_comment_id: input.commentId, p_body: input.body, p_image_uris: input.imageUris, p_mentioned_user_ids: input.mentionedUserIds });
  throwError(error);
  return data;
}

export async function deleteComment(client: SupabaseClient, commentId: string) {
  const { error } = await client.from("task_comments").delete().eq("id", commentId);
  throwError(error);
  return { deleted: true, id: commentId };
}

export async function listActivity(client: SupabaseClient, taskId: string, cursor?: { createdAt: string; id: string } | null, limit = 50) {
  const { data, error } = await client.rpc("list_task_activity", { p_task_id: taskId, p_before_created_at: cursor?.createdAt ?? null, p_before_id: cursor?.id ?? null, p_limit: limit });
  throwError(error);
  const events = (data ?? []) as Array<Record<string, any>>;
  const actorIds = [...new Set(events.flatMap((event) => event.actor_id ? [event.actor_id] : []))];
  const profiles = actorIds.length ? await client.from("profiles").select("id, display_name, avatar_url").in("id", actorIds) : { data: [], error: null };
  throwError(profiles.error);
  const byId = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
  const items = events.map((event) => ({ ...event, actor: event.actor_id ? byId.get(event.actor_id) : null }));
  const last = items.at(-1) as Record<string, any> | undefined;
  return { items, nextCursor: items.length === limit && last ? { createdAt: last.created_at, id: last.id } : null };
}

const MIME_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif", jpeg: "image/jpeg", jpg: "image/jpeg", json: "application/json", md: "text/markdown", pdf: "application/pdf",
  png: "image/png", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", webp: "image/webp", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", zip: "application/zip",
};

function parseStorageUri(uri: string) {
  const parsed = new URL(uri);
  if (parsed.protocol !== "anttodo-storage:") throw new CliError({ type: "validation", code: "invalid_attachment_uri", message: "Invalid AntTodo attachment URI" });
  if (!["task-attachments", "comment-images"].includes(parsed.hostname)) throw new CliError({ type: "validation", code: "invalid_attachment_uri", message: "Unsupported attachment bucket" });
  const path = parsed.pathname.replace(/^\/+/, "");
  if (!path || path.includes("..")) throw new CliError({ type: "validation", code: "invalid_attachment_uri", message: "Invalid attachment path" });
  return { bucket: parsed.hostname, path };
}

export async function uploadAttachment(client: SupabaseClient, workspaceId: string, taskId: string, filePath: string, commentImage = false, uploaderId?: string) {
  const metadata = await stat(filePath);
  if (metadata.size > 20 * 1024 * 1024) throw new CliError({ type: "validation", code: "attachment_too_large", message: "Attachment cannot exceed 20MB" });
  const extension = extname(filePath).replace(/^\./, "").toLowerCase();
  const contentType = MIME_BY_EXTENSION[extension];
  if (!contentType) throw new CliError({ type: "validation", code: "unsupported_attachment", message: "Unsupported attachment type" });
  if (commentImage && !contentType.startsWith("image/")) throw new CliError({ type: "validation", code: "comment_image_required", message: "Comment attachments must be images" });
  const objectId = crypto.randomUUID();
  const bucket = commentImage ? "comment-images" : "task-attachments";
  const path = commentImage ? `${workspaceId}/${taskId}/${uploaderId}/${objectId}.${extension}` : `${workspaceId}/${taskId}/${objectId}.${extension}`;
  if (commentImage && !uploaderId) throw new CliError({ type: "validation", code: "uploader_required", message: "Uploader ID is required for comment images" });
  const { error } = await client.storage.from(bucket).upload(path, await readFile(filePath), { contentType, cacheControl: "3600", upsert: false });
  throwError(error);
  return { bucket, path, uri: `anttodo-storage://${bucket}/${path}`, file_name: basename(filePath), content_type: contentType, size: metadata.size };
}

export async function downloadAttachment(client: SupabaseClient, uri: string, outputPath: string) {
  const { bucket, path } = parseStorageUri(uri);
  const { data, error } = await client.storage.from(bucket).download(path);
  throwError(error);
  if (!data) throw new CliError({ type: "not_found", code: "attachment_not_found", message: "Attachment not found" });
  await writeFile(outputPath, Buffer.from(await data.arrayBuffer()));
  return { output: outputPath };
}

export async function deleteAttachment(client: SupabaseClient, uri: string) {
  const { bucket, path } = parseStorageUri(uri);
  const { error } = await client.storage.from(bucket).remove([path]);
  throwError(error);
  return { deleted: true, uri };
}

export async function signedAttachmentUrl(client: SupabaseClient, uri: string, expiresIn = 60) {
  const { bucket, path } = parseStorageUri(uri);
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresIn);
  throwError(error);
  return data;
}
