import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOTIFICATION_SCENARIOS } from "./lib/notificationPreferences";
import { currentNotificationPermission, ensureWebPushSubscription, requestWebNotificationPermission } from "./lib/webPush";
import type {
  NotificationChannelPreferences,
  NotificationPreferences,
  NotificationScenario,
} from "./types";

type DingtalkAvailability = {
  configured: boolean;
  hasAgentId: boolean;
};

async function loadDingtalkAvailability(
  client: SupabaseClient,
  workspaceId: string,
): Promise<DingtalkAvailability> {
  const { data, error } = await client
    .from("workspace_sso_providers")
    .select("enabled, credential_hint, public_config")
    .eq("workspace_id", workspaceId)
    .eq("provider", "dingtalk")
    .maybeSingle();
  if (error) throw error;
  if (!data?.enabled || !data.credential_hint) {
    return { configured: false, hasAgentId: false };
  }
  const agentId =
    data.public_config && typeof data.public_config === "object"
      ? String((data.public_config as { agentId?: string }).agentId ?? "").trim()
      : "";
  return { configured: true, hasAgentId: Boolean(agentId) };
}

export function NotificationSettingsPanel({
  client,
  workspaceId,
  preferences,
  online,
  onChange,
}: {
  client: SupabaseClient | null;
  workspaceId: string;
  preferences: NotificationPreferences;
  online: boolean;
  onChange: (
    scenario: NotificationScenario,
    next: NotificationChannelPreferences,
  ) => Promise<void>;
}) {
  const dingtalkQuery = useQuery({
    queryKey: ["dingtalk-notification-availability", workspaceId],
    enabled: Boolean(client) && !workspaceId.startsWith("workspace-"),
    queryFn: () => loadDingtalkAvailability(client!, workspaceId),
  });
  const dingtalk = dingtalkQuery.data ?? { configured: false, hasAgentId: false };
  const showDingtalk = dingtalk.configured;

  async function update(
    scenario: NotificationScenario,
    key: keyof NotificationChannelPreferences,
    value: boolean,
  ) {
    if (!online) return;
    const current = preferences[scenario];
    if (current[key] === value) return;
    const next = { ...current, [key]: value };
    await onChange(scenario, next);
    if (key === "systemEnabled" && value) {
      const permission = currentNotificationPermission();
      if (permission === "default") {
        const granted = await requestWebNotificationPermission();
        if (granted === "granted" && client) {
          await ensureWebPushSubscription(client).catch(() => undefined);
        }
      } else if (permission === "granted" && client) {
        await ensureWebPushSubscription(client).catch(() => undefined);
      }
    }
  }

  return (
    <section className="notification-settings" aria-labelledby="notification-settings-title">
      <h1 id="notification-settings-title">通知配置</h1>
      <p className="notification-settings-lead">
        按场景选择是否发送系统通知
        {showDingtalk ? "或钉钉通知" : ""}。默认全部开启。
      </p>

      <div
        className={
          showDingtalk
            ? "notification-settings-table has-dingtalk"
            : "notification-settings-table"
        }
        role="table"
        aria-label="通知场景"
      >
        <div className="notification-settings-header" role="row">
          <span role="columnheader">场景</span>
          <span role="columnheader">系统通知</span>
          {showDingtalk && <span role="columnheader">钉钉通知</span>}
        </div>
        {NOTIFICATION_SCENARIOS.map((scenario) => {
          const row = preferences[scenario.id];
          return (
            <div className="notification-settings-row" role="row" key={scenario.id}>
              <span role="cell">{scenario.label}</span>
              <label className="date-time-switch" role="cell">
                <span className="sr-only">系统通知</span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`${scenario.label} 系统通知`}
                  checked={row.systemEnabled}
                  disabled={!online}
                  onChange={(event) =>
                    void update(scenario.id, "systemEnabled", event.target.checked)
                  }
                />
                <i aria-hidden="true" />
              </label>
              {showDingtalk && (
                <label className="date-time-switch" role="cell">
                  <span className="sr-only">钉钉通知</span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`${scenario.label} 钉钉通知`}
                    checked={row.dingtalkEnabled}
                    disabled={!online || !dingtalk.hasAgentId}
                    onChange={(event) =>
                      void update(scenario.id, "dingtalkEnabled", event.target.checked)
                    }
                  />
                  <i aria-hidden="true" />
                </label>
              )}
            </div>
          );
        })}
      </div>

      {showDingtalk && !dingtalk.hasAgentId && (
        <p className="notification-settings-hint">
          已配置钉钉单点登录，但尚未填写 AgentId。请在「单点登录」中补充后启用钉钉通知。
        </p>
      )}
      {!showDingtalk && (
        <p className="notification-settings-hint">
          配置钉钉单点登录后，可额外选择钉钉工作通知渠道。
        </p>
      )}
      {!online && <p className="date-time-offline-note">离线模式下设置为只读</p>}
    </section>
  );
}
