import type {
  OkrCycle,
  OkrKeyResult,
  OkrMetricUnit,
  OkrObjective,
  OkrProgressStatus,
} from "../types";

export const OKR_STATUS_LABELS: Record<OkrProgressStatus, string> = {
  none: "暂无",
  normal: "正常",
  risk: "风险",
  delayed: "延期",
};

export const OKR_UNIT_LABELS: Record<OkrMetricUnit, string> = {
  percent: "%",
  cny: "元",
  usd: "美元",
  none: "",
  custom: "自定义",
};

export const POSTGRES_INTEGER_MAX = 2_147_483_647;

export function nextOkrPosition(currentMax: unknown) {
  const value = Number(currentMax);
  if (!Number.isInteger(value) || value < 0) return 0;
  return Math.min(value + 1, POSTGRES_INTEGER_MAX);
}

export function okrMetricUnitLabel(unit: OkrMetricUnit, customUnit?: string | null) {
  return unit === "custom" ? customUnit?.trim() || "" : OKR_UNIT_LABELS[unit];
}

export function filterVisibleOkrMembers<T extends {
  user_id: string;
  profile?: { display_name?: string | null } | null;
}>(members: T[], visibleOwnerIds: ReadonlySet<string>, search: string) {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return members.filter((member) => visibleOwnerIds.has(member.user_id)
    && (member.profile?.display_name ?? "团队成员").toLocaleLowerCase().includes(normalizedSearch));
}

export function okrProgressPercent(input: {
  start_value: number;
  target_value: number;
  current_value: number | null;
}) {
  if (input.current_value === null || input.target_value === input.start_value) return null;
  const ratio = (input.current_value - input.start_value)
    / (input.target_value - input.start_value);
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
}

export function okrObjectiveProgress(objective: OkrObjective) {
  if (!objective.key_results.length) return null;
  const measured = objective.key_results
    .map((kr) => ({ percent: okrProgressPercent(kr) ?? 0, weight: Number(kr.weight) }));
  const totalWeight = measured.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (totalWeight <= 0) {
    return Math.round(measured.reduce((sum, entry) => sum + entry.percent, 0) / measured.length);
  }
  return Math.round(measured.reduce(
    (sum, entry) => sum + entry.percent * Math.max(0, entry.weight),
    0,
  ) / totalWeight);
}

export function automaticOkrStatus(
  progress: number | null,
  cycle: Pick<OkrCycle, "starts_on" | "ends_on">,
  now = new Date(),
): OkrProgressStatus {
  if (progress === null) return "none";
  const start = new Date(`${cycle.starts_on}T00:00:00`);
  const end = new Date(`${cycle.ends_on}T23:59:59`);
  if (now < start) return "none";
  if (progress >= 100) return "normal";
  if (now > end) return "delayed";
  const elapsed = Math.max(0, Math.min(100,
    ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100));
  const lag = elapsed - progress;
  if (lag <= 5) return "normal";
  if (lag <= 25) return "risk";
  return "delayed";
}

export function equalOkrWeights(count: number, total = 100) {
  if (count <= 0) return [];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count) / 100;
  const result = Array.from({ length: count }, () => base);
  result[result.length - 1] = Number((total - base * (count - 1)).toFixed(2));
  return result;
}

function okrWeightFilled(weight: unknown) {
  const value = Number(weight);
  return Number.isFinite(value) && value > 0;
}

export function withRebalancedOkrWeights<T extends Pick<OkrKeyResult, "weight">>(keyResults: T[]): T[] {
  const weights = equalOkrWeights(keyResults.length);
  return keyResults.map((keyResult, index) => ({
    ...keyResult,
    weight: weights[index] ?? Number(keyResult.weight),
  }));
}

