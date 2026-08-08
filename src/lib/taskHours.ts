export function coerceHours(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 10) / 10;
}

/** Convert focus elapsed seconds to hours at 0.1 precision; null if too small to register. */
export function hoursFromFocusSeconds(elapsedSeconds: number): number | null {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return null;
  const delta = coerceHours(elapsedSeconds / 3600);
  if (delta == null || delta === 0) return null;
  return delta;
}

export function appendActualHours(
  current: number | null | undefined,
  delta: number,
): number {
  return coerceHours((current ?? 0) + delta) ?? delta;
}

export type ParsedEstimateHoursMatch = {
  start: number;
  end: number;
  text: string;
};

export type ParsedEstimateHours = {
  estimateHours: number;
  title: string;
  match: ParsedEstimateHoursMatch;
};

const ESTIMATE_HOURS_PATTERN = /~(\d+(?:\.\d)?)\s*[hH]\b/;

export function normalizeHoursInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("工时须为非负数字");
  }
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(value - rounded) > 1e-9) {
    throw new Error("工时最多保留一位小数");
  }
  return rounded;
}

export function formatHoursValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function formatHoursDetail(
  estimateHours: number | null | undefined,
  actualHours: number | null | undefined,
): string | null {
  const parts: string[] = [];
  if (estimateHours != null) parts.push(`预计：${formatHoursValue(estimateHours)}小时`);
  if (actualHours != null) parts.push(`实际：${formatHoursValue(actualHours)}小时`);
  return parts.length > 0 ? parts.join("，") : null;
}

export function formatHoursList(
  estimateHours: number | null | undefined,
  actualHours: number | null | undefined,
): string | null {
  const parts: string[] = [];
  if (estimateHours != null) parts.push(`预:${formatHoursValue(estimateHours)}小时`);
  if (actualHours != null) parts.push(`耗:${formatHoursValue(actualHours)}小时`);
  return parts.length > 0 ? parts.join(" ") : null;
}

export function parseEstimateHoursText(title: string): ParsedEstimateHours | null {
  const match = ESTIMATE_HOURS_PATTERN.exec(title);
  if (!match || match.index == null) return null;

  const rawNumber = match[1];
  const value = Number(rawNumber);
  if (!Number.isFinite(value) || value < 0) return null;

  // Reject more than one decimal digit (e.g. ~0.25h)
  if (rawNumber.includes(".") && rawNumber.split(".")[1]!.length > 1) return null;

  const estimateHours = Math.round(value * 10) / 10;
  const start = match.index;
  const end = start + match[0].length;
  const nextTitle = `${title.slice(0, start)}${title.slice(end)}`
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    estimateHours,
    title: nextTitle,
    match: {
      start,
      end,
      text: match[0],
    },
  };
}
