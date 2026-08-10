import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  Power,
  Trash2,
  Wrench,
  Zap,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { supabase } from "./lib/supabase";
import type { Connector, Workspace } from "./types";

type ConnectorListItem = {
  id: string;
  type: "dingtalk-group-robot";
  name: string;
  enabled: boolean;
  lastEventAt: string | null;
  createdAt: string;
};

type ConnectorListResponse = {
  canManage: boolean;
  ssoEnabled: boolean;
  callbackUrl: string;
  connectors: ConnectorListItem[];
};

function isDemoWorkspace(workspaceId: string) {
  return workspaceId === "workspace-team" || workspaceId === "workspace-personal";
}

function demoResponse(workspace: Workspace, connectors: Connector[]): ConnectorListResponse {
  return {
    canManage: workspace.role === "owner" || workspace.role === "admin",
    ssoEnabled: workspace.id === "workspace-team",
    callbackUrl: "https://example.supabase.co/functions/v1/dingtalk-group-bot",
    connectors: connectors.flatMap((connector) =>
      connector.type === "dingtalk" && connector.public_config.kind === "group_robot"
        ? [{
            id: connector.id,
            type: "dingtalk-group-robot" as const,
            name: connector.name,
            enabled: connector.enabled,
            lastEventAt: connector.last_synced_at,
            createdAt: connector.next_sync_at,
          }]
        : []),
  };
}

async function invokeConnectorAdmin(body: Record<string, unknown>) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase.functions.invoke("connector-admin", { body });
  if (error) {
    const context = error.context as Response | undefined;
    if (context) {
      const payload = await context.clone().json().catch(() => null);
      if (typeof payload?.error === "string") throw new Error(payload.error);
    }
    throw error;
  }
  return data;
}

