import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRow, throwError } from "./api.js";
import { CliError, asCliError } from "./errors.js";
import { invalidateTaskCachesForWorkspace } from "./cache.js";
import { getActiveServiceKey } from "./storage.js";
import {
  currentOkrCycle, equalOkrWeights, invalidOkr, nextOkrPosition, normalizeOkrSet,
  type OkrCycle, type OkrFields, type OkrSet, type OkrStatus,
} from "./okr.js";

export type OkrContext = { client: SupabaseClient; workspace: { id: string }; user: { id: string } };
type EntityKind = "objective" | "key_result";

export async function listOkrCycles({ client, workspace }: OkrContext) {
  const rows: OkrCycle[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from("okr_cycles").select("*").eq("workspace_id", workspace.id)
      .order("position").order("starts_on", { ascending: false }).order("id").range(offset, offset + 499);
    throwError(error);
    rows.push(...(data ?? []) as OkrCycle[]);
    if ((data?.length ?? 0) < 500) return rows;
  }
}

export async function getOkrCycle(context: OkrContext, id: string): Promise<OkrCycle> {
  const { data, error } = await context.client.from("okr_cycles").select("*")
    .eq("workspace_id", context.workspace.id).eq("id", id).maybeSingle();
  throwError(error);
  return requireRow(data as OkrCycle | null, "OKR cycle");
}

async function resolveCycle(context: OkrContext, cycleId = "current") {
  if (cycleId !== "current") return getOkrCycle(context, cycleId);
  const cycle = currentOkrCycle(await listOkrCycles(context));
  if (!cycle) throw new CliError({ type: "not_found", code: "no_active_okr_cycle", message: "No active OKR cycle is available", hint: "Specify --cycle <id> to read another cycle" });
  return cycle;
}

async function loadSet(context: OkrContext, cycle: OkrCycle, ownerId: string) {
  const { data, error } = await context.client.rpc("load_okr_set", {
    p_workspace_id: context.workspace.id, p_cycle_id: cycle.id, p_owner_id: ownerId,
  });
  throwError(error);
  return data ? normalizeOkrSet(data as OkrSet, cycle) : null;
}

export async function getOkrTree(context: OkrContext, cycleId = "current", ownerId = context.user.id) {
  const cycle = await resolveCycle(context, cycleId);
  return { cycle, set: await loadSet(context, cycle, ownerId) };
}

async function entityRow(context: OkrContext, kind: EntityKind, id: string) {
  const { data, error } = await context.client.from(kind === "objective" ? "okr_objectives" : "okr_key_results")
    .select("*").eq("workspace_id", context.workspace.id).eq("id", id).maybeSingle();
  throwError(error);
  return requireRow(data, kind === "objective" ? "Objective" : "Key Result");
}

export async function getOkrEntityContext(context: OkrContext, kind: EntityKind, id: string) {
  const row = await entityRow(context, kind, id);
  const objectiveRow = kind === "objective" ? row : await entityRow(context, "objective", row.objective_id);
  const { data, error } = await context.client.from("okr_sets").select("*")
    .eq("workspace_id", context.workspace.id).eq("id", objectiveRow.set_id).maybeSingle();
  throwError(error);
  const setRow = requireRow(data, "OKR set");
  const cycle = await getOkrCycle(context, setRow.cycle_id);
  const set = requireRow(await loadSet(context, cycle, setRow.owner_id), "OKR set");
  const objective = requireRow(set.objectives.find((item) => item.id === objectiveRow.id) ?? null, "Objective");
  const keyResult = kind === "key_result"
    ? requireRow(objective.key_results.find((item) => item.id === id) ?? null, "Key Result") : null;
  return { cycle, set, objective, keyResult };
}

export async function getOkrEntity(context: OkrContext, kind: EntityKind, id: string) {
  const target = await getOkrEntityContext(context, kind, id);
  return target.keyResult ?? target.objective;
}

function assertWritable(context: OkrContext, cycle: OkrCycle, ownerId: string) {
  if (ownerId !== context.user.id || cycle.status !== "active") {
    throw new CliError({ type: "authorization", code: "okr_not_writable", message: "Only the OKR owner can write in an active cycle" });
  }
}

function partialFailure(cause: unknown, completed: Record<string, unknown>, hint: string): never {
  const error = asCliError(cause);
  throw new CliError({ type: error.type, code: "okr_partial_failure", message: `OKR operation partially completed: ${error.message}`,
    details: { completed, cause: { code: error.code, message: error.message } }, hint });
}

