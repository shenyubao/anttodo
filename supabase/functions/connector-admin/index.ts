import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { resolveUser } from "../_shared/resolveUser.ts";
import {
  getWorkitemWorkflow,
  listProjectWorkitemTypes,
  searchProjects,
  searchWorkitems,
  validateYunxiaoPublicConfig,
  YUNXIAO_INTERVALS,
} from "../_shared/yunxiao.ts";

type AdminRequest =
  | { action: "list"; workspaceId: string }
  | { action: "install-dingtalk-group-bot"; workspaceId: string }
  | { action: "set-enabled"; connectorId: string; enabled: boolean }
  | { action: "delete"; connectorId: string }
  | {
      action: "create-invite";
      workspaceId: string;
      email: string;
      role?: "admin" | "member";
    }
  | { action: "accept-invite"; token: string }
  | { action: "save-secret"; connectorId: string; secret: string }
  | { action: "delete-secret"; connectorId: string }
  | {
      action: "list-yunxiao-projects";
      organizationId: string;
      token: string;
    }
  | {
      action: "list-yunxiao-types";
      organizationId: string;
      projectId: string;
      token: string;
    }
  | {
      action: "list-yunxiao-statuses";
      organizationId: string;
      projectId: string;
      workitemTypeId: string;
      token: string;
    }
  | {
      action: "install-yunxiao";
      workspaceId: string;
      name: string;
      organizationId: string;
      projectId: string;
      workitemTypeId: string;
      conditions: unknown;
      scheduleMinutes: number;
      targetLabelId: string;
      completedStatusId: string;
      token: string;
    }
  | { action: "rotate-yunxiao-token"; connectorId: string; token: string }
  | { action: "set-yunxiao-enabled"; connectorId: string; enabled: boolean }
  | { action: "delete-yunxiao"; connectorId: string };

const encoder = new TextEncoder();

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function dingtalkGroupRobotCallbackUrl() {
  const base = (
    Deno.env.get("SUPABASE_PUBLIC_URL") ?? Deno.env.get("SUPABASE_URL") ?? ""
  ).trim().replace(/\/+$/, "");
  return base ? `${base}/functions/v1/dingtalk-group-bot` : "";
}

function isDingtalkGroupRobot(connector: {
  type?: unknown;
  public_config?: unknown;
}) {
  const config = connector.public_config;
  return connector.type === "dingtalk" &&
    typeof config === "object" && config !== null &&
    (config as { kind?: unknown }).kind === "group_robot";
}

function serializeDingtalkGroupRobot(connector: {
  id: string;
  name: string;
  enabled: boolean;
  last_synced_at: string | null;
  created_at: string;
}) {
  return {
    id: connector.id,
    type: "dingtalk-group-robot" as const,
    name: connector.name,
    enabled: connector.enabled,
    lastEventAt: connector.last_synced_at,
    createdAt: connector.created_at,
  };
}

function serializeYunxiao(connector: {
  id: string;
  name: string;
  enabled: boolean;
  schedule_minutes: number;
  target_label_id: string;
  public_config: unknown;
  credential_hint: string | null;
  last_synced_at: string | null;
  next_sync_at: string;
  created_at: string;
}, lastRun: Record<string, unknown> | null = null) {
  return {
    id: connector.id,
    type: "yunxiao" as const,
    name: connector.name,
    enabled: connector.enabled,
    scheduleMinutes: connector.schedule_minutes,
    targetLabelId: connector.target_label_id,
    config: validateYunxiaoPublicConfig(connector.public_config),
    credentialHint: connector.credential_hint,
    lastSyncedAt: connector.last_synced_at,
    nextSyncAt: connector.next_sync_at,
    createdAt: connector.created_at,
    lastRun,
  };
}