export function withDefaultOkrWeights<T extends Pick<OkrKeyResult, "weight">>(keyResults: T[]) {
  if (!keyResults.length || okrWeightsValid(keyResults)) return keyResults;
  if (keyResults.length === 1) {
    return [{ ...keyResults[0], weight: 100 }];
  }

  const values = keyResults.map((keyResult) => Number(keyResult.weight));
  const unfilledIndexes = values.flatMap((value, index) => (
    !okrWeightFilled(value) ? [index] : []
  ));
  const allDefault = keyResults.length > 1 && values.every((value) => value === 100);

  if (unfilledIndexes.length === keyResults.length || allDefault) {
    const weights = equalOkrWeights(keyResults.length);
    return keyResults.map((keyResult, index) => ({ ...keyResult, weight: weights[index]! }));
  }

  if (unfilledIndexes.length > 0) {
    const filledSum = values.reduce((sum, value, index) => (
      unfilledIndexes.includes(index) ? sum : sum + value
    ), 0);
    const remaining = Number((100 - filledSum).toFixed(2));
    if (remaining > 0) {
      const parts = equalOkrWeights(unfilledIndexes.length, remaining);
      return keyResults.map((keyResult, index) => {
        const partIndex = unfilledIndexes.indexOf(index);
        return partIndex >= 0 ? { ...keyResult, weight: parts[partIndex]! } : keyResult;
      });
    }
  }

  return keyResults;
}

export function okrWeightsValid(keyResults: Array<Pick<OkrKeyResult, "weight">>) {
  if (!keyResults.length) return true;
  const total = keyResults.reduce((sum, keyResult) => sum + Number(keyResult.weight), 0);
  return Math.abs(total - 100) < 0.001;
}

const OKR_DISCOVERABILITY_TABLES = new Set([
  "okr_sets",
  "okr_set_user_acl",
  "okr_set_group_acl",
  "okr_objectives",
  "okr_objective_user_acl",
  "okr_objective_group_acl",
  "okr_key_result_user_acl",
  "okr_key_result_group_acl",
  "okr_access_revisions",
  "user_group_members",
]);

/**
 * Returns whether a Realtime change can alter the owners/objectives visible to
 * the viewer. Ordinary Key Result writes only change nested OKR content.
 * Visibility edits also touch okr_access_revisions, while publishing touches
 * the containing set/objective. Deletes stay conservative because removing the
 * last published Key Result can make a restricted Objective disappear.
 */
export function okrRealtimeAffectsDiscoverability(table: string, eventType?: string) {
  if (table === "okr_key_results") return eventType === "DELETE";
  return OKR_DISCOVERABILITY_TABLES.has(table);
}

export function okrBreakdownsValid(
  keyResult: Pick<OkrKeyResult, "target_value" | "breakdowns">,
) {
  if (!keyResult.breakdowns.length) return true;
  const total = keyResult.breakdowns.reduce(
    (sum, breakdown) => sum + Number(breakdown.allocated_value),
    0,
  );
  return Math.abs(total - Math.abs(Number(keyResult.target_value))) < 0.000001;
}

export function okrPublishBlockingMessage(
  objectives: Array<{
    title: string;
    key_results: Array<Pick<OkrKeyResult, "weight" | "target_value" | "breakdowns"> & { title?: string }>;
  }>,
) {
  for (const objective of objectives) {
    const keyResults = withDefaultOkrWeights(objective.key_results);
    if (!okrWeightsValid(keyResults)) {
      return `无法发布：「${objective.title}」的 Key Result 权重之和必须等于 100%`;
    }
    const invalidBreakdown = keyResults.find((keyResult) => !okrBreakdownsValid(keyResult));
    if (invalidBreakdown) {
      return `无法发布：「${invalidBreakdown.title || objective.title}」的拆解额度必须等于目标值`;
    }
  }
  return null;
}

export function publishOkrErrorMessage(message: string) {
  const weight = message.match(/Key Result weights must add up to 100(?: for objective "([^"]+)")?/);
  if (weight) {
    return weight[1]
      ? `无法发布：「${weight[1]}」的 Key Result 权重之和必须等于 100%`
      : "无法发布：存在 Key Result 权重之和不等于 100% 的 Objective";
  }
  const breakdown = message.match(
    /Key Result breakdown allocations must equal the target value(?: for "([^"]+)")?/,
  );
  if (breakdown) {
    return breakdown[1]
      ? `无法发布：「${breakdown[1]}」的拆解额度必须等于目标值`
      : "无法发布：存在拆解额度与目标值不一致的 Key Result";
  }
  if (message.includes("Only the OKR owner can publish")) {
    return "只有负责人可以在进行中的周期发布 OKR";
  }
  return message;
}