function formatLastEvent(value: string | null) {
  if (!value) return "尚未收到群消息";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function ConnectorSettingsPanel({
  workspace,
  connectors: bundleConnectors,
  online,
  onNavigateToSso,
  onNotice,
}: {
  workspace: Workspace;
  connectors: Connector[];
  online: boolean;
  onNavigateToSso: () => void;
  onNotice: (message: string) => void;
}) {
  const demo = isDemoWorkspace(workspace.id);
  const queryClient = useQueryClient();
  const [section, setSection] = useState<"market" | "connected">("market");
  const [marketCategory, setMarketCategory] = useState<"quick" | "development">("quick");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState("");

  const connectorQuery = useQuery({
    queryKey: ["connector-settings", workspace.id],
    enabled: !demo && Boolean(supabase),
    queryFn: async () => await invokeConnectorAdmin({
      action: "list",
      workspaceId: workspace.id,
    }) as ConnectorListResponse,
  });
  const data = useMemo(
    () => demo
      ? demoResponse(workspace, bundleConnectors)
      : connectorQuery.data ?? {
          canManage: workspace.role === "owner" || workspace.role === "admin",
          ssoEnabled: false,
          callbackUrl: "",
          connectors: [],
        },
    [bundleConnectors, connectorQuery.data, demo, workspace],
  );
  const connector = data.connectors[0] ?? null;

  async function refresh() {
    await Promise.all([
      connectorQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ["workspace-bundle", workspace.id] }),
    ]);
  }

  async function install() {
    if (demo) {
      onNotice("演示模式仅预览钉钉群机器人接入效果");
      return;
    }
    setBusyAction("install");
    setError("");
    try {
      await invokeConnectorAdmin({
        action: "install-dingtalk-group-bot",
        workspaceId: workspace.id,
      });
      await refresh();
      setSection("connected");
      onNotice("钉钉群机器人已接入，请继续完成钉钉开放平台配置");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "接入失败，请稍后重试。");
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleEnabled() {
    if (!connector || demo) return;
    setBusyAction("toggle");
    setError("");
    try {
      await invokeConnectorAdmin({
        action: "set-enabled",
        connectorId: connector.id,
        enabled: !connector.enabled,
      });
      await refresh();
      onNotice(connector.enabled ? "钉钉群机器人已停用" : "钉钉群机器人已启用");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "状态更新失败。");
    } finally {
      setBusyAction(null);
    }
  }

  async function remove() {
    if (!connector || demo) return;
    if (!window.confirm("确定移除钉钉群机器人？钉钉 SSO 配置不会受到影响。")) return;
    setBusyAction("delete");
    setError("");
    try {
      await invokeConnectorAdmin({ action: "delete", connectorId: connector.id });
      await refresh();
      setSection("market");
      onNotice("钉钉群机器人已移除");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移除失败。");
    } finally {
      setBusyAction(null);
    }
  }

  async function copyCallbackUrl() {
    if (!data.callbackUrl) {
      onNotice("暂时无法生成机器人回调地址");
      return;
    }
    try {
      await navigator.clipboard.writeText(data.callbackUrl);
      onNotice("机器人回调地址已复制");
    } catch {
      onNotice("复制失败，请手动复制回调地址");
    }
  }

  return (
    <section className="connector-module" aria-labelledby="connector-module-title">
      <header className="connector-module-header">
        <div>
          <h1 id="connector-module-title">连接器</h1>
          <p>连接团队常用工具，让任务收集和协作更顺畅。</p>
        </div>
      </header>

      <div className="connector-primary-tabs" role="tablist" aria-label="连接器分类">
        <button
          type="button"
          role="tab"
          aria-selected={section === "market"}
          className={section === "market" ? "active" : undefined}
          onClick={() => setSection("market")}
        >
          连接器市场
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "connected"}
          className={section === "connected" ? "active" : undefined}
          onClick={() => setSection("connected")}
        >
          已接入{data.connectors.length ? ` ${data.connectors.length}` : ""}
        </button>
      </div>

      {connectorQuery.isLoading && !demo ? (
        <div className="connector-empty">正在加载连接器…</div>
      ) : connectorQuery.isError && !demo ? (
        <div className="connector-empty is-error">连接器暂时无法加载，请稍后重试。</div>
      ) : section === "market" ? (
        <div className="connector-market-panel" role="tabpanel">
          <div className="connector-category-tabs" role="tablist" aria-label="连接器市场分类">
            <button
              type="button"
              role="tab"
              aria-selected={marketCategory === "quick"}
              className={marketCategory === "quick" ? "active" : undefined}
              onClick={() => setMarketCategory("quick")}
            >
              <Zap aria-hidden="true" />快速创建
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={marketCategory === "development"}
              className={marketCategory === "development" ? "active" : undefined}
              onClick={() => setMarketCategory("development")}
            >
              <Wrench aria-hidden="true" />研发工具
            </button>
          </div>

          <div className="connector-market-grid">
            {marketCategory === "quick" ? (
              <article className="connector-market-card">
                <span className="connector-logo dingtalk"><Bot aria-hidden="true" /></span>
                <div className="connector-market-copy">
                  <strong>钉钉群机器人</strong>
                  <p>在钉钉群中 @机器人，把消息快速创建为团队任务。</p>
                  <span>支持负责人、参与人、标签和自然语言截止时间</span>
                </div>
                <div className="connector-market-action">
                  {connector ? (
                    <span className="connector-installed"><Check aria-hidden="true" />已接入</span>
                  ) : !data.ssoEnabled ? (
                    <button type="button" className="button secondary" onClick={onNavigateToSso}>
                      先启用 SSO
                    </button>
                  ) : data.canManage ? (
                    <button
                      type="button"
                      className="button primary"
                      disabled={!online || busyAction !== null}
                      onClick={() => void install()}
                    >
                      {busyAction === "install" ? "接入中…" : "接入"}
                    </button>
                  ) : (
                    <span className="connector-readonly">联系管理员接入</span>
                  )}
                </div>
              </article>
            ) : (
              <article className="connector-market-card is-disabled">
                <span className="connector-logo yunxiao">云</span>
                <div className="connector-market-copy">
                  <strong>云效</strong>
                  <p>连接云效项目中的工作项、执行人和状态。</p>
                  <span>研发工具</span>
                </div>
                <span className="connector-coming-soon">暂未开放</span>
              </article>
            )}
          </div>
        </div>
      ) : (
        <div className="connector-connected-panel" role="tabpanel">
          {!connector ? (
            <div className="connector-empty">
              <Bot aria-hidden="true" />
              <strong>还没有接入连接器</strong>
              <span>前往连接器市场，选择适合团队的连接器。</span>
              <button type="button" className="button primary" onClick={() => setSection("market")}>
                浏览连接器市场
              </button>
            </div>
          ) : (
            <article className="connector-connected-card">
              <header>
                <span className="connector-logo dingtalk"><Bot aria-hidden="true" /></span>
                <div>
                  <strong>{connector.name}</strong>
                  <span className={clsx(
                    "connector-status",
                    !data.ssoEnabled ? "blocked" : connector.enabled ? "enabled" : "disabled",
                  )}>
                    {!data.ssoEnabled
                      ? "需启用 SSO"
                      : connector.enabled
                        ? connector.lastEventAt ? "已启用" : "待验证"
                        : "已停用"}
                  </span>
                </div>
                {data.canManage && !demo ? (
                  <div className="connector-connected-actions">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={!online || busyAction !== null || !data.ssoEnabled}
                      onClick={() => void toggleEnabled()}
                    >
                      <Power aria-hidden="true" />{connector.enabled ? "停用" : "启用"}
                    </button>
                    <button
                      type="button"
                      className="button secondary danger"
                      disabled={!online || busyAction !== null}
                      onClick={() => void remove()}
                    >
                      <Trash2 aria-hidden="true" />移除
                    </button>
                  </div>
                ) : null}
              </header>

              <dl className="connector-detail-list">
                <div><dt>接入范围</dt><dd>当前团队空间内，所有已添加机器人的钉钉群</dd></div>
                <div><dt>解析时区</dt><dd>Asia/Shanghai</dd></div>
                <div><dt>最近使用</dt><dd>{formatLastEvent(connector.lastEventAt)}</dd></div>
              </dl>

              <section className="connector-setup-guide" aria-label="钉钉机器人配置步骤">
                <h2>完成钉钉开放平台配置</h2>
                <ol>
                  <li>进入当前 SSO 所使用的钉钉企业内部应用，启用机器人能力。</li>
                  <li>将下方地址填写为机器人消息接收地址。</li>
                  <li>把机器人添加到目标群，发送“@机器人 帮助”完成验证。</li>
                </ol>
                <div className="connector-callback-row">
                  <code>{data.callbackUrl || "回调地址暂不可用"}</code>
                  {data.canManage ? (
                    <button type="button" className="button secondary" onClick={() => void copyCallbackUrl()}>
                      <Copy aria-hidden="true" />复制
                    </button>
                  ) : null}
                </div>
                <a
                  href="https://open.dingtalk.com/document/robots/enterprise-created-chatbot"
                  target="_blank"
                  rel="noreferrer"
                >
                  查看钉钉机器人配置文档<ExternalLink aria-hidden="true" />
                </a>
              </section>
              {demo ? <p className="connector-demo-note">演示预览，不会连接真实钉钉应用。</p> : null}
            </article>
          )}
        </div>
      )}
      {error ? <p className="form-error connector-module-error" role="alert">{error}</p> : null}
    </section>
  );
}
