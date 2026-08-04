import type { SupabaseClient, User } from "@supabase/supabase-js";
import { CliError } from "./errors.js";
import { getDefaultWorkspace, setDefaultWorkspace } from "./storage.js";
import type { LabelAccessScope, LabelKind, TaskPriority, TaskStatus } from "./types.js";

type Workspace = { id: string; name: string; slug: string; role: string };
type ApiContext = { client: SupabaseClient; user: User };

function throwError(error: { message: string; code?: string; details?: string } | null) {
  if (!error) return;
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

export async function listWorkspaces({ client, user }: ApiContext): Promise<Workspace[]> {
  const { data, error } = await client
    .from("workspace_members")
    .select("role, workspaces(id, name, slug)")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });
  throwError(error);
  return (data ?? []).flatMap((row) => {
    const workspace = row.workspaces as unknown as Omit<Workspace, "role"> | null;
    return workspace ? [{ ...workspace, role: row.role }] : [];
  });
}

export async function resolveWorkspace(context: ApiContext, requested?: string): Promise<Workspace> {
  const workspaces = await listWorkspaces(context);
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

const taskSelect = "*, task_labels(label_id), task_participants(user_id), subtasks(*), task_reminders(*), task_reminder_settings(persistent)";

function normalizeTask(row: Record<string, unknown>) {
  return {
    ...row,
    label_ids: ((row.task_labels ?? []) as Array<{ label_id: string }>).map((item) => item.label_id),
    participant_ids: ((row.task_participants ?? []) as Array<{ user_id: string }>).map((item) => item.user_id),
    reminders: row.task_reminders ?? [],
    reminder_persistent: Array.isArray(row.task_reminder_settings)
      ? Boolean((row.task_reminder_settings as Array<{ persistent: boolean }>)[0]?.persistent)
      : Boolean((row.task_reminder_settings as { persistent?: boolean } | null)?.persistent),
    task_labels: undefined,
    task_participants: undefined,
    task_reminders: undefined,
    task_reminder_settings: undefined,
  };
}

export async function listTasks(
  client: SupabaseClient,
  workspaceId: string,
  kind: "todo" | "note",
  options: {
    status?: TaskStatus | "all";
    priority?: TaskPriority;
    assignee?: string;
    tag?: string;
    trash?: boolean;
    includeTrash?: boolean;
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
  if (allowedTaskIds) query = query.in("id", allowedTaskIds);
  const { data, error } = await query;
  throwError(error);
  return (data ?? []).map((row) => normalizeTask(row as Record<string, unknown>));
}

export async function getTask(client: SupabaseClient, workspaceId: string, id: string, kind: "todo" | "note") {
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
}) {
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
  return requireRow(data, kind === "note" ? "Note" : "Task");
}

export async function listSubtasks(client: SupabaseClient, workspaceId: string, taskId: string) {
  await getTask(client, workspaceId, taskId, "todo");
  const { data, error } = await client.from("subtasks").select("*").eq("task_id", taskId).order("position");
  throwError(error);
  return data ?? [];
}

export async function getSubtask(client: SupabaseClient, workspaceId: string, id: string) {
  const { data, error } = await client
    .from("subtasks")
    .select("*, tasks!inner(workspace_id, kind)")
    .eq("id", id)
    .eq("tasks.workspace_id", workspaceId)
    .eq("tasks.kind", "todo")
    .maybeSingle();
  throwError(error);
  return requireRow(data, "Subtask");
}

export async function createSubtask(client: SupabaseClient, userId: string, workspaceId: string, taskId: string, title: string) {
  const task = await getTask(client, workspaceId, taskId, "todo") as { subtasks?: unknown[] };
  const { data, error } = await client.from("subtasks").insert({
    task_id: taskId,
    title: title.trim(),
    position: task.subtasks?.length ?? 0,
    created_by: userId,
  }).select("*").maybeSingle();
  throwError(error);
  return requireRow(data, "Subtask");
}

export async function updateSubtaskDueTime(client: SupabaseClient, workspaceId: string, id: string, dueAt: string | null) {
  await getSubtask(client, workspaceId, id);
  const { data, error } = await client.from("subtasks").update({ due_at: dueAt }).eq("id", id).select("*").maybeSingle();
  throwError(error);
  return requireRow(data, "Subtask");
}

export async function deleteSubtask(client: SupabaseClient, workspaceId: string, id: string) {
  const subtask = await getSubtask(client, workspaceId, id);
  const { data, error } = await client.from("subtasks").delete().eq("id", id).select("id").maybeSingle();
  throwError(error);
  requireRow(data, "Subtask");
  return subtask;
}

export async function listTags(client: SupabaseClient, workspaceId: string) {
  const { data, error } = await client.from("labels").select("*").eq("workspace_id", workspaceId).order("position");
  throwError(error);
  return data ?? [];
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
