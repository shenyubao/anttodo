export type AiFormatSuggestion = {
  title: string;
  description: string | null;
  due_at: string | null;
  acceptance_criteria: string | null;
  references: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeDueAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function formatAiDueAt(dueAt: string | null | undefined): string | null {
  if (!dueAt) return null;
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return null;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  if (hours === 0 && minutes === 0) return `${month}月${day}日`;
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return `${month}月${day}日 ${hh}:${mm}`;
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

/** Normalize a raw AI / edge response for a task format suggestion. */
export function normalizeAiFormatSuggestion(raw: unknown): AiFormatSuggestion | null {
  if (!isRecord(raw)) return null;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title || title.length > 200) return null;
  return {
    title,
    description: normalizeOptionalText(raw.description, 8000),
    due_at: normalizeDueAt(raw.due_at),
    acceptance_criteria: normalizeOptionalText(raw.acceptance_criteria, 4000),
    references: normalizeOptionalText(raw.references, 4000),
  };
}

/** Compose description markdown when the user adopts a format suggestion. */
export function buildFormattedDescription(suggestion: AiFormatSuggestion): string {
  const parts: string[] = [];
  if (suggestion.description?.trim()) {
    parts.push(suggestion.description.trim());
  }
  if (suggestion.acceptance_criteria?.trim()) {
    parts.push(`## 验收标准\n${suggestion.acceptance_criteria.trim()}`);
  }
  if (suggestion.references?.trim()) {
    parts.push(`## 参考资料\n${suggestion.references.trim()}`);
  }
  return parts.join("\n\n");
}

/** Whether a due_at instant falls on local midnight (00:00), treated as all-day. */
export function isMidnightLocalDueAt(dueAt: string, timeZone?: string): boolean {
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return false;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
    return hour === 0 && minute === 0;
  } catch {
    return date.getHours() === 0 && date.getMinutes() === 0;
  }
}