async function invalidateTasks(workspaceId: string) {
  await invalidateTaskCachesForWorkspace(workspaceId, getActiveServiceKey() ?? "official").catch(() => undefined);
}

export async function createOkrObjective(context: OkrContext, title: string, cycleId = "current") {
  const cycle = await resolveCycle(context, cycleId);
  assertWritable(context, cycle, context.user.id);
  let set = await loadSet(context, cycle, context.user.id);
  let createdSetId: string | undefined;
  if (!set) {
    const { data, error } = await context.client.from("okr_sets").insert({
      workspace_id: context.workspace.id, cycle_id: cycle.id, owner_id: context.user.id, visibility: "workspace",
    }).select("*").single();
    // Another CLI may have created the owner's set concurrently.
    if (error?.code === "23505") set = requireRow(await loadSet(context, cycle, context.user.id), "OKR set");
    else {
      throwError(error);
      set = { ...requireRow(data, "OKR set"), objectives: [] } as OkrSet;
      createdSetId = set.id;
    }
  }
  try {
    const { data, error } = await context.client.from("okr_objectives").insert({
      workspace_id: context.workspace.id, set_id: set.id, title, note: "",
      position: nextOkrPosition(set.objectives), progress_mode: "key_results",
    }).select("*").single();
    throwError(error);
    return requireRow(data, "Objective");
  } catch (error) {
    if (createdSetId) partialFailure(error, { created_set_id: createdSetId }, "Retry objective create; the existing OKR set will be reused");
    throw error;
  }
}

export async function createOkrKeyResult(context: OkrContext, objectiveId: string, title: string) {
  const { cycle, set, objective } = await getOkrEntityContext(context, "objective", objectiveId);
  assertWritable(context, cycle, set.owner_id);
  const weights = equalOkrWeights(objective.key_results.length + 1);
  const { data, error } = await context.client.rpc("create_okr_key_result_with_balanced_weights", {
    p_objective_id: objectiveId, p_workspace_id: context.workspace.id, p_title: title,
    p_position: nextOkrPosition(objective.key_results),
    p_existing_ids: objective.key_results.map((kr) => kr.id),
    p_existing_weights: weights.slice(0, -1), p_new_weight: weights.at(-1),
  });
  throwError(error);
  return requireRow(Array.isArray(data) ? data[0] ?? null : data, "Key Result");
}

export async function updateOkrEntity(context: OkrContext, kind: EntityKind, id: string, fields: OkrFields) {
  if (!Object.keys(fields).length) invalidOkr("Pass at least one field to update");
  const { cycle, set, objective, keyResult } = await getOkrEntityContext(context, kind, id);
  assertWritable(context, cycle, set.owner_id);
  if (kind === "key_result") {
    const unit = fields.metric_unit ?? keyResult!.metric_unit;
    if (unit === "custom" && !(fields.custom_unit ?? keyResult!.custom_unit)?.trim()) invalidOkr("Custom units require --custom-unit");
    if (fields.custom_unit != null && unit !== "custom") invalidOkr("--custom-unit requires --unit custom");
  }
  const change = { id, fields };
  const { data, error } = await context.client.rpc("save_okr_changes", {
    p_set_id: set.id,
    p_changes: { objectives: [kind === "objective" ? change : { id: objective.id, key_results: [change] }] },
    p_publish: false,
  });
  throwError(error);
  const saved = normalizeOkrSet(requireRow(data as OkrSet | null, "Saved OKR set"), cycle);
  const savedObjective = requireRow(saved.objectives.find((item) => item.id === objective.id) ?? null, "Saved Objective");
  return kind === "objective" ? savedObjective : requireRow(savedObjective.key_results.find((item) => item.id === id) ?? null, "Saved Key Result");
}