export function importedOkrObjectives(objectives: OkrObjective[], workspaceId: string) {
  const objectiveIds = new Map<string, string>();
  const nextId = () => crypto.randomUUID();
  for (const objective of objectives) objectiveIds.set(objective.id, nextId());
  return objectives.map((objective, objectiveIndex): OkrObjective => {
    const objectiveId = objectiveIds.get(objective.id)!;
    return {
      ...objective,
      id: objectiveId,
      set_id: "",
      workspace_id: workspaceId,
      position: objectiveIndex,
      visibility: "inherit",
      user_acl_ids: [],
      group_acl_ids: [],
      progress_status: "none",
      current_value: null,
      score: null,
      published_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      alignment_target_id: null,
      key_results: objective.key_results.map((kr, krIndex) => {
        const keyResultId = nextId();
        return {
          ...kr,
          id: keyResultId,
          objective_id: objectiveId,
          workspace_id: workspaceId,
          position: krIndex,
          visibility: "inherit",
          user_acl_ids: [],
          group_acl_ids: [],
          progress_status: "none",
          current_value: null,
          score: null,
          published_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          breakdowns: kr.breakdowns.map((breakdown, position) => ({
            ...breakdown,
            id: nextId(),
            key_result_id: keyResultId,
            workspace_id: workspaceId,
            position,
          })),
        };
      }),
    };
  });
}

export type OkrSnapshotChange = {
  kind: "objective" | "key_result";
  id: string;
  change: "added" | "changed" | "removed";
};

function snapshotEntries(snapshot: Record<string, unknown> | null | undefined) {
  const entries = new Map<string, { kind: "objective" | "key_result"; value: string }>();
  const objectives = Array.isArray(snapshot?.objectives) ? snapshot.objectives : [];
  for (const rawObjective of objectives) {
    if (!rawObjective || typeof rawObjective !== "object") continue;
    const objective = rawObjective as Record<string, unknown>;
    const id = String(objective.id ?? "");
    if (id) entries.set(`objective:${id}`, {
      kind: "objective",
      value: JSON.stringify({ title: objective.title, note: objective.note }),
    });
    const keyResults = Array.isArray(objective.keyResults)
      ? objective.keyResults
      : Array.isArray(objective.key_results)
        ? objective.key_results
        : [];
    for (const rawKeyResult of keyResults) {
      if (!rawKeyResult || typeof rawKeyResult !== "object") continue;
      const keyResult = rawKeyResult as Record<string, unknown>;
      const keyResultId = String(keyResult.id ?? "");
      if (keyResultId) entries.set(`key_result:${keyResultId}`, {
        kind: "key_result",
        value: JSON.stringify(keyResult),
      });
    }
  }
  return entries;
}

export function okrSnapshotDiff(
  current: Record<string, unknown> | null | undefined,
  previous: Record<string, unknown> | null | undefined,
) {
  const currentEntries = snapshotEntries(current);
  const previousEntries = snapshotEntries(previous);
  const changes: OkrSnapshotChange[] = [];
  for (const [key, entry] of currentEntries) {
    const before = previousEntries.get(key);
    changes.push(...(!before
      ? [{ kind: entry.kind, id: key.split(":")[1], change: "added" as const }]
      : before.value !== entry.value
        ? [{ kind: entry.kind, id: key.split(":")[1], change: "changed" as const }]
        : []));
  }
  for (const [key, entry] of previousEntries) {
    if (!currentEntries.has(key)) changes.push({
      kind: entry.kind,
      id: key.split(":")[1],
      change: "removed",
    });
  }
  return changes;
}
