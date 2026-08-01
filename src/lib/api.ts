import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Connector,
  DateTimePreferences,
  Label,
  Member,
  SyncConflict,
  SyncRun,
  Task,
  TaskListPreference,
  TaskSection,
  TaskPriority,
  Workspace,
  WorkspaceBundle,
} from "../types";
import {
  DEFAULT_DATE_TIME_PREFERENCES,
  preferenceModelToRow,
  preferenceRowToModel,
} from "./dateTimePreferences";
import {
  isValidWorkspaceSlug,
  normalizeWorkspaceSlug,
  suggestWorkspaceSlug,
} from "./workspaceSlug";

type TaskRow = Omit<Task, "label_ids" | "subtasks"> & {
  task_labels?: Array<{ label_id: string }>;
  subtasks?: Task["subtasks"];
};

function assertNoError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadWorkspaces(client: SupabaseClient): Promise<Workspace[]> {
  const { data: memberships, error } = await client
    .from("workspace_members")
    .select("role, workspaces(*)")
    .order("joined_at", { ascending: true });
  assertNoError(error);
  return (memberships ?? []).flatMap((membership) => {
    const workspace = membership.workspaces as unknown as Workspace | null;
    return workspace ? [{ ...workspace, role: membership.role }] : [];
  });
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
  ] = await Promise.all([
    client
      .from("workspace_members")
      .select("workspace_id, user_id, role")
      .eq("workspace_id", workspaceId),
    client.from("labels").select("*").eq("workspace_id", workspaceId).order("position"),
    client
      .from("tasks")
      .select("*, task_labels(label_id), subtasks(*)")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
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
  ]);
  assertNoError(membersResult.error);
  assertNoError(labelsResult.error);
  assertNoError(tasksResult.error);
  assertNoError(connectorsResult.error);
  assertNoError(preferencesResult.error);
  assertNoError(sectionsResult.error);
  assertNoError(placementsResult.error);

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
  const labelAclsResult = labelIds.length
    ? await client
        .from("label_acl")
        .select("label_id, user_id, permission")
        .in("label_id", labelIds)
    : { data: [], error: null };
  assertNoError(labelAclsResult.error);
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
    labels: (labelsResult.data ?? []) as Label[],
    labelAcls: labelAclsResult.data ?? [],
    tasks: ((tasksResult.data ?? []) as TaskRow[]).map((row) => ({
      ...row,
      label_ids: row.task_labels?.map((item) => item.label_id) ?? [],
      subtasks: [...(row.subtasks ?? [])].sort((a, b) => a.position - b.position),
    })),
    connectors,
    syncRuns: (runsResult.data ?? []) as SyncRun[],
    conflicts: (conflictsResult.data ?? []) as SyncConflict[],
    taskListPreferences: (preferencesResult.data ?? []) as WorkspaceBundle["taskListPreferences"],
    taskSections: (sectionsResult.data ?? []) as WorkspaceBundle["taskSections"],
    taskPlacements: (placementsResult.data ?? []) as WorkspaceBundle["taskPlacements"],
  };
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
  name: string,
  userId: string,
) {
  const trimmedName = name.trim();
  let slug = suggestWorkspaceSlug(trimmedName);

  for (let attempt = 0; attempt < 3; attempt += 1) {
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
    priority?: TaskPriority;
    assigneeId?: string | null;
  },
) {
  const { data, error } = await client.rpc("create_task_with_labels", {
    p_workspace_id: input.workspaceId,
    p_title: input.title,
    p_label_ids: input.labelIds,
    p_description: input.description ?? "",
    p_due_at: input.dueAt ?? null,
    p_due_timezone: input.dueTimezone ?? null,
    p_priority: input.priority ?? "none",
    p_assignee_id: input.assigneeId ?? null,
  });
  assertNoError(error);
  return data;
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
  assigneeId: string | null,
) {
  const { data, error } = await client.rpc("assign_task", {
    p_task_id: taskId,
    p_assignee_id: assigneeId,
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
