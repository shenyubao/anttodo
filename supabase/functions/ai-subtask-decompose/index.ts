import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  deepseekChatCompletion,
  extractJsonText,
} from "../_shared/deepseek.ts";
import { resolveUser } from "../_shared/resolveUser.ts";

type DecomposeRequest = {
  action: "decompose";
  workspaceId: string;
  taskId: string;
  nowIso?: string;
  timeZone?: string;
};

type Contact = {
  user_id: string;
  display_name: string;
};

type SuggestedSubtask = {
  title: string;
  assignee_user_id: string | null;
  due_at: string | null;
};

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDueAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeSuggestions(
  raw: unknown,
  contactIds: Set<string>,
): SuggestedSubtask[] {
  let items: unknown[] = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (isRecord(raw) && Array.isArray(raw.subtasks)) {
    items = raw.subtasks;
  } else if (isRecord(raw) && Array.isArray(raw.items)) {
    items = raw.items;
  }

  const result: SuggestedSubtask[] = [];
  const seenTitles = new Set<string>();

  for (const item of items) {
    if (!isRecord(item)) continue;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title || title.length > 200) continue;
    const titleKey = title.toLowerCase();
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);

    let assigneeId: string | null = null;
    if (
      typeof item.assignee_user_id === "string" &&
      contactIds.has(item.assignee_user_id)
    ) {
      assigneeId = item.assignee_user_id;
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

function buildPrompt(input: {
  title: string;
  description: string;
  existingSubtasks: string[];
  contacts: Contact[];
  nowIso: string;
  timeZone: string;
}) {
  const contactLines = input.contacts.length
    ? input.contacts
      .map((contact) => `- ${contact.display_name} (user_id: ${contact.user_id})`)
      .join("\n")
    : "(无可用联系人)";
  const existing = input.existingSubtasks.length
    ? input.existingSubtasks.map((title) => `- ${title}`).join("\n")
    : "(暂无子任务)";

  return `你是团队待办助手。请把下面的父任务拆成 3~12 条可执行的子任务。

规则：
1. 只输出 JSON（不要 markdown 代码块），格式为 {"subtasks":[{"title":"...","assignee_user_id":null,"due_at":null},...]}。
2. title 必填，简洁可执行，中文优先，不超过 60 字。
3. assignee_user_id 只能填 contacts 里的 user_id；不确定则 null。
4. due_at 使用 ISO 8601 字符串；不确定则 null。若只有日期，用该日本地上午 09:00 再转 ISO。
5. 不要重复「已有子任务」中的标题。
6. 结合当前时间与时区理解「今天/明天/下周」等表述。

当前时间：${input.nowIso}
时区：${input.timeZone}

父任务标题：
${input.title}

父任务描述：
${input.description || "(无描述)"}

已有子任务：
${existing}

组织联系人：
${contactLines}`;
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);

    const user = await resolveUser(req, ctx.supabaseAdmin);
    if (!user) return jsonError("Authentication required", 401);

    const body = await req.json().catch(() => null) as DecomposeRequest | null;
    if (
      body?.action !== "decompose" ||
      typeof body.workspaceId !== "string" ||
      typeof body.taskId !== "string"
    ) {
      return jsonError("Invalid request");
    }

    const workspaceId = body.workspaceId.trim();
    const taskId = body.taskId.trim();
    if (!workspaceId || !taskId) return jsonError("Invalid request");

    const { data: membership, error: membershipError } = await ctx.supabaseAdmin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (membershipError || !membership) {
      return jsonError("Workspace not found", 404);
    }

    const { data: task, error: taskError } = await ctx.supabaseAdmin
      .from("tasks")
      .select("id, workspace_id, title, description, kind, deleted_at")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError || !task || task.deleted_at) {
      return jsonError("Task not found", 404);
    }
    if (task.workspace_id !== workspaceId) {
      return jsonError("Task not found", 404);
    }
    if (task.kind === "note") {
      return jsonError("Notes cannot have subtasks", 400);
    }

    const [{ data: members }, { data: existingSubtasks }] = await Promise.all([
      ctx.supabaseAdmin
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId),
      ctx.supabaseAdmin
        .from("subtasks")
        .select("title")
        .eq("task_id", taskId)
        .order("position", { ascending: true }),
    ]);

    const memberIds = (members ?? []).map((row) => row.user_id as string);
    const { data: profiles } = memberIds.length
      ? await ctx.supabaseAdmin
        .from("profiles")
        .select("id, display_name")
        .in("id", memberIds)
      : { data: [] as Array<{ id: string; display_name: string | null }> };

    const profileById = new Map(
      (profiles ?? []).map((profile) => [profile.id as string, profile]),
    );
    const contacts: Contact[] = memberIds.map((userId) => {
      const profile = profileById.get(userId);
      const displayName =
        typeof profile?.display_name === "string" && profile.display_name.trim()
          ? profile.display_name.trim()
          : "团队成员";
      return { user_id: userId, display_name: displayName };
    });
    const contactIds = new Set(contacts.map((contact) => contact.user_id));

    const nowIso =
      typeof body.nowIso === "string" && body.nowIso.trim()
        ? body.nowIso.trim()
        : new Date().toISOString();
    const timeZone =
      typeof body.timeZone === "string" && body.timeZone.trim()
        ? body.timeZone.trim()
        : "UTC";

    let modelText: string;
    try {
      modelText = await deepseekChatCompletion({
        messages: [
          {
            role: "system",
            content:
              "你是精准的任务分解助手。只输出合法 JSON 对象，键为 subtasks（数组）。",
          },
          {
            role: "user",
            content: buildPrompt({
              title: String(task.title ?? ""),
              description: String(task.description ?? ""),
              existingSubtasks: (existingSubtasks ?? [])
                .map((item) => String(item.title ?? "").trim())
                .filter(Boolean),
              contacts,
              nowIso,
              timeZone,
            }),
          },
        ],
        responseFormat: { type: "json_object" },
        temperature: 0.35,
        maxTokens: 2048,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 分解失败";
      if (message.includes("not configured")) {
        return jsonError("AI 分解尚未配置，请联系管理员。", 503);
      }
      return jsonError(message || "AI 分解失败，请稍后重试。", 502);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonText(modelText));
    } catch {
      return jsonError("AI 返回格式无法解析，请重试。", 502);
    }

    const subtasks = normalizeSuggestions(parsed, contactIds);
    if (!subtasks.length) {
      return jsonError("未能生成可用的子任务建议，请完善任务描述后重试。", 422);
    }

    return Response.json({ subtasks });
  }),
};
