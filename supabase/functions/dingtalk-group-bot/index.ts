import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  DINGTALK_GROUP_ROBOT_USAGE,
  dingtalkAtUserIdentifier,
  isAllowedDingtalkSessionWebhook,
  parseDingtalkGroupRobotTaskText,
  verifyDingtalkGroupRobotSignature,
  type DingtalkRobotAtUser,
} from "../_shared/dingtalk-group-robot.ts";
import {
  escapeDingtalkMarkdown,
  formatDingtalkDue,
} from "../_shared/dingtalk-notification-cards.ts";
import { buildTaskOpenUrl, publicAppUrl } from "../_shared/app-url.ts";

type DingtalkRobotPayload = {
  msgId?: unknown;
  msgtype?: unknown;
  chatbotCorpId?: unknown;
  chatbotUserId?: unknown;
  senderStaffId?: unknown;
  senderId?: unknown;
  senderNick?: unknown;
  sessionWebhook?: unknown;
  text?: { content?: unknown };
  atUsers?: DingtalkRobotAtUser[];
};

type ProviderRow = {
  id: string;
  workspace_id: string;
  enabled: boolean;
  public_config: Record<string, unknown>;
  credential_hint: string | null;
};

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeMarkdown(value: unknown, fallback: string) {
  const normalized = text(value).replace(/\s+/g, " ");
  return escapeDingtalkMarkdown(normalized || fallback);
}

async function sendMarkdownReply(
  webhook: string,
  title: string,
  lines: string[],
) {
  if (!isAllowedDingtalkSessionWebhook(webhook)) {
    throw new Error("Invalid DingTalk session webhook");
  }
  const response = await fetch(webhook, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: { title, text: lines.join("\n\n") },
    }),
  });
  if (!response.ok) throw new Error(`DingTalk reply failed (${response.status})`);
}

