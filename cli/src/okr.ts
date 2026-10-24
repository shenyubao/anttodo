import { CliError } from "./errors.js";

export type OkrStatus = "none" | "normal" | "risk" | "delayed";
export type OkrStatusMode = "manual" | "automatic";
export type OkrUnit = "percent" | "cny" | "usd" | "none" | "custom";
export type OkrCycle = {
  id: string; workspace_id: string; name: string; starts_on: string; ends_on: string;
  status: "draft" | "active" | "closed"; position: number;
};
export type OkrKeyResult = {
  id: string; workspace_id: string; objective_id: string; title: string; note: string;
  position: number; start_value: number; target_value: number; current_value: number | null;
  weight: number; metric_unit: OkrUnit; custom_unit: string | null;
  status_mode: OkrStatusMode; progress_status: OkrStatus; score: number | null;
  responsible_ids: string[]; user_acl_ids: string[]; group_acl_ids: string[];
  breakdowns: Array<{ user_id: string; allocated_value: number }>;
  progress_percent: number | null; effective_status: OkrStatus;
};
export type OkrObjective = Omit<OkrKeyResult, "objective_id" | "weight" | "breakdowns"> & {
  set_id: string; progress_mode: "key_results"; key_results: OkrKeyResult[];
};
export type OkrSet = {
  id: string; workspace_id: string; cycle_id: string; owner_id: string;
  objectives: OkrObjective[]; published_version: number;
};
export type OkrFields = {
  title?: string; note?: string; status_mode?: OkrStatusMode; progress_status?: OkrStatus;
  start_value?: number; target_value?: number; metric_unit?: OkrUnit; custom_unit?: string | null;
};

export function invalidOkr(message: string): never {
  throw new CliError({ type: "validation", code: "invalid_okr_input", message });
}

export function finiteOkrNumber(value: string, field: string) {
  const number = Number(value);
  if (!value.trim() || !Number.isFinite(number)) invalidOkr(`${field} must be a finite number`);
  return number;
}

export function okrChoice<T extends string>(value: string, values: readonly T[], field: string): T {
  if (!values.includes(value as T)) invalidOkr(`${field} must be ${values.join("|")}`);
  return value as T;
}

export function currentOkrCycle(cycles: OkrCycle[], now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const active = cycles.filter((cycle) => cycle.status === "active");
  return active.find((cycle) => cycle.starts_on <= date && cycle.ends_on >= date) ?? active[0] ?? null;
}

export function equalOkrWeights(count: number) {
  if (!count) return [];
  const base = Math.floor(10000 / count) / 100;
  return Array.from({ length: count }, (_, index) => index === count - 1
    ? Number((100 - base * (count - 1)).toFixed(2)) : base);
}

export function nextOkrPosition(rows: Array<{ position: number }>) {
  return rows.length ? Math.min(Math.max(...rows.map((row) => row.position)) + 1, 2_147_483_647) : 0;
}

export function okrProgressPercent(row: { start_value: number; target_value: number; current_value: number | null }) {
  if (row.current_value === null || row.target_value === row.start_value) return null;
  return Math.round(Math.max(0, Math.min(1,
    (row.current_value - row.start_value) / (row.target_value - row.start_value))) * 100);
}

export function automaticOkrStatus(progress: number | null, cycle: OkrCycle, now = new Date()): OkrStatus {
  if (progress === null) return "none";
  const start = new Date(`${cycle.starts_on}T00:00:00`);
  const end = new Date(`${cycle.ends_on}T23:59:59`);
  if (now < start) return "none";
  if (progress >= 100) return "normal";
  if (now > end) return "delayed";
  const elapsed = Math.max(0, Math.min(100, (now.getTime() - start.getTime()) / (end.getTime() - start.getTime()) * 100));
  return elapsed - progress <= 5 ? "normal" : elapsed - progress <= 25 ? "risk" : "delayed";
}

export function normalizeOkrSet(set: OkrSet, cycle: OkrCycle): OkrSet {
  const normalize = (row: OkrKeyResult) => {
    const result = {
      ...row, note: row.note ?? "", start_value: Number(row.start_value), target_value: Number(row.target_value),
      current_value: row.current_value == null ? null : Number(row.current_value),
      score: row.score == null ? null : Number(row.score), weight: Number(row.weight),
      responsible_ids: row.responsible_ids ?? [], user_acl_ids: row.user_acl_ids ?? [], group_acl_ids: row.group_acl_ids ?? [],
      breakdowns: (row.breakdowns ?? []).map((item) => ({ ...item, allocated_value: Number(item.allocated_value) })),
    };
    const progress = okrProgressPercent(result);
    return { ...result, progress_percent: progress,
      effective_status: row.status_mode === "automatic" ? automaticOkrStatus(progress, cycle) : row.progress_status };
  };
  return { ...set, objectives: (set.objectives ?? []).map((objective) => {
    const keyResults = (objective.key_results ?? []).map(normalize);
    const total = keyResults.reduce((sum, kr) => sum + Math.max(0, kr.weight), 0);
    const progress = !keyResults.length ? null : Math.round(keyResults.reduce((sum, kr) =>
      sum + (kr.progress_percent ?? 0) * (total > 0 ? Math.max(0, kr.weight) : 1), 0) / (total || keyResults.length));
    return { ...objective, note: objective.note ?? "", progress_mode: "key_results",
      start_value: Number(objective.start_value), target_value: Number(objective.target_value),
      current_value: objective.current_value == null ? null : Number(objective.current_value),
      score: objective.score == null ? null : Number(objective.score),
      responsible_ids: objective.responsible_ids ?? [], user_acl_ids: objective.user_acl_ids ?? [], group_acl_ids: objective.group_acl_ids ?? [],
      key_results: keyResults, progress_percent: progress,
      effective_status: objective.status_mode === "automatic" ? automaticOkrStatus(progress, cycle) : objective.progress_status,
    };
  }) };
}
