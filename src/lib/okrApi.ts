import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  OkrBreakdown,
  OkrCycle,
  OkrDisplayPreferences,
  OkrKeyResult,
  OkrObjective,
  OkrProgressRecord,
  OkrProgressStatus,
  OkrSet,
  OkrVersion,
  MyActiveOkrTree,
  OkrLinkedTaskSummary,
  TaskOkrLink,
} from "../types";
import { nextOkrPosition, publishOkrErrorMessage } from "./okr";

function assertNoError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export function taskOkrLinkKey(taskId: string) {
  return ["task-okr-link", taskId] as const;
}

export function okrLinkedTasksKey(
  workspaceId: string,
  target: { kind: "objective" | "key_result"; id: string },
) {
  return ["okr-linked-tasks", workspaceId, target.kind, target.id] as const;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function loadOkrCycles(client: SupabaseClient, workspaceId: string) {
  const { data, error } = await client
    .from("okr_cycles")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("position", { ascending: true })
    .order("starts_on", { ascending: false });
  assertNoError(error);
  return (data ?? []) as OkrCycle[];
}

export function currentActiveOkrCycle(cycles: OkrCycle[], today = new Date()) {
  const date = today.toISOString().slice(0, 10);
  const active = cycles.filter((cycle) => cycle.status === "active");
  return active.find((cycle) => cycle.starts_on <= date && cycle.ends_on >= date)
    ?? active[0]
    ?? null;
}

export async function loadMyActiveOkrTree(
  client: SupabaseClient,
  workspaceId: string,
  ownerId: string,
): Promise<MyActiveOkrTree | null> {
  const cycles = await loadOkrCycles(client, workspaceId);
  const cycle = currentActiveOkrCycle(cycles);
  if (!cycle) return null;
  return {
    cycle,
    set: await loadOkrSet(client, workspaceId, cycle.id, ownerId),
  };
}

export async function loadTaskOkrLink(
  client: SupabaseClient,
  taskId: string,
): Promise<TaskOkrLink | null> {
  const linkResult = await client.from("task_okr_links")
    .select("task_id,key_result_id,workspace_id,created_by,created_at,updated_at")
    .eq("task_id", taskId)
    .maybeSingle();
  assertNoError(linkResult.error);
  if (!linkResult.data) return null;

  const keyResultResult = await client.from("okr_key_results")
    .select("id,objective_id,title")
    .eq("id", linkResult.data.key_result_id)
    .maybeSingle();
  assertNoError(keyResultResult.error);
  if (!keyResultResult.data) return null;
  const objectiveResult = await client.from("okr_objectives")
    .select("id,set_id,title")
    .eq("id", keyResultResult.data.objective_id)
    .maybeSingle();
  assertNoError(objectiveResult.error);
  if (!objectiveResult.data) return null;
  const setResult = await client.from("okr_sets")
    .select("owner_id,cycle_id")
    .eq("id", objectiveResult.data.set_id)
    .maybeSingle();
  assertNoError(setResult.error);
  if (!setResult.data) return null;
  const cycleResult = await client.from("okr_cycles")
    .select("id,name")
    .eq("id", setResult.data.cycle_id)
    .maybeSingle();
  assertNoError(cycleResult.error);
  if (!cycleResult.data) return null;

  return {
    ...linkResult.data,
    owner_id: String(setResult.data.owner_id),
    cycle_id: String(cycleResult.data.id),
    cycle_name: String(cycleResult.data.name),
    objective_id: String(objectiveResult.data.id),
    objective_title: String(objectiveResult.data.title),
    key_result_title: String(keyResultResult.data.title),
  } as TaskOkrLink;
}

export async function loadTaskOkrLinkIds(
  client: SupabaseClient,
  taskIds: string[],
) {
  if (!taskIds.length) return {} as Record<string, string>;
  const { data, error } = await client.from("task_okr_links")
    .select("task_id,key_result_id")
    .in("task_id", taskIds);
  assertNoError(error);
  return Object.fromEntries((data ?? []).map((row) => [
    String(row.task_id),
    String(row.key_result_id),
  ]));
}

export async function setTaskOkrLink(
  client: SupabaseClient,
  taskId: string,
  keyResultId: string | null,
) {
  const { error } = await client.rpc("set_task_okr_link", {
    p_task_id: taskId,
    p_key_result_id: keyResultId,
  });
  assertNoError(error);
  return keyResultId ? loadTaskOkrLink(client, taskId) : null;
}

export async function loadOkrLinkedTasks(
  client: SupabaseClient,
  target: { kind: "objective" | "key_result"; id: string },
): Promise<OkrLinkedTaskSummary[]> {
  const keyResultsQuery = client.from("okr_key_results")
    .select("id,title,position")
    .order("position", { ascending: true });
  const keyResultsResult = target.kind === "objective"
    ? await keyResultsQuery.eq("objective_id", target.id)
    : await keyResultsQuery.eq("id", target.id);
  assertNoError(keyResultsResult.error);
  const keyResults = keyResultsResult.data ?? [];
  const keyResultIds = keyResults.map((row) => String(row.id));
  if (!keyResultIds.length) return [];

  const linksResult = await client.from("task_okr_links")
    .select("task_id,key_result_id")
    .in("key_result_id", keyResultIds);
  assertNoError(linksResult.error);
  const links = linksResult.data ?? [];
  const taskIds = links.map((row) => String(row.task_id));
  if (!taskIds.length) return [];

  const tasksResult = await client.from("tasks")
    .select("id,workspace_id,parent_task_id,title,kind,status,due_at,assignee_id,deleted_at,updated_at")
    .in("id", taskIds)
    .is("deleted_at", null);
  assertNoError(tasksResult.error);
  const keyResultById = new Map(keyResults.map((row) => [String(row.id), row]));
  const linkByTaskId = new Map(links.map((row) => [String(row.task_id), String(row.key_result_id)]));
  const statusRank = { open: 0, completed: 1, cancelled: 2 } as const;

  return (tasksResult.data ?? []).map((task) => {
    const keyResultId = linkByTaskId.get(String(task.id))!;
    const keyResult = keyResultById.get(keyResultId)!;
    return {
      task_id: String(task.id),
      workspace_id: String(task.workspace_id),
      parent_task_id: task.parent_task_id ? String(task.parent_task_id) : null,
      title: String(task.title),
      kind: task.kind === "note" ? "note" : "todo",
      status: task.status,
      due_at: task.due_at,
      assignee_id: task.assignee_id,
      updated_at: String(task.updated_at),
      key_result_id: keyResultId,
      key_result_title: String(keyResult.title),
      key_result_position: Number(keyResult.position),
    } as OkrLinkedTaskSummary;
  }).sort((left, right) =>
    left.key_result_position - right.key_result_position
    || statusRank[left.status] - statusRank[right.status]
    || right.updated_at.localeCompare(left.updated_at));
}

export async function createOkrCycle(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
  input: Pick<OkrCycle, "name" | "starts_on" | "ends_on" | "status">,
) {
  const { data: lastCycle, error: positionError } = await client
    .from("okr_cycles")
    .select("position")
    .eq("workspace_id", workspaceId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertNoError(positionError);
  const { data, error } = await client.from("okr_cycles").insert({
    workspace_id: workspaceId,
    created_by: userId,
    position: nextOkrPosition(lastCycle?.position),
    ...input,
  }).select("*").single();
  assertNoError(error);
  return data as OkrCycle;
}

export async function updateOkrCycle(
  client: SupabaseClient,
  cycleId: string,
  patch: Partial<Pick<OkrCycle, "name" | "starts_on" | "ends_on" | "status" | "position">>,
) {
  const { data, error } = await client.from("okr_cycles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", cycleId)
    .select("*")
    .single();
  assertNoError(error);
  return data as OkrCycle;
}

export async function deleteOkrCycle(client: SupabaseClient, cycleId: string) {
  const { error } = await client.from("okr_cycles").delete().eq("id", cycleId);
  assertNoError(error);
}

export async function loadVisibleOkrOwnerIds(
  client: SupabaseClient,
  workspaceId: string,
  cycleId: string,
) {
  const { data, error } = await client.from("okr_sets")
    .select("owner_id")
    .eq("workspace_id", workspaceId)
    .eq("cycle_id", cycleId);
  assertNoError(error);
  return (data ?? []).map((row) => String(row.owner_id));
}

export type OkrAlignmentOption = {
  id: string;
  title: string;
  ownerId: string;
};

export async function loadAlignableOkrObjectives(
  client: SupabaseClient,
  workspaceId: string,
  cycleId: string,
  sourceObjectiveId?: string,
) {
  const setsResult = await client.from("okr_sets")
    .select("id,owner_id")
    .eq("workspace_id", workspaceId)
    .eq("cycle_id", cycleId);
  assertNoError(setsResult.error);
  const ownerBySet = new Map((setsResult.data ?? []).map((row) => [String(row.id), String(row.owner_id)]));
  const setIds = [...ownerBySet.keys()];
  if (!setIds.length) return [] as OkrAlignmentOption[];
  let query = client.from("okr_objectives").select("id,set_id,title").in("set_id", setIds).order("position");
  if (sourceObjectiveId) query = query.neq("id", sourceObjectiveId);
  const result = await query;
  assertNoError(result.error);
  return (result.data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    ownerId: ownerBySet.get(String(row.set_id)) ?? "",
  })).filter((row) => row.ownerId) as OkrAlignmentOption[];
}

