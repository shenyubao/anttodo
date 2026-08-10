import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  deepseekChatCompletion,
  extractJsonText,
} from "../_shared/deepseek.ts";
import {
  buildSmartFormatPrompt,
  buildSubtaskDecomposePrompt,
  normalizeAiPromptOverride,
  type AiPromptContact,
} from "../_shared/ai-feature-prompts.ts";
import { resolveUser } from "../_shared/resolveUser.ts";

type AiTaskRequest = {
  action: "decompose" | "format";
  workspaceId: string;
  taskId: string;
  nowIso?: string;
  timeZone?: string;
};

type SuggestedSubtask = {
  title: string;
  assignee_user_id: string | null;
  due_at: string | null;
};

type FormatSuggestion = {
  title: string;
  description: string | null;
  due_at: string | null;
  acceptance_criteria: string | null;
  references: string | null;
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

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
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

function normalizeFormatSuggestion(raw: unknown): FormatSuggestion | null {
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

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);

    const user = await resolveUser(req, ctx.supabaseAdmin);
    if (!user) return jsonError("Authentication required", 401);

    const body = await req.json().catch(() => null) as AiTaskRequest | null;
    if (
      (body?.action !== "decompose" && body?.action !== "format")
      || typeof body.workspaceId !== "string"
      || typeof body.taskId !== "string"
    ) {
      return jsonError("Invalid request");
    }

    const action = body.action;
    const workspaceId = body.workspaceId.trim();
    const taskId = body.taskId.trim();
    if (!workspaceId || !taskId) return jsonError("Invalid request");

    const { data: featureSettings, error: featureSettingsError } =
      await ctx.supabaseAdmin
        .from("user_ai_feature_settings")
        .select(
          "smart_format_enabled, smart_format_prompt_override, subtask_decompose_enabled, subtask_decompose_prompt_override",
        )
        .eq("user_id", user.id)
        .maybeSingle();
    if (featureSettingsError) {
      return jsonError("AI 功能设置读取失败，请稍后重试。", 500);
    }

    const featureEnabled = action === "format"
      ? featureSettings?.smart_format_enabled ?? true
      : featureSettings?.subtask_decompose_enabled ?? true;
    if (!featureEnabled) {
      return jsonError(
        action === "format"
          ? "智能格式化已在设置中关闭。"
          : "智能分解子任务已在设置中关闭。",
        403,
      );
    }

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

    if (action === "decompose" && task.kind === "note") {
      return jsonError("Notes cannot have subtasks", 400);
    }

    const nowIso =
      typeof body.nowIso === "string" && body.nowIso.trim()
        ? body.nowIso.trim()
        : new Date().toISOString();
    const timeZone =
      typeof body.timeZone === "string" && body.timeZone.trim()
        ? body.timeZone.trim()
        : "UTC";

    const taskTitle = String(task.title ?? "");
    const taskDescription = String(task.description ?? "");

    if (action === "format") {
      let modelText: string;
      try {
        modelText = await deepseekChatCompletion({
          messages: [
            {
              role: "system",
              content:
                "你是任务格式化助手。必须遵守用户消息中的固定输出协议，只输出合法 JSON 对象，键为 title、description、due_at、acceptance_criteria、references。",
            },
            {
              role: "user",
              content: buildSmartFormatPrompt({
                instruction: normalizeAiPromptOverride(
                  featureSettings?.smart_format_prompt_override,
                ),
                title: taskTitle,
                description: taskDescription,
                nowIso,
                timeZone,
              }),
            },
          ],
          responseFormat: { type: "json_object" },
          temperature: 0.25,
          maxTokens: 2048,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI 格式化失败";
        if (message.includes("not configured")) {
          return jsonError("AI 格式化尚未配置，请联系管理员。", 503);
        }
        return jsonError(message || "AI 格式化失败，请稍后重试。", 502);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJsonText(modelText));
      } catch {
        return jsonError("AI 返回格式无法解析，请重试。", 502);
      }

      const suggestion = normalizeFormatSuggestion(parsed);
      if (!suggestion) {
        return jsonError("未能生成可用的格式化建议，请完善任务内容后重试。", 422);
      }
      return Response.json(suggestion);
    }

    // action === "decompose"
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
    const contacts: AiPromptContact[] = memberIds.map((userId) => {
      const profile = profileById.get(userId);
      const displayName =
        typeof profile?.display_name === "string" && profile.display_name.trim()
          ? profile.display_name.trim()
          : "团队成员";
      return { user_id: userId, display_name: displayName };
    });
    const contactIds = new Set(contacts.map((contact) => contact.user_id));

    let modelText: string;
    try {
      modelText = await deepseekChatCompletion({
        messages: [
          {
            role: "system",
            content:
              "你是任务分解助手。必须遵守用户消息中的固定输出协议，只输出合法 JSON 对象，键为 subtasks（数组）。",
          },
          {
            role: "user",
            content: buildSubtaskDecomposePrompt({
              instruction: normalizeAiPromptOverride(
                featureSettings?.subtask_decompose_prompt_override,
              ),
              title: taskTitle,
              description: taskDescription,
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
        temperature: 0.2,
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
