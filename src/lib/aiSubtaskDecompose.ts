export type AiSuggestedSubtask = {
  title: string;
  assignee_user_id: string | null;
  due_at: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Demo tour IDs are not real Postgres UUIDs (e.g. workspace-team / task-1). */
export function isLocalDemoTaskContext(workspaceId: string, taskId: string) {
  return !UUID_RE.test(workspaceId) || !UUID_RE.test(taskId);
}

/**
 * Offline / `?demo=1` stand-in so the confirm panel can be exercised without a
 * signed-in user or Edge Function call.
 */
export function buildDemoAiSuggestedSubtasks(input: {
  title: string;
  description?: string;
  existingTitles?: string[];
}): AiSuggestedSubtask[] {
  const title = input.title.trim() || "任务";
  const existing = new Set(
    (input.existingTitles ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean),
  );
  const drafts = [
    `梳理「${title}」目标与验收标准`,
    `列出所需资料与负责人`,
    `拆解关键步骤并排出优先级`,
    `安排跟进节奏与截止时间`,
    `复盘结果并更新任务状态`,
  ];
  const result: AiSuggestedSubtask[] = [];
  for (const draft of drafts) {
    if (existing.has(draft.toLowerCase())) continue;
    result.push({
      title: draft,
      assignee_user_id: null,
      due_at: null,
    });
    if (result.length >= 5) break;
  }
  return result;
}

export function normalizeDueAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** Normalize raw AI / edge response rows for UI and insert. */
export function normalizeAiSuggestedSubtasks(
  raw: unknown,
  options?: { assignableUserIds?: Iterable<string> },
): AiSuggestedSubtask[] {
  let items: unknown[] = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (isRecord(raw) && Array.isArray(raw.subtasks)) {
    items = raw.subtasks;
  }

  const assignable = options?.assignableUserIds
    ? new Set(options.assignableUserIds)
    : null;
  const result: AiSuggestedSubtask[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!isRecord(item)) continue;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title || title.length > 200) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let assigneeId: string | null =
      typeof item.assignee_user_id === "string" && item.assignee_user_id.trim()
        ? item.assignee_user_id.trim()
        : null;
    if (assigneeId && assignable && !assignable.has(assigneeId)) {
      assigneeId = null;
    }

    result.push({
      title,
      assignee_user_id: assigneeId,
      due_at: normalizeDueAt(item.due_at),
    });
    if (result.length >= 12) break;
  }

  return result;
}

export function formatAiSuggestedDueAt(dueAt: string | null | undefined): string | null {
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

export function buildSubtaskExtrasFromSuggestion(
  suggestion: AiSuggestedSubtask,
  assignableUserIds?: Iterable<string>,
): Partial<{ due_at: string | null; assignee_id: string | null }> {
  const assignable = assignableUserIds ? new Set(assignableUserIds) : null;
  const assigneeId =
    suggestion.assignee_user_id &&
    (!assignable || assignable.has(suggestion.assignee_user_id))
      ? suggestion.assignee_user_id
      : null;
  const dueAt = normalizeDueAt(suggestion.due_at);
  return {
    assignee_id: assigneeId,
    due_at: dueAt,
  };
}
