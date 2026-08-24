import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  deepseekChatCompletion,
  extractJsonText,
} from "../_shared/deepseek.ts";
import {
  buildSmartFormatPrompt,
  normalizeAiPromptOverride,
} from "../_shared/ai-feature-prompts.ts";
import { resolveUser } from "../_shared/resolveUser.ts";

type AiTaskFormatRequest = {
  workspaceId: string;
  taskId: string;
  nowIso?: string;
  timeZone?: string;
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

    const body = await req.json().catch(() => null) as AiTaskFormatRequest | null;
    if (
      typeof body?.workspaceId !== "string"
      || typeof body.taskId !== "string"
    ) {
      return jsonError("Invalid request");
    }

    const workspaceId = body.workspaceId.trim();
    const taskId = body.taskId.trim();
    if (!workspaceId || !taskId) return jsonError("Invalid request");

    const { data: featureSettings, error: featureSettingsError } =
      await ctx.supabaseAdmin
        .from("user_ai_feature_settings")
        .select("smart_format_enabled, smart_format_prompt_override")
        .eq("user_id", user.id)
        .maybeSingle();
    if (featureSettingsError) {
      return jsonError("AI 功能设置读取失败，请稍后重试。", 500);
    }
    if (!(featureSettings?.smart_format_enabled ?? true)) {
      return jsonError("智能格式化已在设置中关闭。", 403);
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
      .select("id, workspace_id, title, description, deleted_at")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError || !task || task.deleted_at || task.workspace_id !== workspaceId) {
      return jsonError("Task not found", 404);
    }

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
              "你是任务格式化助手。必须遵守用户消息中的固定输出协议，只输出合法 JSON 对象，键为 title、description、due_at、acceptance_criteria、references。",
          },
          {
            role: "user",
            content: buildSmartFormatPrompt({
              instruction: normalizeAiPromptOverride(
                featureSettings?.smart_format_prompt_override,
              ),
              title: String(task.title ?? ""),
              description: String(task.description ?? ""),
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
  }),
};
