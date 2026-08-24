import {
  Bot,
  ChevronLeft,
  CircleHelp,
  Power,
  RefreshCw,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import clsx from "clsx";
import { ConnectorDetailsToggle } from "./ConnectorDetailsToggle";
import {
  formatLastEvent,
  invokeConnectorAdmin,
  invokeConnectorSync,
  useConnectorSettings,
  type YunxiaoConnectorListItem,
} from "./lib/connectorAdmin";
import type {
  Connector,
  Label,
  LabelPermissionLevel,
  Workspace,
} from "./types";

type YunxiaoProject = { id: string; name: string };
type YunxiaoType = { id: string; categoryId: string; name: string };
type YunxiaoStatus = { id: string; name: string };

const yunxiaoCompletedStatusHint = "当蚂蚁清单中待办完成时，会同步变更云效中的任务状态到该状态";
const yunxiaoPersonalTokenUrl = "https://account-devops.aliyun.com/settings/personalAccessToken";
const yunxiaoConnectorDocsUrl = "https://docs.anttodo.com/企业管理/云效连接器";
const yunxiaoOrganizationUrl = "https://account-devops.aliyun.com/settings/joinedOrganizations";
const yunxiaoSearchWorkitemsUrl = "https://help.aliyun.com/zh/yunxiao/developer-reference/searchworkitems";

export function ConnectorSettingsPanel({
  workspace,
  connectors: bundleConnectors,
  labels,
  labelPermissionLevels,
  online,
  configOpen,
  onConfigOpenChange,
  onNotice,
}: {
  workspace: Workspace;
  connectors: Connector[];
  labels: Label[];
  labelPermissionLevels: Record<string, LabelPermissionLevel>;
  online: boolean;
  configOpen: boolean;
  onConfigOpenChange: (open: boolean) => void;
  onNotice: (message: string) => void;
}) {
  const { demo, connectorQuery, data, refresh } = useConnectorSettings(
    workspace,
    bundleConnectors,
  );
  const [section, setSection] = useState<"market" | "connected">("market");
  const [marketCategory, setMarketCategory] = useState<"all" | "development">("all");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [yunxiaoStepBusy, setYunxiaoStepBusy] = useState(false);
  const yunxiaoLoadId = useRef(0);
  const [yunxiaoProjects, setYunxiaoProjects] = useState<YunxiaoProject[]>([]);
  const [yunxiaoTypes, setYunxiaoTypes] = useState<YunxiaoType[]>([]);
  const [yunxiaoStatuses, setYunxiaoStatuses] = useState<YunxiaoStatus[]>([]);
  const [yunxiaoDraft, setYunxiaoDraft] = useState({
    name: "云效工作项同步",
    organizationId: "",
    projectId: "",
    token: "",
    workitemTypeId: "",
    conditions: "[]",
    scheduleMinutes: 30,
    targetLabelId: "",
    completedStatusId: "",
  });
  const [rotatingConnectorId, setRotatingConnectorId] = useState<string | null>(null);
  const [rotationToken, setRotationToken] = useState("");
  const [expandedConnectorIds, setExpandedConnectorIds] = useState<ReadonlySet<string>>(() => new Set());

  function toggleConnectorDetails(id: string) {
    setExpandedConnectorIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const editableLabels = labels.filter((label) => labelPermissionLevels[label.id] >= 2);
  const connectedCount = data.yunxiaoConnectors.length;

  function resetYunxiaoCascade(next: Partial<typeof yunxiaoDraft>) {
    yunxiaoLoadId.current += 1;
    setError("");
    setYunxiaoStepBusy(false);
    setYunxiaoProjects([]);
    setYunxiaoTypes([]);
    setYunxiaoStatuses([]);
    setYunxiaoDraft({
      ...yunxiaoDraft,
      ...next,
      projectId: "",
      workitemTypeId: "",
      completedStatusId: "",
    });
  }

  async function loadYunxiaoProjects() {
    const requestId = ++yunxiaoLoadId.current;
    setYunxiaoStepBusy(true);
    setError("");
    try {
      const result = await invokeConnectorAdmin({
        action: "list-yunxiao-projects",
        organizationId: yunxiaoDraft.organizationId,
        token: yunxiaoDraft.token,
      }) as { projects: YunxiaoProject[] };
      if (requestId !== yunxiaoLoadId.current) return;
      if (!result.projects.length) throw new Error("当前组织没有可见的云效项目");
      setYunxiaoProjects(result.projects);
      setYunxiaoTypes([]);
      setYunxiaoStatuses([]);
      setYunxiaoDraft((current) => ({
        ...current,
        projectId: "",
        workitemTypeId: "",
        completedStatusId: "",
      }));
    } catch (cause) {
      if (requestId !== yunxiaoLoadId.current) return;
      setYunxiaoProjects([]);
      setYunxiaoTypes([]);
      setYunxiaoStatuses([]);
      setError(cause instanceof Error ? cause.message : "组织和令牌验证失败");
    } finally {
      if (requestId === yunxiaoLoadId.current) setYunxiaoStepBusy(false);
    }
  }

  async function loadYunxiaoTypes(projectId: string) {
    const requestId = ++yunxiaoLoadId.current;
    setYunxiaoStepBusy(true);
    setError("");
    try {
      const result = await invokeConnectorAdmin({
        action: "list-yunxiao-types",
        organizationId: yunxiaoDraft.organizationId,
        projectId,
        token: yunxiaoDraft.token,
      }) as { types: YunxiaoType[] };
      if (requestId !== yunxiaoLoadId.current) return;
      if (!result.types.length) throw new Error("当前项目没有可用的工作项类型");
      setYunxiaoTypes(result.types);
      setYunxiaoStatuses([]);
      setYunxiaoDraft((current) => ({
        ...current,
        workitemTypeId: "",
        completedStatusId: "",
      }));
    } catch (cause) {
      if (requestId !== yunxiaoLoadId.current) return;
      setYunxiaoTypes([]);
      setYunxiaoStatuses([]);
      setError(cause instanceof Error ? cause.message : "加载工作项类型失败");
    } finally {
      if (requestId === yunxiaoLoadId.current) setYunxiaoStepBusy(false);
    }
  }

  async function loadYunxiaoStatuses(projectId: string, workitemTypeId: string) {
    const requestId = ++yunxiaoLoadId.current;
    setYunxiaoStepBusy(true);
    setError("");
    try {
      const result = await invokeConnectorAdmin({
        action: "list-yunxiao-statuses",
        organizationId: yunxiaoDraft.organizationId,
        projectId,
        workitemTypeId,
        token: yunxiaoDraft.token,
      }) as { statuses: YunxiaoStatus[] };
      if (requestId !== yunxiaoLoadId.current) return;
      if (!result.statuses.length) throw new Error("所选工作项类型没有可用状态");
      setYunxiaoStatuses(result.statuses);
      setYunxiaoDraft((current) => ({ ...current, completedStatusId: "" }));
    } catch (cause) {
      if (requestId !== yunxiaoLoadId.current) return;
      setYunxiaoStatuses([]);
      setError(cause instanceof Error ? cause.message : "加载工作流状态失败");
    } finally {
      if (requestId === yunxiaoLoadId.current) setYunxiaoStepBusy(false);
    }
  }

  async function installYunxiao() {
    setYunxiaoStepBusy(true);
    setError("");
    try {
      const conditions = JSON.parse(yunxiaoDraft.conditions || "[]") as unknown;
      await invokeConnectorAdmin({
        action: "install-yunxiao",
        workspaceId: workspace.id,
        ...yunxiaoDraft,
        conditions,
      });
      await refresh();
      onConfigOpenChange(false);
      setSection("connected");
      onNotice("云效连接器已接入，首次同步已排队");
    } catch (cause) {
      setError(cause instanceof SyntaxError
        ? "过滤条件不是有效 JSON"
        : cause instanceof Error ? cause.message : "云效连接器接入失败");
    } finally {
      setYunxiaoStepBusy(false);
    }
  }

  async function toggleYunxiao(item: YunxiaoConnectorListItem) {
    setBusyAction(`toggle:${item.id}`);
    setError("");
    try {
      await invokeConnectorAdmin({
        action: "set-yunxiao-enabled",
        connectorId: item.id,
        enabled: !item.enabled,
      });
      await refresh();
      onNotice(item.enabled ? "云效同步已停用" : "云效同步已启用");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "状态更新失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function syncYunxiao(item: YunxiaoConnectorListItem) {
    setBusyAction(`sync:${item.id}`);
    setError("");
    try {
      await invokeConnectorSync(item.id);
      await refresh();
      onNotice("云效同步完成");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "同步失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function rotateYunxiaoToken(item: YunxiaoConnectorListItem) {
    setBusyAction(`rotate:${item.id}`);
    setError("");
    try {
      await invokeConnectorAdmin({
        action: "rotate-yunxiao-token",
        connectorId: item.id,
        token: rotationToken,
      });
      await refresh();
      setRotationToken("");
      setRotatingConnectorId(null);
      onNotice("云效个人令牌已更新");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "令牌更新失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function removeYunxiao(item: YunxiaoConnectorListItem) {
    if (!window.confirm(`确定移除“${item.name}”？还有任务未删除（包含回收站）时系统会拒绝移除。`)) return;
    setBusyAction(`delete:${item.id}`);
    setError("");
    try {
      await invokeConnectorAdmin({ action: "delete-yunxiao", connectorId: item.id });
      await refresh();
      onNotice("云效连接器已移除");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移除失败");
    } finally {
      setBusyAction(null);
    }
  }

  function closeYunxiaoConfig() {
    if (yunxiaoStepBusy) return;
    setError("");
    onConfigOpenChange(false);
  }

  if (configOpen) {
    return (
      <form
        className="connector-config-dialog"
        aria-labelledby="yunxiao-config-title"
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
            onClick={closeYunxiaoConfig}
          >
            <ChevronLeft />
            返回
          </button>
          <div>
            <h2 id="yunxiao-config-title">接入云效中心版</h2>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </div>
        </header>
        <div className="connector-config-body">
          <div className="connector-config-grid">
            <label><span>同步任务名</span><input required maxLength={120} value={yunxiaoDraft.name} onChange={(event) => setYunxiaoDraft({ ...yunxiaoDraft, name: event.target.value })} /></label>
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
              <input required value={yunxiaoDraft.organizationId} onChange={(event) => {
                resetYunxiaoCascade({ organizationId: event.target.value });
              }} />
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
              <input type="password" required autoComplete="new-password" value={yunxiaoDraft.token} onChange={(event) => {
                resetYunxiaoCascade({ token: event.target.value });
              }} />
            </label>
            <div className="connector-config-wide connector-config-verify">
              <button type="button" className="button secondary" disabled={yunxiaoStepBusy || !yunxiaoDraft.organizationId.trim() || !yunxiaoDraft.token.trim()} onClick={() => void loadYunxiaoProjects()}>
                {yunxiaoStepBusy && !yunxiaoProjects.length ? "验证中…" : "验证组织与令牌"}
              </button>
            </div>
            <label><span>项目</span><select required disabled={!yunxiaoProjects.length} value={yunxiaoDraft.projectId} onChange={(event) => {
              const projectId = event.target.value;
              setYunxiaoTypes([]);
              setYunxiaoStatuses([]);
              setYunxiaoDraft({
                ...yunxiaoDraft,
                projectId,
                workitemTypeId: "",
                completedStatusId: "",
              });
              if (projectId) void loadYunxiaoTypes(projectId);
            }}><option value="">请先验证</option>{yunxiaoProjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label><span>工作项类型</span><select required disabled={!yunxiaoTypes.length} value={yunxiaoDraft.workitemTypeId} onChange={(event) => {
              const workitemTypeId = event.target.value;
              setYunxiaoStatuses([]);
              setYunxiaoDraft({ ...yunxiaoDraft, workitemTypeId, completedStatusId: "" });
              if (workitemTypeId) void loadYunxiaoStatuses(yunxiaoDraft.projectId, workitemTypeId);
            }}><option value="">请先选择项目</option>{yunxiaoTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>
              <span className="connector-config-label-text">
                云效完成状态
                <button
                  type="button"
                  className="connector-config-hint"
                  aria-label={yunxiaoCompletedStatusHint}
                >
                  <CircleHelp aria-hidden="true" />
                  <span className="connector-config-hint-tooltip" role="tooltip">
                    {yunxiaoCompletedStatusHint}
                  </span>
                </button>
              </span>
              <select required disabled={!yunxiaoStatuses.length} value={yunxiaoDraft.completedStatusId} onChange={(event) => setYunxiaoDraft({ ...yunxiaoDraft, completedStatusId: event.target.value })}>
                <option value="">请先选择类型</option>
                {yunxiaoStatuses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label><span>同步到该标签下</span><select required value={yunxiaoDraft.targetLabelId} onChange={(event) => setYunxiaoDraft({ ...yunxiaoDraft, targetLabelId: event.target.value })}><option value="">请选择</option>{editableLabels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}</select></label>
            <label><span>同步间隔</span><select value={yunxiaoDraft.scheduleMinutes} onChange={(event) => setYunxiaoDraft({ ...yunxiaoDraft, scheduleMinutes: Number(event.target.value) })}><option value={5}>5 分钟</option><option value={30}>30 分钟</option><option value={60}>1 小时</option><option value={180}>3 小时</option><option value={1440}>24 小时</option></select></label>
            <label className="connector-config-wide">
              <span className="connector-config-label-text">
                过滤条件（JSON，可留空数组）
                <a
                  className="connector-config-label-link"
                  href={yunxiaoSearchWorkitemsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  获取
                </a>
              </span>
              <textarea rows={7} spellCheck={false} value={yunxiaoDraft.conditions} onChange={(event) => setYunxiaoDraft({ ...yunxiaoDraft, conditions: event.target.value })} />
              <small>支持官方 conditionGroups 对象，也可直接填写条件数组；系统会为每组追加 gmtModified BETWEEN。</small>
            </label>
          </div>
        </div>
        <footer>
          <button type="button" className="button secondary" disabled={yunxiaoStepBusy} onClick={closeYunxiaoConfig}>取消</button>
          <button type="submit" className="button primary" disabled={yunxiaoStepBusy || !yunxiaoStatuses.length || !online}>{yunxiaoStepBusy ? "接入中…" : "保存并接入"}</button>
        </footer>
      </form>
    );
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
          已接入{connectedCount ? ` ${connectedCount}` : ""}
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
              aria-selected={marketCategory === "all"}
              className={marketCategory === "all" ? "active" : undefined}
              onClick={() => setMarketCategory("all")}
            >
              全部
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={marketCategory === "development"}
              className={marketCategory === "development" ? "active" : undefined}
              onClick={() => setMarketCategory("development")}
            >
              研发工具
            </button>
          </div>

          <div className="connector-market-grid">
            <article className="connector-market-card">
              <span className="connector-logo yunxiao">云</span>
              <div className="connector-market-copy">
                <strong>云效</strong>
                <p>按更新时间同步项目工作项，并将完成状态双向回写到云效。</p>
              </div>
              <div className="connector-market-action">
                <button
                  type="button"
                  className="button primary"
                  disabled={!online || editableLabels.length === 0}
                  onClick={() => {
                    setError("");
                    setYunxiaoDraft((current) => ({
                      ...current,
                      targetLabelId: current.targetLabelId || editableLabels[0]?.id || "",
                    }));
                    onConfigOpenChange(true);
                  }}
                >
                  接入
                </button>
              </div>
            </article>
          </div>
        </div>
      ) : (
        <div className="connector-connected-panel" role="tabpanel">
          {connectedCount === 0 ? (
            <div className="connector-empty">
              <Bot aria-hidden="true" />
              <strong>还没有接入连接器</strong>
              <span>前往连接器市场，选择适合团队的连接器。</span>
              <button type="button" className="button primary" onClick={() => setSection("market")}>
                浏览连接器市场
              </button>
            </div>
          ) : (
            <div className="connector-connected-list">
            {data.yunxiaoConnectors.map((item) => {
              const label = labels.find((candidate) => candidate.id === item.targetLabelId);
              const runFailed = item.lastRun?.status === "failed";
              const detailsId = `connector-details-${item.id}`;
              const expanded = expandedConnectorIds.has(item.id);
              return (
                <article className={clsx("connector-connected-card", expanded && "is-expanded")} key={item.id}>
                  <header>
                    <span className="connector-logo yunxiao">云</span>
                    <div>
                      <strong>{item.name}</strong>
                      <span className={clsx(
                        "connector-status",
                        runFailed ? "blocked" : item.enabled ? "enabled" : "disabled",
                      )}>
                        {runFailed ? "同步失败" : item.enabled ? "已启用" : "已停用"}
                      </span>
                    </div>
                    <div className="connector-connected-actions">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={!online || busyAction !== null || !item.enabled}
                        onClick={() => void syncYunxiao(item)}
                      >
                        <RefreshCw aria-hidden="true" />同步
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={!online || busyAction !== null}
                        onClick={() => void toggleYunxiao(item)}
                      >
                        <Power aria-hidden="true" />{item.enabled ? "停用" : "启用"}
                      </button>
                      <button
                        type="button"
                        className="button secondary danger"
                        disabled={!online || busyAction !== null}
                        onClick={() => void removeYunxiao(item)}
                      >
                        <Trash2 aria-hidden="true" />移除
                      </button>
                    </div>
                  </header>
                  {expanded ? (
                    <div id={detailsId} className="connector-connected-details">
                      <dl className="connector-detail-list">
                        <div><dt>项目 / 类型</dt><dd>{item.config.projectId} · {item.config.workitemTypeName}</dd></div>
                        <div><dt>目标标签</dt><dd>{label?.name ?? "标签不可见"}</dd></div>
                        <div><dt>同步间隔</dt><dd>{item.scheduleMinutes < 60 ? `${item.scheduleMinutes} 分钟` : `${item.scheduleMinutes / 60} 小时`}</dd></div>
                        <div><dt>完成状态</dt><dd>{item.config.completedStatusName}</dd></div>
                        <div><dt>个人令牌</dt><dd>{item.credentialHint ?? "未配置"}</dd></div>
                        <div><dt>最近同步</dt><dd>{item.lastSyncedAt ? formatLastEvent(item.lastSyncedAt) : "尚未同步"}</dd></div>
                      </dl>
                      {runFailed && item.lastRun?.error_message ? (
                        <p className="form-error connector-run-error">{item.lastRun.error_message}</p>
                      ) : null}
                      <div className="connector-token-rotation">
                        {rotatingConnectorId === item.id ? (
                          <>
                            <input
                              type="password"
                              value={rotationToken}
                              autoComplete="new-password"
                              placeholder="输入新的云效个人令牌"
                              onChange={(event) => setRotationToken(event.target.value)}
                              disabled={!online || busyAction !== null}
                            />
                            <button
                              type="button"
                              className="button primary"
                              disabled={!rotationToken.trim() || busyAction !== null}
                              onClick={() => void rotateYunxiaoToken(item)}
                            >保存令牌</button>
                            <button
                              type="button"
                              className="button secondary"
                              disabled={busyAction !== null}
                              onClick={() => {
                                setRotatingConnectorId(null);
                                setRotationToken("");
                              }}
                            >取消</button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="button secondary"
                            disabled={!online || busyAction !== null}
                            onClick={() => setRotatingConnectorId(item.id)}
                          >
                            <RotateCw aria-hidden="true" />更新个人令牌
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}
                  <ConnectorDetailsToggle
                    expanded={expanded}
                    detailsId={detailsId}
                    onToggle={() => toggleConnectorDetails(item.id)}
                  />
                </article>
              );
            })}
            </div>
          )}
        </div>
      )}
      {error ? <p className="form-error connector-module-error" role="alert">{error}</p> : null}
    </section>
  );
}