export async function ensureOkrSet(
  client: SupabaseClient,
  workspaceId: string,
  cycleId: string,
  ownerId: string,
) {
  const existing = await client.from("okr_sets")
    .select("*")
    .eq("cycle_id", cycleId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  assertNoError(existing.error);
  if (existing.data) return existing.data as OkrSet;
  const { data, error } = await client.from("okr_sets").insert({
    workspace_id: workspaceId,
    cycle_id: cycleId,
    owner_id: ownerId,
    visibility: "workspace",
  }).select("*").single();
  assertNoError(error);
  return data as OkrSet;
}

type ObjectiveRow = Omit<OkrObjective, "responsible_ids" | "user_acl_ids" | "group_acl_ids" | "alignment_target_id" | "key_results">;
type KeyResultRow = Omit<OkrKeyResult, "responsible_ids" | "user_acl_ids" | "group_acl_ids" | "breakdowns">;

function normalizeOkrKeyResult(keyResult: OkrKeyResult): OkrKeyResult {
  return {
    ...keyResult,
    start_value: numberValue(keyResult.start_value),
    target_value: numberValue(keyResult.target_value, 100),
    current_value: keyResult.current_value === null ? null : numberValue(keyResult.current_value),
    weight: numberValue(keyResult.weight, 100),
    score: keyResult.score === null ? null : numberValue(keyResult.score),
    responsible_ids: keyResult.responsible_ids ?? [],
    user_acl_ids: keyResult.user_acl_ids ?? [],
    group_acl_ids: keyResult.group_acl_ids ?? [],
    breakdowns: (keyResult.breakdowns ?? []).map((breakdown) => ({
      ...breakdown,
      allocated_value: numberValue(breakdown.allocated_value),
    })),
  };
}

function normalizeOkrObjective(objective: OkrObjective): OkrObjective {
  return {
    ...objective,
    start_value: numberValue(objective.start_value),
    target_value: numberValue(objective.target_value, 100),
    current_value: objective.current_value === null ? null : numberValue(objective.current_value),
    score: objective.score === null ? null : numberValue(objective.score),
    responsible_ids: objective.responsible_ids ?? [],
    user_acl_ids: objective.user_acl_ids ?? [],
    group_acl_ids: objective.group_acl_ids ?? [],
    alignment_target_id: objective.alignment_target_id ?? null,
    key_results: (objective.key_results ?? []).map(normalizeOkrKeyResult),
  };
}

function normalizeOkrSet(set: OkrSet): OkrSet {
  return {
    ...set,
    user_acl_ids: set.user_acl_ids ?? [],
    group_acl_ids: set.group_acl_ids ?? [],
    objectives: (set.objectives ?? []).map(normalizeOkrObjective),
  };
}

export async function loadOkrSet(
  client: SupabaseClient,
  workspaceId: string,
  cycleId: string,
  ownerId: string,
): Promise<OkrSet | null> {
  const { data, error } = await client.rpc("load_okr_set", {
    p_workspace_id: workspaceId,
    p_cycle_id: cycleId,
    p_owner_id: ownerId,
  });
  assertNoError(error);
  return data ? normalizeOkrSet(data as OkrSet) : null;
}

export async function saveOkrSetVisibility(
  client: SupabaseClient,
  setId: string,
  workspaceId: string,
  visibility: "workspace" | "restricted",
  userIds: string[],
  groupIds: string[],
) {
  const { error } = await client.from("okr_sets").update({ visibility }).eq("id", setId);
  assertNoError(error);
  const deletes = await Promise.all([
    client.from("okr_set_user_acl").delete().eq("set_id", setId),
    client.from("okr_set_group_acl").delete().eq("set_id", setId),
  ]);
  deletes.forEach((result) => assertNoError(result.error));
  if (visibility === "restricted") {
    const inserts = await Promise.all([
      userIds.length ? client.from("okr_set_user_acl").insert(
        userIds.map((userId) => ({ set_id: setId, workspace_id: workspaceId, user_id: userId })),
      ) : Promise.resolve({ error: null }),
      groupIds.length ? client.from("okr_set_group_acl").insert(
        groupIds.map((groupId) => ({ set_id: setId, workspace_id: workspaceId, group_id: groupId })),
      ) : Promise.resolve({ error: null }),
    ]);
    inserts.forEach((result) => assertNoError(result.error));
  }
}

async function replaceIds(
  client: SupabaseClient,
  table: string,
  key: string,
  keyValue: string,
  workspaceId: string,
  ids: string[],
) {
  const deleted = await client.from(table).delete().eq(key, keyValue);
  assertNoError(deleted.error);
  if (!ids.length) return;
  const inserted = await client.from(table).insert(ids.map((userId, position) => ({
    [key]: keyValue,
    workspace_id: workspaceId,
    user_id: userId,
    position,
  })));
  assertNoError(inserted.error);
}

async function replaceAclIds(
  client: SupabaseClient,
  kind: "objective" | "key_result",
  entityId: string,
  workspaceId: string,
  userIds: string[],
  groupIds: string[],
) {
  const entityKey = kind === "objective" ? "objective_id" : "key_result_id";
  const userTable = kind === "objective" ? "okr_objective_user_acl" : "okr_key_result_user_acl";
  const groupTable = kind === "objective" ? "okr_objective_group_acl" : "okr_key_result_group_acl";
  const deleted = await Promise.all([
    client.from(userTable).delete().eq(entityKey, entityId),
    client.from(groupTable).delete().eq(entityKey, entityId),
  ]);
  deleted.forEach((result) => assertNoError(result.error));
  const inserted = await Promise.all([
    userIds.length
      ? client.from(userTable).insert(userIds.map((userId) => ({
          [entityKey]: entityId,
          workspace_id: workspaceId,
          user_id: userId,
        })))
      : Promise.resolve({ error: null }),
    groupIds.length
      ? client.from(groupTable).insert(groupIds.map((groupId) => ({
          [entityKey]: entityId,
          workspace_id: workspaceId,
          group_id: groupId,
        })))
      : Promise.resolve({ error: null }),
  ]);
  inserted.forEach((result) => assertNoError(result.error));
}

export async function createOkrObjective(
  client: SupabaseClient,
  input: Pick<OkrObjective, "set_id" | "workspace_id" | "title" | "note" | "position">,
) {
  const { data, error } = await client.from("okr_objectives").insert(input).select("*").single();
  assertNoError(error);
  return data as ObjectiveRow;
}

export async function updateOkrObjective(
  client: SupabaseClient,
  objective: OkrObjective,
) {
  const { responsible_ids, user_acl_ids, group_acl_ids, alignment_target_id, key_results, ...row } = objective;
  const { data, error } = await client.from("okr_objectives").update({
    title: row.title.trim(),
    note: row.note,
    position: row.position,
    visibility: row.visibility,
    progress_mode: row.progress_mode,
    status_mode: row.status_mode,
    progress_status: row.progress_status,
    start_value: row.start_value,
    target_value: row.target_value,
    current_value: row.current_value,
    metric_unit: row.metric_unit,
    custom_unit: row.custom_unit,
    score: row.score,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).select("*").single();
  assertNoError(error);
  await replaceIds(client, "okr_objective_responsibles", "objective_id", row.id, row.workspace_id, responsible_ids);
  await replaceAclIds(client, "objective", row.id, row.workspace_id, user_acl_ids, group_acl_ids);
  const removedAlignment = await client.from("okr_objective_alignments")
    .delete().eq("source_objective_id", row.id);
  assertNoError(removedAlignment.error);
  if (alignment_target_id) {
    const alignment = await client.from("okr_objective_alignments").insert({
      source_objective_id: row.id,
      target_objective_id: alignment_target_id,
      workspace_id: row.workspace_id,
    });
    assertNoError(alignment.error);
  }
  return data as ObjectiveRow;
}

export async function deleteOkrObjective(client: SupabaseClient, objectiveId: string) {
  const { error } = await client.from("okr_objectives").delete().eq("id", objectiveId);
  assertNoError(error);
}

export async function createOkrKeyResult(
  client: SupabaseClient,
  input: Pick<OkrKeyResult, "objective_id" | "workspace_id" | "title" | "position" | "weight">,
) {
  const { data, error } = await client.from("okr_key_results").insert(input).select("*").single();
  assertNoError(error);
  return data as KeyResultRow;
}

export async function createOkrKeyResultWithBalancedWeights(
  client: SupabaseClient,
  input: Pick<OkrKeyResult, "objective_id" | "workspace_id" | "title" | "position" | "weight">,
  existing: Array<Pick<OkrKeyResult, "id" | "weight">>,
) {
  const { data, error } = await client.rpc("create_okr_key_result_with_balanced_weights", {
    p_objective_id: input.objective_id,
    p_workspace_id: input.workspace_id,
    p_title: input.title,
    p_position: input.position,
    p_existing_ids: existing.map((keyResult) => keyResult.id),
    p_existing_weights: existing.map((keyResult) => keyResult.weight),
    p_new_weight: input.weight,
  });
  assertNoError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Key Result 创建失败");
  return row as KeyResultRow;
}

function sameIdList(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function keyResultRelationsUnchanged(previous: OkrKeyResult, next: OkrKeyResult) {
  return sameIdList(previous.responsible_ids, next.responsible_ids)
    && sameIdList(previous.user_acl_ids, next.user_acl_ids)
    && sameIdList(previous.group_acl_ids, next.group_acl_ids)
    && JSON.stringify(previous.breakdowns) === JSON.stringify(next.breakdowns);
}

export async function updateOkrKeyResult(
  client: SupabaseClient,
  keyResult: OkrKeyResult,
  previous?: OkrKeyResult,
) {
  const { responsible_ids, user_acl_ids, group_acl_ids, breakdowns, ...row } = keyResult;
  const { data, error } = await client.from("okr_key_results").update({
    title: row.title.trim(),
    position: row.position,
    visibility: row.visibility,
    status_mode: row.status_mode,
    progress_status: row.progress_status,
    start_value: row.start_value,
    target_value: row.target_value,
    current_value: row.current_value,
    metric_unit: row.metric_unit,
    custom_unit: row.custom_unit,
    weight: row.weight,
    score: row.score,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).select("*").single();
  assertNoError(error);
  if (!previous || !keyResultRelationsUnchanged(previous, keyResult)) {
    await replaceIds(client, "okr_key_result_responsibles", "key_result_id", row.id, row.workspace_id, responsible_ids);
    await replaceAclIds(client, "key_result", row.id, row.workspace_id, user_acl_ids, group_acl_ids);
    const removed = await client.from("okr_kr_breakdowns").delete().eq("key_result_id", row.id);
    assertNoError(removed.error);
    if (breakdowns.length) {
      const inserted = await client.from("okr_kr_breakdowns").insert(breakdowns.map((breakdown, position) => ({
        key_result_id: row.id,
        workspace_id: row.workspace_id,
        user_id: breakdown.user_id,
        allocated_value: breakdown.allocated_value,
        position,
      })));
      assertNoError(inserted.error);
    }
  }
  return data as KeyResultRow;
}

export async function updateOkrKeyResultWeights(
  client: SupabaseClient,
  keyResults: Array<Pick<OkrKeyResult, "id" | "weight">>,
) {
  const now = new Date().toISOString();
  const results = await Promise.all(keyResults.map((keyResult) => client.from("okr_key_results").update({
    weight: keyResult.weight,
    updated_at: now,
  }).eq("id", keyResult.id)));
  results.forEach((result) => assertNoError(result.error));
}

export async function deleteOkrKeyResult(client: SupabaseClient, keyResultId: string) {
  const { error } = await client.from("okr_key_results").delete().eq("id", keyResultId);
  assertNoError(error);
}

export async function publishOkrSet(client: SupabaseClient, setId: string) {
  const { data, error } = await client.rpc("publish_okr_set", { p_set_id: setId });
  if (error) throw new Error(publishOkrErrorMessage(error.message));
  return data as OkrSet;
}

export async function updateOkrProgress(
  client: SupabaseClient,
  target: { kind: "objective" | "key_result"; id: string },
  currentValue: number | null,
  status: OkrProgressStatus,
  detail: string,
) {
  const functionName = target.kind === "objective"
    ? "update_okr_objective_progress"
    : "update_okr_key_result_progress";
  const idKey = target.kind === "objective" ? "p_objective_id" : "p_key_result_id";
  const { data, error } = await client.rpc(functionName, {
    [idKey]: target.id,
    p_current_value: currentValue,
    p_status: status,
    p_detail: detail,
  });
  assertNoError(error);
  return data;
}

export async function loadOkrProgressRecords(
  client: SupabaseClient,
  target: { kind: "objective" | "key_result"; id: string },
) {
  const column = target.kind === "objective" ? "objective_id" : "key_result_id";
  const { data, error } = await client.from("okr_progress_records").select("*")
    .eq(column, target.id).order("created_at", { ascending: false });
  assertNoError(error);
  return (data ?? []).map((row) => ({
    ...row,
    previous_value: row.previous_value === null ? null : numberValue(row.previous_value),
    current_value: row.current_value === null ? null : numberValue(row.current_value),
  })) as OkrProgressRecord[];
}

export async function loadOkrProgressRecordCounts(
  client: SupabaseClient,
  objectiveIds: string[],
  keyResultIds: string[],
) {
  const [objectiveResult, keyResultResult] = await Promise.all([
    objectiveIds.length
      ? client.from("okr_progress_records").select("objective_id").in("objective_id", objectiveIds)
      : Promise.resolve({ data: [], error: null }),
    keyResultIds.length
      ? client.from("okr_progress_records").select("key_result_id").in("key_result_id", keyResultIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  assertNoError(objectiveResult.error);
  assertNoError(keyResultResult.error);
  const objectives: Record<string, number> = {};
  const keyResults: Record<string, number> = {};
  for (const row of objectiveResult.data ?? []) {
    if (row.objective_id) objectives[row.objective_id] = (objectives[row.objective_id] ?? 0) + 1;
  }
  for (const row of keyResultResult.data ?? []) {
    if (row.key_result_id) keyResults[row.key_result_id] = (keyResults[row.key_result_id] ?? 0) + 1;
  }
  return { objectives, keyResults };
}

export async function loadOkrVersions(client: SupabaseClient, setId: string) {
  const { data, error } = await client.from("okr_versions").select("*")
    .eq("set_id", setId).order("version", { ascending: false });
  assertNoError(error);
  return (data ?? []) as OkrVersion[];
}

export async function loadOkrDisplayPreferences(
  client: SupabaseClient,
  userId: string,
  workspaceId: string,
  cycleId: string,
): Promise<OkrDisplayPreferences> {
  const { data, error } = await client.from("okr_display_preferences").select("*")
    .eq("user_id", userId).eq("workspace_id", workspaceId);
  assertNoError(error);
  const rows = (data ?? []) as OkrDisplayPreferences[];
  return rows.find((row) => !row.apply_all_cycles && row.cycle_id === cycleId)
    ?? rows.find((row) => row.apply_all_cycles)
    ?? {
      user_id: userId,
      workspace_id: workspaceId,
      cycle_id: cycleId,
      show_progress: true,
      show_score: true,
      show_weight: true,
      apply_all_cycles: false,
    };
}

export async function saveOkrDisplayPreferences(
  client: SupabaseClient,
  preferences: OkrDisplayPreferences,
) {
  const query = client.from("okr_display_preferences");
  if (preferences.id) {
    const conflictQuery = client.from("okr_display_preferences").delete()
      .eq("user_id", preferences.user_id)
      .eq("workspace_id", preferences.workspace_id)
      .neq("id", preferences.id);
    const conflictResult = preferences.apply_all_cycles
      ? await conflictQuery.eq("apply_all_cycles", true)
      : await conflictQuery.eq("apply_all_cycles", false).eq("cycle_id", preferences.cycle_id);
    assertNoError(conflictResult.error);
    const { data, error } = await query.update({
      show_progress: preferences.show_progress,
      show_score: preferences.show_score,
      show_weight: preferences.show_weight,
      apply_all_cycles: preferences.apply_all_cycles,
      cycle_id: preferences.apply_all_cycles ? null : preferences.cycle_id,
      updated_at: new Date().toISOString(),
    }).eq("id", preferences.id).select("*").single();
    assertNoError(error);
    return data as OkrDisplayPreferences;
  }
  const { data, error } = await query.insert({
    ...preferences,
    updated_at: new Date().toISOString(),
  }).select("*").single();
  assertNoError(error);
  return data as OkrDisplayPreferences;
}