export async function deleteOkrEntity(context: OkrContext, kind: EntityKind, id: string) {
  const { cycle, set, objective } = await getOkrEntityContext(context, kind, id);
  assertWritable(context, cycle, set.owner_id);
  const { data, error } = await context.client.from(kind === "objective" ? "okr_objectives" : "okr_key_results")
    .delete().eq("workspace_id", context.workspace.id).eq("id", id).select("id").maybeSingle();
  throwError(error);
  requireRow(data, "Deleted OKR entity");
  await invalidateTasks(context.workspace.id);
  if (kind === "key_result") {
    try {
      // Reload after deletion so concurrently added KRs participate in rebalancing.
      const fresh = requireRow(await loadSet(context, cycle, set.owner_id), "OKR set");
      const current = requireRow(fresh.objectives.find((o) => o.id === objective.id) ?? null, "Objective");
      const weights = equalOkrWeights(current.key_results.length);
      if (weights.length) {
        const saved = await context.client.rpc("save_okr_changes", {
          p_set_id: set.id, p_publish: false, p_changes: { objectives: [{ id: objective.id,
            key_results: current.key_results.map((kr, index) => ({ id: kr.id, fields: { weight: weights[index] } })),
          }] },
        });
        throwError(saved.error);
        requireRow(saved.data, "Rebalanced OKR set");
      }
    } catch (cause) {
      partialFailure(cause, { deleted_key_result_id: id, objective_id: objective.id }, "The KR was deleted. Review and rebalance the remaining KR weights in the app before publishing; do not retry the deletion");
    }
  }
  return { id, deleted: true };
}

export async function updateOkrProgress(context: OkrContext, id: string, patch: { value?: number | null; status?: OkrStatus; detail?: string }) {
  const { cycle, set, keyResult } = await getOkrEntityContext(context, "key_result", id);
  assertWritable(context, cycle, set.owner_id);
  const { data, error } = await context.client.rpc("update_okr_key_result_progress", {
    p_key_result_id: id, p_current_value: patch.value === undefined ? keyResult!.current_value : patch.value,
    p_status: patch.status ?? keyResult!.progress_status, p_detail: patch.detail ?? "",
  });
  throwError(error);
  return requireRow(data, "Updated Key Result");
}

export async function publishOkr(context: OkrContext, cycleId = "current") {
  const { cycle, set } = await getOkrTree(context, cycleId);
  const current = requireRow(set, "OKR set");
  assertWritable(context, cycle, current.owner_id);
  const { data, error } = await context.client.rpc("publish_okr_set", { p_set_id: current.id });
  throwError(error);
  return requireRow(data, "Published OKR set");
}

async function taskRow(context: OkrContext, taskId: string) {
  const { data, error } = await context.client.from("tasks").select("id,workspace_id,kind,deleted_at")
    .eq("workspace_id", context.workspace.id).eq("id", taskId).maybeSingle();
  throwError(error);
  const task = requireRow(data, "Task");
  if (task.kind !== "todo" || task.deleted_at) invalidOkr("Only active todos can be linked to OKR");
  return task;
}

export async function setOkrTaskLink(context: OkrContext, taskId: string, keyResultId: string | null) {
  await taskRow(context, taskId);
  if (keyResultId) {
    const { cycle, set } = await getOkrEntityContext(context, "key_result", keyResultId);
    assertWritable(context, cycle, set.owner_id);
  }
  // Unlink must also work when the previous KR has become inaccessible or its cycle closed.
  const { data, error } = await context.client.rpc("set_task_okr_link", { p_task_id: taskId, p_key_result_id: keyResultId });
  throwError(error);
  await invalidateTasks(context.workspace.id);
  return keyResultId ? requireRow(data, "Task OKR link") : { task_id: taskId, key_result_id: null };
}

export async function listOkrTasks(context: OkrContext, kind: EntityKind, id: string, limit: number, offset: number) {
  const { objective, keyResult } = await getOkrEntityContext(context, kind, id);
  const ids = keyResult ? [keyResult.id] : objective.key_results.map((kr) => kr.id);
  if (!ids.length) return [];
  // Bound URLs and paginate each batch before applying the requested global page.
  const rows: Record<string, unknown>[] = [];
  for (let start = 0; start < ids.length; start += 80) {
    for (let from = 0; ; from += 500) {
      const { data, error } = await context.client.from("task_okr_links")
        .select("task_id,key_result_id,tasks!inner(id,workspace_id,parent_task_id,title,kind,status,due_at,assignee_id,deleted_at,updated_at)")
        .eq("workspace_id", context.workspace.id).in("key_result_id", ids.slice(start, start + 80))
        .is("tasks.deleted_at", null).order("task_id").range(from, from + 499);
      throwError(error);
      for (const link of data ?? []) {
        const task = Array.isArray(link.tasks) ? link.tasks[0] : link.tasks;
        if (task) rows.push({ ...task, task_id: link.task_id, key_result_id: link.key_result_id });
      }
      if ((data?.length ?? 0) < 500) break;
    }
  }
  return rows.sort((a, b) => String(a.task_id).localeCompare(String(b.task_id))).slice(offset, offset + limit);
}
