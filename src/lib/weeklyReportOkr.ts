import { addDays, format, parseISO } from "date-fns";
import type { OkrCycle, OkrObjective, OkrProgressRecord } from "../types";
import { OKR_STATUS_LABELS, okrProgressPercent } from "./okr";
import { okrObjectiveProgressAt, okrValueAt, sortedOkrRecords } from "./okrHistory";

export type WeeklyReportOkrObjective = {
  cycle: OkrCycle;
  ownerId: string;
  objective: OkrObjective;
  selectableKeyResultIds: string[];
};
export type WeeklyReportOkrData = {
  objectives: WeeklyReportOkrObjective[];
  records: OkrProgressRecord[];
};

export function selectableWeeklyReportOkrObjectives(
  entries: Omit<WeeklyReportOkrObjective, "selectableKeyResultIds">[], currentUserId: string,
): WeeklyReportOkrObjective[] {
  return entries.filter((entry) => entry.cycle.status === "active").map((entry) => ({
    ...entry,
    selectableKeyResultIds: entry.objective.key_results.filter((kr) =>
      entry.ownerId === currentUserId || entry.objective.responsible_ids.includes(currentUserId)
      || kr.responsible_ids.includes(currentUserId)).map((kr) => kr.id),
  })).filter((entry) => entry.ownerId === currentUserId
    || entry.objective.responsible_ids.includes(currentUserId) || entry.selectableKeyResultIds.length > 0);
}

export function weeklyReportOkrBounds(weekStart: string, now = new Date()) {
  const start = parseISO(weekStart).getTime();
  const nextWeek = addDays(parseISO(weekStart), 7).getTime();
  return { start, end: Math.min(now.getTime() + 1, nextWeek) };
}

export function weeklyReportOkrRecords(data: WeeklyReportOkrData, weekStart: string, all: boolean) {
  const ids = new Set(data.objectives.flatMap((entry) => entry.selectableKeyResultIds));
  const start = parseISO(weekStart).getTime();
  const end = addDays(parseISO(weekStart), 7).getTime();
  return sortedOkrRecords(data.records.filter((record) => record.key_result_id && ids.has(record.key_result_id)
    && (all || (new Date(record.created_at).getTime() >= start && new Date(record.created_at).getTime() < end))));
}

export function escapeOkrReportText(value: string) {
  return value.replace(/([\\`*_{}\[\]()#+\-.!><|~])/g, "\\$1");
}

function progressChange(before: number | null, after: number | null) {
  const display = (value: number | null) => value === null ? "暂无" : `${value}%`;
  return before === after ? display(after) : `${display(before)}->${display(after)}`;
}

export function generateWeeklyReportOkr(
  data: WeeklyReportOkrData, selectedIds: ReadonlySet<string>, weekStart: string, now = new Date(),
) {
  const { start, end } = weeklyReportOkrBounds(weekStart, now);
  const lines: string[] = [];
  for (const entry of data.objectives) {
    const objectiveLines: string[] = [];
    for (const kr of entry.objective.key_results) {
      if (!entry.selectableKeyResultIds.includes(kr.id)) continue;
      const records = sortedOkrRecords(data.records.filter((record) => record.key_result_id === kr.id));
      const selected = records.filter((record) => selectedIds.has(record.id));
      if (!selected.length) continue;
      const progressAt = (time: number) => okrProgressPercent({
        ...kr, current_value: okrValueAt(records, time, kr.current_value),
      });
      objectiveLines.push(`  - ${escapeOkrReportText(kr.title.replace(/\s*\n\s*/g, " "))} ${progressChange(progressAt(start), progressAt(end))}`);
      for (const record of selected) {
        const detail = escapeOkrReportText(record.detail.trim()).replace(/\r?\n/g, "  \n      ");
        objectiveLines.push(`    - ${format(parseISO(record.created_at), "MMdd")} ${OKR_STATUS_LABELS[record.current_status]}${detail ? ` ${detail}` : ""}`);
      }
    }
    if (!objectiveLines.length) continue;
    lines.push(`- ${escapeOkrReportText(entry.objective.title.replace(/\s*\n\s*/g, " "))} ${progressChange(
      okrObjectiveProgressAt(entry.objective, data.records, start),
      okrObjectiveProgressAt(entry.objective, data.records, end),
    )}`, ...objectiveLines);
  }
  return lines.join("\n");
}