async function resolveIdentity(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  identifiers: string[],
) {
  for (const identifier of identifiers) {
    const { data } = await supabaseAdmin
      .from("sso_identities")
      .select("user_id, dingtalk_userid, subject")
      .eq("provider", "dingtalk")
      .eq("dingtalk_userid", identifier)
      .maybeSingle();
    if (data?.user_id) return data as { user_id: string };
    const { data: bySubject } = await supabaseAdmin
      .from("sso_identities")
      .select("user_id, dingtalk_userid, subject")
      .eq("provider", "dingtalk")
      .eq("subject", identifier)
      .maybeSingle();
    if (bySubject?.user_id) return bySubject as { user_id: string };
  }
  return null;
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    // DingTalk probes the configured HTTP callback with GET before publishing
    // the application version. Keep message handling POST-only, but return a
    // successful health response so the callback can pass that validation.
    if (req.method === "GET") return Response.json({ ok: true });
    if (req.method !== "POST") return jsonError("Method not allowed", 405);

    const body = await req.json().catch(() => null) as DingtalkRobotPayload | null;
    if (!body) return jsonError("Invalid DingTalk payload");
    const corpId = text(body.chatbotCorpId);
    const timestamp = req.headers.get("timestamp")?.trim() ||
      new URL(req.url).searchParams.get("timestamp")?.trim() || "";
    const signature = req.headers.get("sign")?.trim() ||
      new URL(req.url).searchParams.get("sign")?.trim() || "";
    if (!corpId || !timestamp || !signature) {
      return jsonError("Missing DingTalk signature", 401);
    }

    const { data: providerRows, error: providerError } = await ctx.supabaseAdmin
      .from("workspace_sso_providers")
      .select("id, workspace_id, enabled, public_config, credential_hint")
      .eq("provider", "dingtalk");
    if (providerError) return jsonError("DingTalk provider lookup failed", 500);
    const candidates = ((providerRows ?? []) as ProviderRow[]).filter((provider) =>
      text(provider.public_config?.corpId).toLocaleLowerCase("zh-CN") ===
        corpId.toLocaleLowerCase("zh-CN") && provider.credential_hint
    );

    let provider: ProviderRow | null = null;
    let appSecret = "";
    for (const candidate of candidates) {
      const { data: secret } = await ctx.supabaseAdmin.rpc("get_sso_provider_secret", {
        p_provider_id: candidate.id,
      });
      if (typeof secret !== "string" || !secret) continue;
      if (await verifyDingtalkGroupRobotSignature({
        timestamp,
        signature,
        appSecret: secret,
      })) {
        provider = candidate;
        appSecret = secret;
        break;
      }
    }
    if (!provider || !appSecret) return jsonError("Invalid DingTalk signature", 401);

    const sessionWebhook = text(body.sessionWebhook);
    if (!sessionWebhook || !isAllowedDingtalkSessionWebhook(sessionWebhook)) {
      return jsonError("Invalid DingTalk session webhook", 422);
    }
    if (!provider.enabled) {
      await sendMarkdownReply(sessionWebhook, "机器人暂不可用", [
        "### 机器人暂不可用",
        "团队管理员需要先启用钉钉 SSO。",
      ]);
      return Response.json({ ok: true, skipped: "sso-disabled" });
    }

    const { data: connectorRows, error: connectorError } = await ctx.supabaseAdmin
      .from("connector_instances")
      .select("id, enabled, public_config")
      .eq("workspace_id", provider.workspace_id)
      .eq("type", "dingtalk");
    if (connectorError) return jsonError("Connector lookup failed", 500);
    const connector = (connectorRows ?? []).find((item) =>
      item.public_config?.kind === "group_robot"
    );
    if (!connector?.enabled) {
      await sendMarkdownReply(sessionWebhook, "机器人已停用", [
        "### 机器人已停用",
        "请联系团队管理员在 AntTodo 设置中启用钉钉群机器人。",
      ]);
      return Response.json({ ok: true, skipped: "connector-disabled" });
    }

    if (body.msgtype !== "text" || typeof body.text?.content !== "string") {
      await sendMarkdownReply(sessionWebhook, "暂不支持该消息", [
        "### 暂不支持该消息",
        `请发送文本：${escapeDingtalkMarkdown(DINGTALK_GROUP_ROBOT_USAGE)}`,
      ]);
      return Response.json({ ok: true, skipped: "unsupported-message" });
    }

    const parsed = parseDingtalkGroupRobotTaskText(body.text.content);
    if (parsed.kind === "help") {
      await sendMarkdownReply(sessionWebhook, "AntTodo 机器人使用说明", [
        "### AntTodo 机器人使用说明",
        `发送：${escapeDingtalkMarkdown(DINGTALK_GROUP_ROBOT_USAGE)}`,
        "首位被 @ 的联系人会成为负责人，其余联系人会成为参与人。",
      ]);
      return Response.json({ ok: true, skipped: "help" });
    }

    const senderIdentifiers = [text(body.senderStaffId), text(body.senderId)].filter(Boolean);
    const senderIdentity = await resolveIdentity(ctx.supabaseAdmin, senderIdentifiers);
    const { data: workspace } = await ctx.supabaseAdmin
      .from("workspaces")
      .select("id, name, slug")
      .eq("id", provider.workspace_id)
      .maybeSingle();
    const teamLoginUrl = workspace?.slug
      ? `${publicAppUrl(Deno.env.get("PUBLIC_APP_URL"))}/team/${encodeURIComponent(workspace.slug)}`
      : publicAppUrl(Deno.env.get("PUBLIC_APP_URL"));
    if (!senderIdentity) {
      await sendMarkdownReply(sessionWebhook, "请先关联 AntTodo 账号", [
        "### 请先关联 AntTodo 账号",
        `请先通过 [${safeMarkdown(workspace?.name, "团队登录")}](${teamLoginUrl}) 完成钉钉 SSO 登录，再回到群里创建任务。`,
      ]);
      return Response.json({ ok: true, skipped: "unmapped-sender" });
    }

    const { data: senderMembership } = await ctx.supabaseAdmin
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", provider.workspace_id)
      .eq("user_id", senderIdentity.user_id)
      .maybeSingle();
    if (!senderMembership) {
      await sendMarkdownReply(sessionWebhook, "无法创建任务", [
        "### 无法创建任务",
        "当前钉钉账号还不是该团队空间的成员，请先通过团队登录地址加入。",
      ]);
      return Response.json({ ok: true, skipped: "not-a-member" });
    }

    const chatbotUserId = text(body.chatbotUserId);
    const mentionedIdentifiers = (Array.isArray(body.atUsers) ? body.atUsers : [])
      .map(dingtalkAtUserIdentifier)
      .filter((identifier): identifier is string => Boolean(identifier))
      .filter((identifier) => identifier !== chatbotUserId);
    const mentionedUserIds: string[] = [];
    for (const identifier of mentionedIdentifiers) {
      const identity = await resolveIdentity(ctx.supabaseAdmin, [identifier]);
      if (identity?.user_id && !mentionedUserIds.includes(identity.user_id)) {
        mentionedUserIds.push(identity.user_id);
      }
    }

    const messageId = text(body.msgId);
    if (!messageId) return jsonError("DingTalk message id is required", 422);
    const assigneeId = mentionedUserIds[0] ?? null;
    const participantIds = mentionedUserIds.slice(1);
    const { data: creationRows, error: creationError } = await ctx.supabaseAdmin.rpc(
      "create_task_from_dingtalk_group_robot",
      {
        p_connector_id: connector.id,
        p_message_id: messageId,
        p_actor_id: senderIdentity.user_id,
        p_title: parsed.title,
        p_due_at: parsed.due?.due_at ?? null,
        p_due_start_at: parsed.due?.due_start_at ?? null,
        p_due_is_all_day: parsed.due?.due_is_all_day ?? false,
        p_due_timezone: parsed.due?.due_timezone ?? "Asia/Shanghai",
        p_assignee_id: assigneeId,
        p_participant_ids: participantIds,
        p_label_names: parsed.labelNames,
      },
    );
    if (creationError || !creationRows?.[0]) {
      await sendMarkdownReply(sessionWebhook, "任务创建失败", [
        "### 任务创建失败",
        "请稍后重试；若持续失败，请联系团队管理员检查连接器配置。",
      ]);
      return jsonError("Task creation failed", 500);
    }

    const creation = creationRows[0] as {
      task_id: string;
      duplicate: boolean;
      assigned_user_id: string | null;
      participant_user_ids: string[];
      selected_label_ids: string[];
    };
    const relatedUserIds = [
      creation.assigned_user_id,
      ...(creation.participant_user_ids ?? []),
    ].filter((id): id is string => Boolean(id));
    const [{ data: profiles }, { data: labels }] = await Promise.all([
      relatedUserIds.length
        ? ctx.supabaseAdmin.from("profiles").select("id, display_name").in("id", relatedUserIds)
        : Promise.resolve({ data: [] }),
      creation.selected_label_ids?.length
        ? ctx.supabaseAdmin.from("labels").select("id, name").in("id", creation.selected_label_ids)
        : Promise.resolve({ data: [] }),
    ]);
    const assigneeName = creation.assigned_user_id
      ? profiles?.find((profile: { id: string }) => profile.id === creation.assigned_user_id)
        ?.display_name || "团队成员"
      : "未指派";
    const labelText = labels?.length
      ? labels.map((label: { name: string }) => `#${label.name}`).join(" ")
      : "无";
    const dueText = parsed.due
      ? formatDingtalkDue({
          dueAt: parsed.due.due_at,
          dueStartAt: parsed.due.due_start_at,
          allDay: parsed.due.due_is_all_day,
          timeZone: parsed.due.due_timezone,
        })
      : "无";
    const taskUrl = buildTaskOpenUrl(
      provider.workspace_id,
      creation.task_id,
      null,
      Deno.env.get("PUBLIC_APP_URL"),
    );
    await sendMarkdownReply(sessionWebhook, "蚂蚁清单 任务已创建", [
      `### ${creation.duplicate ? "任务已存在" : "任务已创建"}`,
      `**${safeMarkdown(parsed.title, "未命名任务")}**`,
      `负责人：${safeMarkdown(assigneeName, "未指派")}`,
      `标签：${safeMarkdown(labelText, "无")}`,
      `截止时间：${escapeDingtalkMarkdown(dueText)}`,
      `[打开蚂蚁清单查看任务](${taskUrl})`,
    ]);
    return Response.json({
      ok: true,
      taskId: creation.task_id,
      duplicate: creation.duplicate,
    });
  }),
};
