import {
  Bot,
  Copy,
  ExternalLink,
  Power,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import { ConnectorDetailsToggle } from "./ConnectorDetailsToggle";
import {
  formatLastEvent,
  invokeConnectorAdmin,
  useConnectorSettings,
} from "./lib/connectorAdmin";
import type { Connector, Workspace } from "./types";

export function QuickCreateSettingsPanel({
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
  const { demo, connectorQuery, data, refresh } = useConnectorSettings(
    workspace,
    bundleConnectors,
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const connector = data.connectors[0] ?? null;
  const detailsId = connector ? `quick-create-details-${connector.id}` : "";

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
      setDetailsOpen(true);
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
      setDetailsOpen(false);
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
    <section className="connector-module" aria-labelledby="quick-create-module-title">
      <header className="connector-module-header">
        <div>
          <h1 id="quick-create-module-title">快速创建</h1>
          <p>在钉钉群中 @机器人，把消息快速创建为团队任务。</p>
        </div>
      </header>

      {connectorQuery.isLoading && !demo ? (
        <div className="connector-empty">正在加载快速创建…</div>
      ) : connectorQuery.isError && !demo ? (
        <div className="connector-empty is-error">快速创建暂时无法加载，请稍后重试。</div>
      ) : connector ? (
        <div className="connector-connected-panel">
          <div className="connector-connected-list">
            <article className={clsx("connector-connected-card", detailsOpen && "is-expanded")}>
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

              {detailsOpen ? (
                <div id={detailsId} className="connector-connected-details">
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
                </div>
              ) : null}
              <ConnectorDetailsToggle
                expanded={detailsOpen}
                detailsId={detailsId}
                onToggle={() => setDetailsOpen((open) => !open)}
              />
            </article>
          </div>
        </div>
      ) : (
        <div className="connector-market-panel">
          <div className="connector-market-grid">
            <article className="connector-market-card">
              <span className="connector-logo dingtalk"><Bot aria-hidden="true" /></span>
              <div className="connector-market-copy">
                <strong>钉钉群机器人</strong>
                <p>在钉钉群中 @机器人，把消息快速创建为团队任务。</p>
              </div>
              <div className="connector-market-action">
                {!data.ssoEnabled ? (
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
          </div>
        </div>
      )}
      {error ? <p className="form-error connector-module-error" role="alert">{error}</p> : null}
    </section>
  );
}
