import {
  Bot,
  ChevronLeft,
  Copy,
  ExternalLink,
  Power,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import { ConnectorDetailsToggle } from "./ConnectorDetailsToggle";
import {
  formatLastEvent,
  formatLastSyncedAt,
  invokeConnectorAdmin,
  useConnectorSettings,
} from "./lib/connectorAdmin";
import type {
  Connector,
  Label,
  LabelPermissionLevel,
  Workspace,
} from "./types";

const yunxiaoPersonalTokenUrl = "https://account-devops.aliyun.com/settings/personalAccessToken";
const yunxiaoConnectorDocsUrl = "https://docs.anttodo.com/企业管理/云效连接器";
const yunxiaoOrganizationUrl = "https://account-devops.aliyun.com/settings/joinedOrganizations";

export function QuickCreateSettingsPanel({
  workspace,
  connectors: bundleConnectors,
  labels,
  labelPermissionLevels,
  online,
  onNavigateToSso,
  onNotice,
}: {
  workspace: Workspace;
  connectors: Connector[];
  labels: Label[];
  labelPermissionLevels: Record<string, LabelPermissionLevel>;
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
  const [dingtalkDetailsOpen, setDingtalkDetailsOpen] = useState(false);
  const [yunxiaoDetailsOpen, setYunxiaoDetailsOpen] = useState(false);
  const [installingYunxiao, setInstallingYunxiao] = useState(false);
  const [yunxiaoStepBusy, setYunxiaoStepBusy] = useState(false);
  const [yunxiaoVerified, setYunxiaoVerified] = useState(false);
  const [rotatingYunxiao, setRotatingYunxiao] = useState(false);
  const [rotationToken, setRotationToken] = useState("");
  const [yunxiaoDraft, setYunxiaoDraft] = useState({
    organizationId: "",
    token: "",
    targetLabelId: "",
  });
  const connector = data.connectors[0] ?? null;
  const yunxiaoQuickCreate = data.yunxiaoQuickCreate;
  const detailsId = connector ? `quick-create-details-${connector.id}` : "";
  const yunxiaoDetailsId = yunxiaoQuickCreate ? `quick-create-yunxiao-${yunxiaoQuickCreate.id}` : "";
  const editableLabels = labels.filter((label) => (labelPermissionLevels[label.id] ?? 0) >= 2);

  async function installDingtalk() {
    if (demo) {
      onNotice("演示模式仅预览钉钉群机器人接入效果");
      return;
    }
    setBusyAction("install-dingtalk");
    setError("");
    try {
      await invokeConnectorAdmin({
        action: "install-dingtalk-group-bot",
        workspaceId: workspace.id,
      });
      await refresh();
      setDingtalkDetailsOpen(true);
      onNotice("钉钉群机器人已接入，请继续完成钉钉开放平台配置");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "接入失败，请稍后重试。");
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleDingtalkEnabled() {
    if (!connector || demo) return;
    setBusyAction("toggle-dingtalk");
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

  async function removeDingtalk() {
    if (!connector || demo) return;
    if (!window.confirm("确定移除钉钉群机器人？钉钉 SSO 配置不会受到影响。")) return;
    setBusyAction("delete-dingtalk");
    setError("");
    try {
      await invokeConnectorAdmin({ action: "delete", connectorId: connector.id });
      await refresh();
      setDingtalkDetailsOpen(false);
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

  function openYunxiaoInstall() {
    if (demo) {
      onNotice("演示模式仅预览云效创建接入效果");
      return;
    }
    setError("");
    setYunxiaoVerified(false);
    setYunxiaoDraft({
      organizationId: "",
      token: "",
      targetLabelId: editableLabels[0]?.id ?? "",
    });
    setInstallingYunxiao(true);
  }

  async function verifyYunxiao() {
    setYunxiaoStepBusy(true);
    setError("");
    try {
      const result = await invokeConnectorAdmin({
        action: "list-yunxiao-projects",
        organizationId: yunxiaoDraft.organizationId,
        token: yunxiaoDraft.token,
      }) as { projects: Array<{ id: string }> };
      if (!result.projects.length) throw new Error("当前组织没有可见的云效项目");
      setYunxiaoVerified(true);
    } catch (cause) {
      setYunxiaoVerified(false);
      setError(cause instanceof Error ? cause.message : "组织和令牌验证失败");
    } finally {
      setYunxiaoStepBusy(false);
    }
  }

  async function installYunxiao() {
    setYunxiaoStepBusy(true);
    setError("");
    try {
      await invokeConnectorAdmin({
        action: "install-yunxiao-quick-create",
        workspaceId: workspace.id,
        organizationId: yunxiaoDraft.organizationId,
        token: yunxiaoDraft.token,
        targetLabelId: yunxiaoDraft.targetLabelId,
      });
      await refresh();
      setInstallingYunxiao(false);
      setYunxiaoDetailsOpen(true);
      onNotice("云效创建已接入，粘贴云效链接即可生成外部待办");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "云效创建接入失败");
    } finally {
      setYunxiaoStepBusy(false);
    }
  }

  async function toggleYunxiaoEnabled() {
    if (!yunxiaoQuickCreate || demo) return;
    setBusyAction("toggle-yunxiao");
    setError("");
    try {
      await invokeConnectorAdmin({
        action: "set-yunxiao-enabled",
        connectorId: yunxiaoQuickCreate.id,
        enabled: !yunxiaoQuickCreate.enabled,
      });
      await refresh();
      onNotice(yunxiaoQuickCreate.enabled ? "云效创建已停用" : "云效创建已启用");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "状态更新失败。");
    } finally {
      setBusyAction(null);
    }
  }

  async function rotateYunxiaoToken() {
    if (!yunxiaoQuickCreate || demo) return;
    setBusyAction("rotate-yunxiao");
    setError("");
    try {
      await invokeConnectorAdmin({
        action: "rotate-yunxiao-token",
        connectorId: yunxiaoQuickCreate.id,
        token: rotationToken,
      });
      await refresh();
      setRotationToken("");
      setRotatingYunxiao(false);
      onNotice("云效个人令牌已更新");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "令牌更新失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function removeYunxiao() {
    if (!yunxiaoQuickCreate || demo) return;
    if (!window.confirm("确定移除云效创建？还有任务未删除（包含回收站）时系统会拒绝移除。")) return;
    setBusyAction("delete-yunxiao");
    setError("");
    try {
      await invokeConnectorAdmin({
        action: "delete-yunxiao",
        connectorId: yunxiaoQuickCreate.id,
      });
      await refresh();
      setYunxiaoDetailsOpen(false);
      onNotice("云效创建已移除");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移除失败。");
    } finally {
      setBusyAction(null);
    }
  }

  if (installingYunxiao) {
    return (
      <form
        className="connector-config-dialog"
        aria-labelledby="yunxiao-quick-create-title"
        onSubmit={(event) => {
          event.preventDefault();
          void installYunxiao();
        }}
      >
        <header>
          <button
            type="button"
            className="connector-config-back"
            disabled={yunxiaoStepBusy}
            onClick={() => {
              if (yunxiaoStepBusy) return;
              setInstallingYunxiao(false);
              setError("");
            }}
          >
            <ChevronLeft />
            返回
          </button>
          <div>
            <h2 id="yunxiao-quick-create-title">接入云效创建</h2>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </div>
        </header>
        <div className="connector-config-body">
          <div className="connector-config-grid">
            <label>
              <span className="connector-config-label-text">
                组织 ID
                <a
                  className="connector-config-label-link"
                  href={yunxiaoOrganizationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  获取
                </a>
              </span>
              <input
                required
                value={yunxiaoDraft.organizationId}
                onChange={(event) => {
                  setYunxiaoVerified(false);
                  setYunxiaoDraft({ ...yunxiaoDraft, organizationId: event.target.value });
                }}
              />
            </label>
            <label className="connector-config-wide">
              <span className="connector-config-label-text">
                个人令牌
                <a
                  className="connector-config-label-link"
                  href={yunxiaoPersonalTokenUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  获取
                </a>
                <a
                  className="connector-config-label-link"
                  href={yunxiaoConnectorDocsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  文档
                </a>
              </span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={yunxiaoDraft.token}
                onChange={(event) => {
                  setYunxiaoVerified(false);
                  setYunxiaoDraft({ ...yunxiaoDraft, token: event.target.value });
                }}
              />
            </label>
            <div className="connector-config-wide connector-config-verify">
              <button
                type="button"
                className="button secondary"
                disabled={
                  yunxiaoStepBusy
                  || !yunxiaoDraft.organizationId.trim()
                  || !yunxiaoDraft.token.trim()
                }
                onClick={() => void verifyYunxiao()}
              >
                {yunxiaoStepBusy && !yunxiaoVerified ? "验证中…" : "验证组织与令牌"}
              </button>
            </div>
            <label>
              <span>创建到该标签下</span>
              <select
                required
                value={yunxiaoDraft.targetLabelId}
                onChange={(event) => setYunxiaoDraft({
                  ...yunxiaoDraft,
                  targetLabelId: event.target.value,
                })}
              >
                <option value="">请选择</option>
                {editableLabels.map((label) => (
                  <option key={label.id} value={label.id}>{label.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <footer>
          <button
            type="button"
            className="button secondary"
            disabled={yunxiaoStepBusy}
            onClick={() => {
              setInstallingYunxiao(false);
              setError("");
            }}
          >
            取消
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={yunxiaoStepBusy || !yunxiaoVerified || !yunxiaoDraft.targetLabelId || !online}
          >
            {yunxiaoStepBusy ? "接入中…" : "保存并接入"}
          </button>
        </footer>
      </form>
    );
  }

  const yunxiaoTargetLabel = labels.find((label) => label.id === yunxiaoQuickCreate?.targetLabelId);

  return (
    <section className="connector-module" aria-labelledby="quick-create-module-title">
      <header className="connector-module-header">
        <div>
          <h1 id="quick-create-module-title">快速创建</h1>
          <p>从钉钉群消息或云效链接，把外部事项快速变成团队待办。</p>
        </div>
      </header>

      {connectorQuery.isLoading && !demo ? (
        <div className="connector-empty">正在加载快速创建…</div>
      ) : connectorQuery.isError && !demo ? (
        <div className="connector-empty is-error">快速创建暂时无法加载，请稍后重试。</div>
      ) : (
        <>
          {connector || yunxiaoQuickCreate ? (
            <div className="connector-connected-panel">
              <div className="connector-connected-list">
                {connector ? (
                  <article className={clsx("connector-connected-card", dingtalkDetailsOpen && "is-expanded")}>
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
                            onClick={() => void toggleDingtalkEnabled()}
                          >
                            <Power aria-hidden="true" />{connector.enabled ? "停用" : "启用"}
                          </button>
                          <button
                            type="button"
                            className="button secondary danger"
                            disabled={!online || busyAction !== null}
                            onClick={() => void removeDingtalk()}
                          >
                            <Trash2 aria-hidden="true" />移除
                          </button>
                        </div>
                      ) : null}
                    </header>

                    {dingtalkDetailsOpen ? (
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
                      expanded={dingtalkDetailsOpen}
                      detailsId={detailsId}
                      onToggle={() => setDingtalkDetailsOpen((open) => !open)}
                    />
                  </article>
                ) : null}

                {yunxiaoQuickCreate ? (
                  <article className={clsx("connector-connected-card", yunxiaoDetailsOpen && "is-expanded")}>
                    <header>
                      <span className="connector-logo yunxiao">云</span>
                      <div>
                        <strong>{yunxiaoQuickCreate.name}</strong>
                        <span className={clsx(
                          "connector-status",
                          yunxiaoQuickCreate.enabled ? "enabled" : "disabled",
                        )}>
                          {yunxiaoQuickCreate.enabled ? "已启用" : "已停用"}
                        </span>
                      </div>
                      {data.canManage && !demo ? (
                        <div className="connector-connected-actions">
                          <button
                            type="button"
                            className="button secondary"
                            disabled={!online || busyAction !== null}
                            onClick={() => void toggleYunxiaoEnabled()}
                          >
                            <Power aria-hidden="true" />{yunxiaoQuickCreate.enabled ? "停用" : "启用"}
                          </button>
                          <button
                            type="button"
                            className="button secondary danger"
                            disabled={!online || busyAction !== null}
                            onClick={() => void removeYunxiao()}
                          >
                            <Trash2 aria-hidden="true" />移除
                          </button>
                        </div>
                      ) : null}
                    </header>
                    {yunxiaoDetailsOpen ? (
                      <div id={yunxiaoDetailsId} className="connector-connected-details">
                        <dl className="connector-detail-list">
                          <div><dt>组织 ID</dt><dd>{yunxiaoQuickCreate.organizationId}</dd></div>
                          <div><dt>目标标签</dt><dd>{yunxiaoTargetLabel?.name ?? "未指定"}</dd></div>
                          <div><dt>个人令牌</dt><dd>{yunxiaoQuickCreate.credentialHint || "未配置"}</dd></div>
                          <div>
                            <dt>最近使用</dt>
                            <dd>
                              {yunxiaoQuickCreate.lastEventAt
                                ? formatLastSyncedAt(yunxiaoQuickCreate.lastEventAt)
                                : "尚未导入工作项"}
                            </dd>
                          </div>
                        </dl>
                        <section className="connector-setup-guide" aria-label="云效创建使用说明">
                          <h2>在任务创建框粘贴云效链接</h2>
                          <p>支持需求、缺陷等短链，例如 <code>https://devops.aliyun.com/projex/req/HQGS-354</code>。</p>
                          {data.canManage && !demo ? (
                            rotatingYunxiao ? (
                              <div className="connector-callback-row">
                                <input
                                  type="password"
                                  autoComplete="new-password"
                                  placeholder="新的个人令牌"
                                  value={rotationToken}
                                  onChange={(event) => setRotationToken(event.target.value)}
                                />
                                <button
                                  type="button"
                                  className="button secondary"
                                  disabled={!online || busyAction !== null || !rotationToken.trim()}
                                  onClick={() => void rotateYunxiaoToken()}
                                >
                                  <RotateCw aria-hidden="true" />更新
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="button secondary"
                                disabled={!online || busyAction !== null}
                                onClick={() => setRotatingYunxiao(true)}
                              >
                                <RotateCw aria-hidden="true" />更新个人令牌
                              </button>
                            )
                          ) : null}
                        </section>
                      </div>
                    ) : null}
                    <ConnectorDetailsToggle
                      expanded={yunxiaoDetailsOpen}
                      detailsId={yunxiaoDetailsId}
                      onToggle={() => setYunxiaoDetailsOpen((open) => !open)}
                    />
                  </article>
                ) : null}
              </div>
            </div>
          ) : null}

          {!connector || !yunxiaoQuickCreate ? (
            <div className="connector-market-panel">
              <div className="connector-market-grid">
                {!connector ? (
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
                          onClick={() => void installDingtalk()}
                        >
                          {busyAction === "install-dingtalk" ? "接入中…" : "接入"}
                        </button>
                      ) : (
                        <span className="connector-readonly">联系管理员接入</span>
                      )}
                    </div>
                  </article>
                ) : null}
                {!yunxiaoQuickCreate ? (
                  <article className="connector-market-card">
                    <span className="connector-logo yunxiao">云</span>
                    <div className="connector-market-copy">
                      <strong>云效创建</strong>
                      <p>在任务创建框粘贴云效链接，自动生成带云效标记的外部待办。</p>
                    </div>
                    <div className="connector-market-action">
                      {data.canManage ? (
                        <button
                          type="button"
                          className="button primary"
                          disabled={!online || busyAction !== null || (!demo && editableLabels.length === 0)}
                          onClick={openYunxiaoInstall}
                        >
                          接入
                        </button>
                      ) : (
                        <span className="connector-readonly">联系管理员接入</span>
                      )}
                    </div>
                  </article>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
      {error ? <p className="form-error connector-module-error" role="alert">{error}</p> : null}
    </section>
  );
}