function requiredText(value: unknown, label: string, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${label}无效`);
  }
  return value.trim();
}

async function requireWorkspaceAdmin(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  workspaceId: string,
  userId: string,
) {
  const { data: membership, error } = await supabaseAdmin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return !error && Boolean(
    membership && ["owner", "admin"].includes(membership.role),
  );
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);

    const body = (await req.json()) as AdminRequest;
    const user = await resolveUser(req, ctx.supabaseAdmin);
    if (!user) return jsonError("请先登录后再继续", 401);
    const userId = user.id;
    const userEmail = user.email;

    if (body.action === "list" || body.action === "install-dingtalk-group-bot") {
      const { data: membership, error: membershipError } = await ctx.supabaseAdmin
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", body.workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (membershipError || !membership) {
        return jsonError("Workspace membership required", 403);
      }
      const canManage = ["owner", "admin"].includes(membership.role);

      const { data: provider, error: providerError } = await ctx.supabaseAdmin
        .from("workspace_sso_providers")
        .select("id, enabled, public_config, credential_hint")
        .eq("workspace_id", body.workspaceId)
        .eq("provider", "dingtalk")
        .maybeSingle();
      if (providerError) return jsonError(providerError.message, 400);
      let hasAppSecret = false;
      if (provider?.id && provider.credential_hint) {
        const { data: secret, error: secretError } = await ctx.supabaseAdmin.rpc(
          "get_sso_provider_secret",
          { p_provider_id: provider.id },
        );
        if (secretError) return jsonError("钉钉 SSO 密钥状态无法验证", 500);
        hasAppSecret = typeof secret === "string" && secret.length > 0;
      }
      const publicConfig = provider?.public_config;
      const ssoConfigured = Boolean(
        provider?.enabled &&
          hasAppSecret &&
          typeof publicConfig === "object" && publicConfig !== null &&
          typeof (publicConfig as { corpId?: unknown }).corpId === "string" &&
          typeof (publicConfig as { appKey?: unknown }).appKey === "string",
      );

      const { data: connectorRows, error: connectorListError } = await ctx.supabaseAdmin
        .from("connector_instances")
        .select("id, type, name, enabled, public_config, last_synced_at, created_at")
        .eq("workspace_id", body.workspaceId)
        .eq("type", "dingtalk")
        .order("created_at", { ascending: true });
      if (connectorListError) return jsonError(connectorListError.message, 400);
      const connectors = (connectorRows ?? []).filter(isDingtalkGroupRobot);

      if (body.action === "list") {
        const { data: yunxiaoRows, error: yunxiaoError } = await ctx.supabaseAdmin
          .from("connector_instances")
          .select("id,name,enabled,schedule_minutes,target_label_id,public_config,credential_hint,last_synced_at,next_sync_at,created_at")
          .eq("workspace_id", body.workspaceId)
          .eq("type", "yunxiao")
          .eq("created_by", userId)
          .order("created_at", { ascending: true });
        if (yunxiaoError && !/does not exist|schema cache/i.test(yunxiaoError.message)) {
          return jsonError(yunxiaoError.message, 400);
        }
        const yunxiaoList = yunxiaoError ? [] : (yunxiaoRows ?? []);
        const yunxiaoIds = yunxiaoList.map((row) => row.id);
        const { data: runRows, error: runsError } = yunxiaoIds.length
          ? await ctx.supabaseAdmin.from("sync_runs")
            .select("id,connector_id,status,pulled_count,error_message,started_at,finished_at")
            .in("connector_id", yunxiaoIds)
            .order("created_at", { ascending: false })
          : { data: [], error: null };
        if (runsError) return jsonError(runsError.message, 400);
        const lastRunByConnector = new Map<string, Record<string, unknown>>();
        for (const run of runRows ?? []) {
          if (!lastRunByConnector.has(run.connector_id)) {
            lastRunByConnector.set(run.connector_id, run);
          }
        }
        return Response.json({
          canManage,
          ssoEnabled: ssoConfigured,
          callbackUrl: dingtalkGroupRobotCallbackUrl(),
          connectors: connectors.map(serializeDingtalkGroupRobot),
          yunxiaoConnectors: yunxiaoList.map((connector) =>
            serializeYunxiao(
              connector,
              lastRunByConnector.get(connector.id) ?? null,
            )
          ),
        });
      }

      if (!canManage) {
        return jsonError("Workspace administrator access required", 403);
      }
      if (!ssoConfigured) {
        return jsonError("请先启用并完整配置钉钉 SSO", 422);
      }
      if (connectors[0]) {
        return Response.json({
          connector: serializeDingtalkGroupRobot(connectors[0]),
          callbackUrl: dingtalkGroupRobotCallbackUrl(),
          created: false,
        });
      }

      const { data: connector, error: createError } = await ctx.supabaseAdmin
        .from("connector_instances")
        .insert({
          workspace_id: body.workspaceId,
          type: "dingtalk",
          name: "钉钉群机器人",
          enabled: true,
          schedule_minutes: 5,
          public_config: { kind: "group_robot", timezone: "Asia/Shanghai" },
          created_by: userId,
        })
        .select("id, name, enabled, last_synced_at, created_at")
        .single();
      if (createError?.code === "23505") {
        const { data: installed } = await ctx.supabaseAdmin
          .from("connector_instances")
          .select("id, name, enabled, last_synced_at, created_at")
          .eq("workspace_id", body.workspaceId)
          .eq("type", "dingtalk")
          .contains("public_config", { kind: "group_robot" })
          .maybeSingle();
        if (installed) {
          return Response.json({
            connector: serializeDingtalkGroupRobot(installed),
            callbackUrl: dingtalkGroupRobotCallbackUrl(),
            created: false,
          });
        }
      }
      if (createError || !connector) {
        return jsonError(createError?.message || "Connector could not be created", 400);
      }
      return Response.json({
        connector: serializeDingtalkGroupRobot(connector),
        callbackUrl: dingtalkGroupRobotCallbackUrl(),
        created: true,
      });
    }

    if (body.action === "create-invite") {
      const { data: membership, error: membershipError } = await ctx.supabaseAdmin
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", body.workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (
        membershipError ||
        !membership ||
        !["owner", "admin"].includes(membership.role)
      ) {
        return jsonError("Workspace administrator access required", 403);
      }

      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
      const tokenHash = await sha256(token);
      const { error } = await ctx.supabaseAdmin.from("workspace_invites").insert({
        workspace_id: body.workspaceId,
        email: body.email.trim().toLowerCase(),
        role: body.role ?? "member",
        token_hash: tokenHash,
        created_by: userId,
      });
      if (error) return jsonError(error.message, 403);
      return Response.json({ token, expiresInDays: 7 });
    }

    if (body.action === "accept-invite") {
      const tokenHash = await sha256(body.token);
      const { data: invite, error } = await ctx.supabaseAdmin
        .from("workspace_invites")
        .select("id, workspace_id, email, role, expires_at, accepted_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error || !invite) return jsonError("Invite not found", 404);
      if (invite.accepted_at) return jsonError("Invite already used", 409);
      if (new Date(invite.expires_at).getTime() < Date.now()) {
        return jsonError("Invite expired", 410);
      }
      if (!userEmail || invite.email.toLowerCase() !== userEmail.toLowerCase()) {
        return jsonError("Invite email does not match the signed-in user", 403);
      }
      const { error: memberError } = await ctx.supabaseAdmin
        .from("workspace_members")
        .upsert({
          workspace_id: invite.workspace_id,
          user_id: userId,
          role: invite.role,
        });
      if (memberError) return jsonError(memberError.message, 400);
      await ctx.supabaseAdmin
        .from("workspace_invites")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invite.id);
      return Response.json({ workspaceId: invite.workspace_id });
    }

    if (body.action === "list-yunxiao-projects") {
      try {
        return Response.json({
          projects: await searchProjects(
            requiredText(body.organizationId, "组织 ID"),
            requiredText(body.token, "个人令牌", 10000),
          ),
        });
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : "云效验证失败", 422);
      }
    }

    if (body.action === "list-yunxiao-types") {
      try {
        return Response.json({
          types: await listProjectWorkitemTypes(
            requiredText(body.organizationId, "组织 ID"),
            requiredText(body.projectId, "项目 ID"),
            requiredText(body.token, "个人令牌", 10000),
          ),
        });
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : "云效验证失败", 422);
      }
    }

    if (body.action === "list-yunxiao-statuses") {
      try {
        return Response.json({
          statuses: await getWorkitemWorkflow(
            requiredText(body.organizationId, "组织 ID"),
            requiredText(body.projectId, "项目 ID"),
            requiredText(body.workitemTypeId, "工作项类型"),
            requiredText(body.token, "个人令牌", 10000),
          ),
        });
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : "云效验证失败", 422);
      }
    }

    if (body.action === "install-yunxiao") {
      try {
        const workspaceId = requiredText(body.workspaceId, "团队空间 ID");
        const organizationId = requiredText(body.organizationId, "组织 ID");
        const projectId = requiredText(body.projectId, "项目 ID");
        const token = requiredText(body.token, "个人令牌", 10000);
        if (!(YUNXIAO_INTERVALS as readonly number[]).includes(body.scheduleMinutes)) {
          return jsonError("同步间隔无效", 422);
        }
        const { data: member } = await ctx.supabaseAdmin.from("workspace_members")
          .select("user_id").eq("workspace_id", workspaceId).eq("user_id", userId)
          .maybeSingle();
        if (!member) return jsonError("Workspace membership required", 403);
        const { data: canUseLabel, error: labelError } = await ctx.supabaseAdmin.rpc(
          "can_user_manage_connector_label",
          { p_workspace_id: workspaceId, p_label_id: body.targetLabelId, p_user_id: userId },
        );
        if (labelError || !canUseLabel) return jsonError("目标标签必须具有编辑权限", 403);
        const types = await listProjectWorkitemTypes(organizationId, projectId, token);
        const workitemType = types.find((item) => item.id === body.workitemTypeId);
        if (!workitemType) return jsonError("工作项类型不存在或已停用", 422);
        const statuses = await getWorkitemWorkflow(
          organizationId, projectId, workitemType.id, token,
        );
        const completedStatus = statuses.find((item) => item.id === body.completedStatusId);
        if (!completedStatus) return jsonError("完成状态不属于所选工作流", 422);
        const config = validateYunxiaoPublicConfig({
          organizationId,
          projectId,
          workitemTypeId: workitemType.id,
          workitemTypeName: workitemType.name,
          categoryId: workitemType.categoryId,
          conditions: body.conditions,
          orderBy: "gmtModified",
          sort: "desc",
          completedStatusId: completedStatus.id,
          completedStatusName: completedStatus.name,
        });
        await searchWorkitems(
          config, token,
          { from: new Date(0).toISOString(), to: new Date().toISOString() },
          1, 1,
        );
        const { data: connector, error: createError } = await ctx.supabaseAdmin
          .from("connector_instances")
          .insert({
            workspace_id: workspaceId,
            type: "yunxiao",
            name: requiredText(body.name, "同步任务名", 120),
            enabled: false,
            schedule_minutes: body.scheduleMinutes,
            target_label_id: body.targetLabelId,
            public_config: config,
            created_by: userId,
          })
          .select("id,name,enabled,schedule_minutes,target_label_id,public_config,credential_hint,last_synced_at,next_sync_at,created_at")
          .single();
        if (createError || !connector) throw new Error(createError?.message ?? "连接器创建失败");
        const { data: hint, error: secretError } = await ctx.supabaseAdmin.rpc(
          "set_connector_secret",
          { p_connector_id: connector.id, p_actor_id: userId, p_secret: token },
        );
        if (secretError) {
          await ctx.supabaseAdmin.from("connector_instances").delete().eq("id", connector.id);
          throw new Error(secretError.message);
        }
        const { data: enabled, error: enableError } = await ctx.supabaseAdmin
          .from("connector_instances").update({ enabled: true, next_sync_at: new Date().toISOString() })
          .eq("id", connector.id)
          .select("id,name,enabled,schedule_minutes,target_label_id,public_config,credential_hint,last_synced_at,next_sync_at,created_at")
          .single();
        if (enableError || !enabled) throw new Error(enableError?.message ?? "连接器启用失败");
        return Response.json({ connector: serializeYunxiao({ ...enabled, credential_hint: hint }) });
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : "云效连接器创建失败", 422);
      }
    }

    const connectorId = "connectorId" in body ? body.connectorId : undefined;
    if (typeof connectorId !== "string" || !connectorId.trim()) {
      return jsonError("不支持的连接器操作", 400);
    }
    const { data: connector, error: connectorError } = await ctx.supabaseAdmin
      .from("connector_instances")
      .select("id,workspace_id,type,public_config,created_by,enabled,credential_hint")
      .eq("id", connectorId)
      .single();
    if (connectorError || !connector) return jsonError("Connector not found", 404);

    if (
      body.action === "rotate-yunxiao-token" ||
      body.action === "set-yunxiao-enabled" ||
      body.action === "delete-yunxiao"
    ) {
      if (connector.type !== "yunxiao" || connector.created_by !== userId) {
        return jsonError("云效连接器不存在", 404);
      }
      if (body.action === "rotate-yunxiao-token") {
        try {
          const token = requiredText(body.token, "个人令牌", 10000);
          const config = validateYunxiaoPublicConfig(connector.public_config);
          const types = await listProjectWorkitemTypes(
            config.organizationId, config.projectId, token,
          );
          if (!types.some((item) => item.id === config.workitemTypeId)) {
            return jsonError("新令牌无法访问所选工作项类型", 422);
          }
          await getWorkitemWorkflow(
            config.organizationId, config.projectId, config.workitemTypeId, token,
          );
          const { data, error } = await ctx.supabaseAdmin.rpc("set_connector_secret", {
            p_connector_id: connector.id, p_actor_id: userId, p_secret: token,
          });
          if (error) return jsonError(error.message, 403);
          return Response.json({ credentialHint: data });
        } catch (error) {
          return jsonError(error instanceof Error ? error.message : "令牌更新失败", 422);
        }
      }
      if (body.action === "set-yunxiao-enabled") {
        if (body.enabled && !connector.credential_hint) {
          return jsonError("请先配置个人令牌", 422);
        }
        const { error } = await ctx.supabaseAdmin.from("connector_instances")
          .update({ enabled: body.enabled, next_sync_at: new Date().toISOString() })
          .eq("id", connector.id);
        if (error) return jsonError(error.message, 400);
        return Response.json({ enabled: body.enabled });
      }
      const { count, error: countError } = await ctx.supabaseAdmin.from("tasks")
        .select("id", { count: "exact", head: true }).eq("connector_id", connector.id);
      if (countError) return jsonError(countError.message, 400);
      if ((count ?? 0) > 0) {
        return jsonError("还有任务未删除（包含回收站），只能停用连接器", 409);
      }
      const { error: secretError } = await ctx.supabaseAdmin.rpc("delete_connector_secret", {
        p_connector_id: connector.id, p_actor_id: userId,
      });
      if (secretError) return jsonError(secretError.message, 403);
      const { error } = await ctx.supabaseAdmin.from("connector_instances")
        .delete().eq("id", connector.id);
      if (error) return jsonError(error.message, 400);
      return Response.json({ deleted: true });
    }

    if (body.action === "set-enabled" || body.action === "delete") {
      if (!isDingtalkGroupRobot(connector)) {
        return jsonError("DingTalk group robot not found", 404);
      }
      if (!(await requireWorkspaceAdmin(
        ctx.supabaseAdmin,
        connector.workspace_id,
        userId,
      ))) {
        return jsonError("Workspace administrator access required", 403);
      }
      if (body.action === "set-enabled") {
        const { data, error } = await ctx.supabaseAdmin
          .from("connector_instances")
          .update({ enabled: body.enabled })
          .eq("id", connector.id)
          .select("id, name, enabled, last_synced_at, created_at")
          .single();
        if (error || !data) return jsonError(error?.message || "Update failed", 400);
        return Response.json({ connector: serializeDingtalkGroupRobot(data) });
      }
      const { error } = await ctx.supabaseAdmin
        .from("connector_instances")
        .delete()
        .eq("id", connector.id);
      if (error) return jsonError(error.message, 400);
      return Response.json({ deleted: true });
    }

    if (body.action === "save-secret") {
      if (!body.secret.trim()) return jsonError("Secret is required");
      const { data, error } = await ctx.supabaseAdmin.rpc("set_connector_secret", {
        p_connector_id: connector.id,
        p_actor_id: userId,
        p_secret: body.secret,
      });
      if (error) return jsonError(error.message, 403);
      return Response.json({ credentialHint: data });
    }

    const { error } = await ctx.supabaseAdmin.rpc("delete_connector_secret", {
      p_connector_id: connector.id,
      p_actor_id: userId,
    });
    if (error) return jsonError(error.message, 403);
    return Response.json({ deleted: true });
  }),
};
