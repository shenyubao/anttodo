import * as Dialog from "@radix-ui/react-dialog";
import { WeeklyReportGroupDialog } from "./WeeklyReportGroupDialog";
import { createDemoWeeklyReportGroups, useWeeklyReportGroups, weeklyReportGroupsKey } from "./lib/weeklyReportGroupsApi";
import { WeeklyReportNotificationGroupDialog } from "./WeeklyReportNotificationGroupDialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Menu,
  Plus,
  Search,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { WeeklyReportOkrSection } from "./WeeklyReportOkrSection";
import { FocusTaskPicker } from "./FocusTaskPicker";
import { MemberAvatar } from "./MemberAvatar";
import type { AppRoute } from "./lib/appRoute";
import { currentAppUrl } from "./lib/instanceConfig";
import { memberDisplayName } from "./lib/taskTitleTokens";
import { supabase } from "./lib/supabase";
import {
  deleteWeeklyReport,
  loadWeeklyReport,
  loadWeeklyReports,
  saveWeeklyReport,
  weeklyReportDetailKey,
  weeklyReportsKey,
} from "./lib/weeklyReportsApi";
import {
  createWeeklyReportNotificationGroup,
  deleteWeeklyReportNotificationGroup,
  dispatchWeeklyReportNotifications,
  loadWeeklyReportNotificationGroups,
  weeklyReportNotificationGroupsKey,
} from "./lib/weeklyReportNotificationsApi";
import {
  appendWeeklyReportTaskLines,
  canCreateWeeklyReportForWeek,
  defaultWeeklyReportTaskFilters,
  filterWeeklyReportPickerTasks,
  shiftWeeklyReportWeek,
  sortWeeklyReports,
  weeklyReportPublishError,
  weeklyReportWeekMeta,
  weeklyReportWeekStart,
  type WeeklyReportSection,
  type WeeklyReportTaskAssigneeFilter,
  type WeeklyReportTaskFilters,
  type WeeklyReportTaskTimeFilter,
} from "./lib/weeklyReports";
import type {
  Label,
  Member,
  NoticeHandler,
  Task,
  UserGroup,
  WeeklyReport,
  WeeklyReportGroup,
  WeeklyReportNotificationGroup,
  WeeklyReportNotificationSummary,
  WeeklyReportVisibility,
} from "./types";

type WeeklyReportsRoute = Extract<AppRoute, { kind: "weekly_reports" }>;

type WeeklyReportsProps = {
  workspaceId: string;
  currentUserId: string;
  members: Member[];
  userGroups: UserGroup[];
  labels: Label[];
  tasks: Task[];
  online: boolean;
  demoMode: boolean;
  route: WeeklyReportsRoute;
  onNavigate: (route: WeeklyReportsRoute, replace?: boolean) => void;
  onMenu: () => void;
  onNotice: NoticeHandler;
};
type WeeklyReportNavigationGuard = { dirty: boolean; busy: boolean; save: () => Promise<boolean> };

export function WeeklyReportsWorkspace(props: WeeklyReportsProps) {
  const { workspaceId, currentUserId, members, userGroups, route, onNavigate, online, demoMode } = props;
  const queryClient = useQueryClient();
  const query = useWeeklyReportGroups(workspaceId, demoMode);
  const demoGroups = useMemo(() => createDemoWeeklyReportGroups(workspaceId, members.map((member) => member.user_id)), [workspaceId, members]);
  const groups = demoMode ? demoGroups : query.data ?? [];
  const detail = useQuery({
    queryKey: weeklyReportDetailKey(workspaceId, "reportId" in route ? route.reportId : "none"),
    queryFn: () => loadWeeklyReport(supabase!, workspaceId, "reportId" in route ? route.reportId : ""),
    initialData: () => "reportId" in route
      ? queryClient.getQueriesData<WeeklyReport[]>({ queryKey: ["weekly-reports", workspaceId, "groups-v1"] })
        .flatMap(([, reports]) => reports ?? []).find((report) => report.id === route.reportId)
      : undefined,
    enabled: Boolean(supabase) && !demoMode && "reportId" in route,
  });
  const selectedId = "reportId" in route ? detail.data?.weekly_report_group_id ?? (demoMode ? demoGroups[0]?.id : undefined)
    : route.groupId ?? groups.find((group) => group.is_default)?.id ?? groups[0]?.id;
  const group = groups.find((item) => item.id === selectedId);
  const [search, setSearch] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(() => weeklyReportWeekStart());
  const [dialog, setDialog] = useState<"new" | "edit" | null>(null);
  const guard = useRef<WeeklyReportNavigationGuard | null>(null);
  const [pendingRoute, setPendingRoute] = useState<WeeklyReportsRoute | null>(null);
  const [savingBeforeLeave, setSavingBeforeLeave] = useState(false);
  const role = members.find((member) => member.user_id === currentUserId)?.role;
  const canManage = role === "owner" || role === "admin";
  const selectGroup = (next: WeeklyReportsRoute) => {
    if (guard.current?.busy) return;
    if (guard.current?.dirty) { setPendingRoute(next); return; }
    setMobileOpen(false); onNavigate(next);
  };
  useEffect(() => {
    if (!supabase || demoMode) return;
    const refreshAccess = () => {
      // The workspace-level revision also reaches clients whose group access was revoked.
      queryClient.removeQueries({ queryKey: ["weekly-reports", workspaceId], type: "inactive" });
      queryClient.removeQueries({ queryKey: ["weekly-report", workspaceId], type: "inactive" });
      void queryClient.invalidateQueries({ queryKey: weeklyReportGroupsKey(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: ["weekly-reports", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["weekly-report", workspaceId] });
    };
    const channel = supabase.channel(`weekly-report-group-access:${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "weekly_report_groups", filter: `workspace_id=eq.${workspaceId}` }, refreshAccess)
      .on("postgres_changes", { event: "*", schema: "public", table: "weekly_report_access_revisions", filter: `workspace_id=eq.${workspaceId}` }, refreshAccess)
      .subscribe();
    return () => { void supabase!.removeChannel(channel); };
  }, [workspaceId, demoMode, queryClient]);
  useEffect(() => {
    if (!online || demoMode || !query.isSuccess || query.isFetching) return;
    const allowed = new Map((query.data ?? []).map((item) => [item.id, item]));
    for (const cached of queryClient.getQueryCache().findAll({ queryKey: ["weekly-reports", workspaceId] })) {
      const scope = allowed.get(String(cached.queryKey[3]));
      if (!scope) queryClient.removeQueries({ queryKey: cached.queryKey, exact: true });
      else if (scope.can_view_published === false) {
        const reports = cached.state.data as WeeklyReport[] | undefined;
        const own = reports?.filter((report) => report.author_id === currentUserId);
        if (own && own.length !== reports?.length) queryClient.setQueryData(cached.queryKey, own);
      }
    }
    for (const cached of queryClient.getQueryCache().findAll({ queryKey: ["weekly-report", workspaceId] })) {
      const report = cached.state.data as WeeklyReport | null | undefined;
      if (!report) continue;
      const scope = allowed.get(report.weekly_report_group_id);
      if (!scope || (scope.can_view_published === false && report.author_id !== currentUserId)) {
        // Active observers must receive null rather than retain a detached private snapshot.
        queryClient.setQueryData(cached.queryKey, null);
        if (!cached.getObserversCount()) queryClient.removeQueries({ queryKey: cached.queryKey, exact: true });
      }
    }
  }, [online, demoMode, query.data, query.dataUpdatedAt, query.isSuccess, query.isFetching, queryClient, workspaceId, currentUserId]);
  return <div className="weekly-report-layout">
    <button className={clsx("sidebar-scrim", mobileOpen && "visible")} type="button" aria-label="关闭周报组列表" onClick={() => setMobileOpen(false)} />
    <aside className={clsx("weekly-report-group-sidebar", mobileOpen && "mobile-open")} aria-label="周报组">
      <div className="okr-member-search"><Search aria-hidden="true" /><input aria-label="搜索周报组" placeholder="搜索周报组" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div className="weekly-report-group-caption"><span>周报组</span>{canManage && <button type="button" aria-label="新建周报组" title="新建周报组" disabled={!online || demoMode || query.isError} onClick={() => setDialog("new")}><Plus /></button>}</div>
      <div className="weekly-report-group-list">{groups.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())).map((item) => <button type="button" key={item.id} className={clsx("weekly-report-group-row", item.id === selectedId && "active")} aria-current={item.id === selectedId ? "page" : undefined} onClick={() => selectGroup({ workspaceId, kind: "weekly_reports", groupId: item.id })}><Users /><span>{item.name}</span></button>)}</div>
      {query.isLoading && !demoMode ? <p className="okr-sidebar-empty">正在读取周报组…</p> : query.isError ? <p role="alert" className="okr-sidebar-empty">周报组加载失败<button type="button" className="button secondary" onClick={() => void query.refetch()}>重新加载</button></p> : !groups.length ? <p className="okr-sidebar-empty">暂无可查看的周报组</p> : groups.every((item) => !item.name.toLowerCase().includes(search.toLowerCase())) && <p className="okr-sidebar-empty">没有匹配的周报组</p>}
      {canManage && <button type="button" className="weekly-report-group-add" disabled={!online || demoMode || query.isError} onClick={() => setDialog("new")}><Plus />新建周报组</button>}
    </aside>
    <div className="weekly-report-group-main">
      <div className="weekly-report-mobile-toolbar"><button type="button" className="button secondary" aria-label="打开导航" onClick={props.onMenu}><Menu /></button><button type="button" className="button secondary" onClick={() => setMobileOpen(true)}><Users />{group?.name ?? "周报组"}<ChevronDown /></button></div>
      {group ? <WeeklyReportGroupWorkspace {...props} key={group.id} group={group} groupError={query.isError}
        navigationGuard={guard} weekStart={weekStart} onWeekChange={setWeekStart} configuration={<button type="button" className="weekly-report-config-button" onClick={() => setDialog("edit")}><Settings />周报组配置</button>} />
        : <div className="weekly-reports-workspace"><WeeklyReportEmpty icon={query.isLoading || detail.isLoading ? "loading" : "error"} text={query.isLoading || detail.isLoading ? "正在读取周报组…" : query.isError ? "周报组加载失败，请重试" : "周报组不存在或你无权查看"} /></div>}
    </div>
    {dialog && (dialog === "new" || group) && <WeeklyReportGroupDialog key={dialog === "new" ? "new" : group!.id} workspaceId={workspaceId} group={dialog === "edit" ? group! : null} members={members} userGroups={userGroups} online={online} demoMode={demoMode} disabled={!online || demoMode || !canManage || query.isError} onClose={() => setDialog(null)} onSaved={(saved) => { setDialog(null); if (dialog === "new") selectGroup({ workspaceId, kind: "weekly_reports", groupId: saved.id }); }} onNotice={props.onNotice} />}
    <Dialog.Root open={Boolean(pendingRoute)} onOpenChange={(open) => { if (!open && !savingBeforeLeave) setPendingRoute(null); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content weekly-report-leave-dialog"><Dialog.Title>有尚未保存的周报</Dialog.Title><Dialog.Description>切换周报组前，可以保存当前内容或放弃修改。</Dialog.Description><div className="dialog-actions"><button type="button" className="button secondary" disabled={savingBeforeLeave} onClick={() => setPendingRoute(null)}>继续编辑</button><button type="button" className="button secondary" disabled={savingBeforeLeave} onClick={() => { const next = pendingRoute; setPendingRoute(null); setMobileOpen(false); if (next) onNavigate(next); }}>放弃修改</button><button type="button" className="button primary" disabled={savingBeforeLeave || !online || demoMode || !group?.participant_ids.includes(currentUserId) || query.isError} onClick={async () => { setSavingBeforeLeave(true); try { if (await guard.current?.save()) { const next = pendingRoute; setPendingRoute(null); setMobileOpen(false); if (next) onNavigate(next); } } finally { setSavingBeforeLeave(false); } }}>{savingBeforeLeave ? "保存中…" : "保存并切换"}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}

function WeeklyReportGroupWorkspace({
  workspaceId, currentUserId, members, userGroups, labels, tasks, online, demoMode, route,
  onNavigate: navigate, onMenu, onNotice, group, groupError, configuration, navigationGuard, weekStart, onWeekChange: setWeekStart,
}: WeeklyReportsProps & { group: WeeklyReportGroup; groupError: boolean; configuration: ReactNode;
  weekStart: string; onWeekChange: (week: string) => void;
  navigationGuard: RefObject<WeeklyReportNavigationGuard | null> }) {
  const onNavigate = (next: WeeklyReportsRoute, replace?: boolean) => navigate(
    "reportId" in next ? next : { ...next, groupId: group.id }, replace);
  const queryClient = useQueryClient();
  const backendAvailable = Boolean(supabase) && !demoMode;
  const canWrite = group.participant_ids.includes(currentUserId) && !groupError;
  const demoReports = useMemo(
    () => createDemoWeeklyReports(workspaceId, currentUserId, members, weekStart, group.id),
    [currentUserId, members, weekStart, workspaceId, group.id],
  );
  const listQuery = useQuery({
    queryKey: weeklyReportsKey(workspaceId, weekStart, group.id),
    queryFn: () => loadWeeklyReports(supabase!, workspaceId, weekStart, group.id),
    enabled: backendAvailable && !("page" in route),
  });
  const newWeekStart = "page" in route && route.page === "new" ? route.weekStart : null;
  const existingWeekQuery = useQuery({
    queryKey: weeklyReportsKey(workspaceId, newWeekStart ?? weeklyReportWeekStart(), group.id),
    queryFn: () => loadWeeklyReports(supabase!, workspaceId, newWeekStart ?? weeklyReportWeekStart(), group.id),
    enabled: backendAvailable && Boolean(newWeekStart),
  });

  useEffect(() => {
    if (!newWeekStart) return;
    const existing = existingWeekQuery.data?.find((report) => report.author_id === currentUserId);
    if (existing) {
      onNavigate({ workspaceId, kind: "weekly_reports", page: "edit", reportId: existing.id }, true);
    }
  }, [currentUserId, existingWeekQuery.data, newWeekStart, onNavigate, workspaceId]);

  useEffect(() => {
    if (!backendAvailable) return;
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ["weekly-reports", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["weekly-report", workspaceId] });
    };
    const invalidateNotificationGroups = () => {
      void queryClient.invalidateQueries({
        queryKey: weeklyReportNotificationGroupsKey(workspaceId),
      });
      invalidate();
    };
    const channel = supabase!.channel(`weekly-reports:${workspaceId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "weekly_reports", filter: `workspace_id=eq.${workspaceId}`,
      }, invalidate)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "weekly_report_access_revisions", filter: `workspace_id=eq.${workspaceId}`,
      }, invalidate)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "weekly_report_notification_groups", filter: `workspace_id=eq.${workspaceId}`,
      }, invalidateNotificationGroups)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "weekly_report_notification_targets", filter: `workspace_id=eq.${workspaceId}`,
      }, invalidate)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "weekly_report_notification_deliveries", filter: `workspace_id=eq.${workspaceId}`,
      }, invalidate)
      .subscribe();
    return () => { void supabase!.removeChannel(channel); };
  }, [backendAvailable, queryClient, workspaceId]);

  if (!("page" in route)) {
    const reports = backendAvailable ? listQuery.data ?? [] : demoReports;
    const filtered = sortWeeklyReports(group.can_view_published === false ? reports.filter((report) => report.author_id === currentUserId) : reports);
    const selectedWeekCreatable = canCreateWeeklyReportForWeek(weekStart);
    const createWeek = selectedWeekCreatable ? weekStart : weeklyReportWeekStart();
    return (
      <WeeklyReportFeed
        groupName={group.name}
        reports={filtered}
        loading={listQuery.isLoading && backendAvailable}
        error={listQuery.isError && backendAvailable}
        weekStart={weekStart}
        members={members}
        canWrite={canWrite}
        writeNotice={groupError ? "周报填写权限暂不可用，请稍后重试" : "你未被配置为本组周报填写人员，请联系团队空间管理员。"}
        configuration={configuration}
        demoMode={demoMode}
        online={online}
        onMenu={onMenu}
        onWeekChange={setWeekStart}
        onCreate={() => {
          if (!online || demoMode || !canWrite) {
            onNotice(demoMode ? "产品演示中的周报为只读示例" : !online ? "离线时周报仅可查看" : "仅本组应填人员可以填写周报", "error");
            return;
          }
          const existing = reports.find((report) =>
            report.author_id === currentUserId && report.week_start === createWeek);
          onNavigate(existing
            ? { workspaceId, kind: "weekly_reports", page: "edit", reportId: existing.id }
            : { workspaceId, kind: "weekly_reports", page: "new", weekStart: createWeek });
        }}
        onOpen={(reportId) => onNavigate({
          workspaceId, kind: "weekly_reports", page: "view", reportId,
        })}
      />
    );
  }

  if (route.page === "new") {
    if (!canCreateWeeklyReportForWeek(route.weekStart)) {
      return <div className="weekly-report-page"><WeeklyReportEmpty icon="error" text="只能创建本周或上一周的周报" /><button className="button secondary" onClick={() => onNavigate({ workspaceId, kind: "weekly_reports" })}>返回周报</button></div>;
    }
    if (backendAvailable && existingWeekQuery.isLoading) {
      return <WeeklyReportEmpty icon="loading" text="正在检查本周周报…" />;
    }
    return (
      <WeeklyReportEditor
        key={`new:${group.id}:${route.weekStart}`}
        group={group}
        groupError={groupError}
        navigationGuard={navigationGuard}
        report={null}
        weekStart={route.weekStart}
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        members={members}
        groups={userGroups}
        labels={labels}
        tasks={tasks}
        online={online}
        demoMode={demoMode}
        onBack={() => onNavigate({ workspaceId, kind: "weekly_reports" })}
        onNavigate={onNavigate}
        onNotice={onNotice}
      />
    );
  }

  return (
    <WeeklyReportDetailRoute
      group={group}
      groupError={groupError}
      navigationGuard={navigationGuard}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      members={members}
      groups={userGroups}
      labels={labels}
      tasks={tasks}
      online={online}
      demoMode={demoMode}
      demoReports={createDemoWeeklyReports(workspaceId, currentUserId, members, weeklyReportWeekStart(), group.id)}
      route={route}
      onNavigate={onNavigate}
      onNotice={onNotice}
    />
  );
}

function WeeklyReportFeed({
  groupName,
  reports,
  loading,
  error,
  weekStart,
  members,
  canWrite,
  writeNotice,
  configuration,
  demoMode,
  online,
  onMenu,
  onWeekChange,
  onCreate,
  onOpen,
}: {
  groupName: string;
  reports: WeeklyReport[];
  loading: boolean;
  error: boolean;
  weekStart: string;
  members: Member[];
  canWrite: boolean;
  writeNotice: string;
  configuration: ReactNode;
  demoMode: boolean;
  online: boolean;
  onMenu: () => void;
  onWeekChange: (week: string) => void;
  onCreate: () => void;
  onOpen: (reportId: string) => void;
}) {
  const meta = weeklyReportWeekMeta(weekStart);
  return (
    <div className="weekly-reports-workspace">
      <header className="weekly-reports-header">
        <button type="button" className="mobile-menu-button" aria-label="打开导航" onClick={onMenu}><Menu /></button>
        <div>
          <h1>{groupName}</h1>
          <span>{meta.year} 年第 {meta.week} 周 · {meta.range}</span>
        </div>
        <button type="button" className="button primary weekly-report-create" disabled={!online || demoMode || !canWrite} title={!canWrite ? "仅人员配置中的成员可以填写周报" : undefined} onClick={onCreate}>
          <Plus />新建周报
        </button>
      </header>
      <div className="weekly-report-filters">
        <div className="weekly-report-week-filter" aria-label="周筛选">
          <button type="button" aria-label="上一周" onClick={() => onWeekChange(shiftWeeklyReportWeek(weekStart, -1))}><ChevronLeft /></button>
          <label>
            <CalendarDays />
            <input
              type="date"
              aria-label="选择周"
              value={weekStart}
              onChange={(event) => {
                if (event.target.value) onWeekChange(weeklyReportWeekStart(new Date(`${event.target.value}T12:00:00`)));
              }}
            />
          </label>
          <button type="button" aria-label="下一周" onClick={() => onWeekChange(shiftWeeklyReportWeek(weekStart, 1))}><ChevronRight /></button>
          <button type="button" className="weekly-report-current-week" onClick={() => onWeekChange(weeklyReportWeekStart())}>本周</button>
        </div>
        {configuration}
      </div>
      {!canWrite && !demoMode && <p className="weekly-report-write-notice">{writeNotice}</p>}
      {loading ? <WeeklyReportEmpty icon="loading" text="正在读取周报…" />
        : error ? <WeeklyReportEmpty icon="error" text="周报加载失败，请稍后重试" />
          : reports.length === 0 ? <WeeklyReportEmpty icon="empty" text="这一周还没有可查看的周报" />
            : (
              <div className="weekly-report-card-flow">
                {reports.map((report) => {
                  const member = members.find((item) => item.user_id === report.author_id);
                  const reportMeta = weeklyReportWeekMeta(report.week_start);
                  return (
                    <button type="button" className="weekly-report-card" key={report.id} onClick={() => onOpen(report.id)}>
                      <div className="weekly-report-card-author">
                        {member && <MemberAvatar member={member} className="weekly-report-card-avatar" />}
                        <div><strong>{member ? memberDisplayName(member) : "团队成员"}</strong><span>{reportMeta.range}</span></div>
                      </div>
                      <h2>第 {reportMeta.week} 周周报</h2>
                      <div className="weekly-report-card-meta">
                        <span className={clsx("weekly-report-status", report.status)}>{report.status === "draft" ? "草稿" : "已发布"}</span>
                        <span>{visibilityLabel(report)}</span>
                      </div>
                      <time dateTime={report.updated_at}>更新于 {formatRelativeTime(report.updated_at)}</time>
                    </button>
                  );
                })}
              </div>
            )}
    </div>
  );
}

function WeeklyReportDetailRoute({
  group, groupError, navigationGuard,
  workspaceId,
  currentUserId,
  members,
  groups,
  labels,
  tasks,
  online,
  demoMode,
  demoReports,
  route,
  onNavigate,
  onNotice,
}: {
  group: WeeklyReportGroup;
  groupError: boolean;
  navigationGuard: RefObject<WeeklyReportNavigationGuard | null>;
  workspaceId: string;
  currentUserId: string;
  members: Member[];
  groups: UserGroup[];
  labels: Label[];
  tasks: Task[];
  online: boolean;
  demoMode: boolean;
  demoReports: WeeklyReport[];
  route: Extract<WeeklyReportsRoute, { page: "view" | "edit" }>;
  onNavigate: (route: WeeklyReportsRoute, replace?: boolean) => void;
  onNotice: NoticeHandler;
}) {
  const canWrite = group.participant_ids.includes(currentUserId) && !groupError;
  const backendAvailable = Boolean(supabase) && !demoMode;
  const query = useQuery({
    queryKey: weeklyReportDetailKey(workspaceId, route.reportId),
    queryFn: () => loadWeeklyReport(supabase!, workspaceId, route.reportId),
    enabled: backendAvailable,
  });
  const report = backendAvailable
    ? query.data ?? null
    : demoReports.find((item) => item.id === route.reportId) ?? null;

  if (query.isLoading && backendAvailable) return <WeeklyReportEmpty icon="loading" text="正在读取周报…" />;
  if (!report || (group.can_view_published === false && report.author_id !== currentUserId)) {
    return <div className="weekly-report-page"><WeeklyReportEmpty icon="error" text="周报不存在或你无权查看" /><button className="button secondary" onClick={() => onNavigate({ workspaceId, kind: "weekly_reports" })}>返回周报</button></div>;
  }
  if (route.page === "edit") {
    if (report.author_id !== currentUserId) {
      return <WeeklyReportEmpty icon="error" text="只有作者可以编辑这份周报" />;
    }
    return <WeeklyReportEditor
      group={group}
      groupError={groupError}
      navigationGuard={navigationGuard}
      key={report.id}
      report={report}
      weekStart={report.week_start}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      members={members}
      groups={groups}
      labels={labels}
      tasks={tasks}
      online={online}
      demoMode={demoMode}
      onBack={() => onNavigate({ workspaceId, kind: "weekly_reports", page: "view", reportId: report.id })}
      onNavigate={onNavigate}
      onNotice={onNotice}
    />;
  }
  return <WeeklyReportViewer
    report={report}
    member={members.find((item) => item.user_id === report.author_id)}
    isAuthor={report.author_id === currentUserId}
    readOnly={!online || demoMode || !supabase || !canWrite}
    onBack={() => onNavigate({ workspaceId, kind: "weekly_reports" })}
    onEdit={() => onNavigate({ workspaceId, kind: "weekly_reports", page: "edit", reportId: report.id })}
    onDeleted={() => onNavigate({ workspaceId, kind: "weekly_reports" })}
    onNotice={onNotice}
  />;
}

function WeeklyReportViewer({ report, member, isAuthor, readOnly, onBack, onEdit, onDeleted, onNotice }: {
  report: WeeklyReport;
  member?: Member;
  isAuthor: boolean;
  readOnly: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onNotice: NoticeHandler;
}) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const meta = weeklyReportWeekMeta(report.week_start);
  const remove = async () => {
    if (readOnly) return;
    if (!window.confirm("确定永久删除这份周报吗？此操作无法撤销。")) return;
    setDeleting(true);
    const listKey = weeklyReportsKey(report.workspace_id, report.week_start, report.weekly_report_group_id);
    const previous = queryClient.getQueryData<WeeklyReport[]>(listKey);
    queryClient.setQueryData<WeeklyReport[]>(listKey, (items) => items?.filter((item) => item.id !== report.id));
    try {
      await deleteWeeklyReport(supabase!, report.id);
      queryClient.removeQueries({ queryKey: weeklyReportDetailKey(report.workspace_id, report.id) });
      onNotice("周报已删除");
      onDeleted();
    } catch (error) {
      queryClient.setQueryData(listKey, previous);
      onNotice(error instanceof Error ? error.message : "删除周报失败", "error");
    } finally {
      setDeleting(false);
    }
  };
  const publish = async () => {
    if (readOnly) return;
    const message = weeklyReportPublishError({
      okrProgressText: report.okr_progress_text ?? "",
      completedText: report.completed_text,
      nextPlanText: report.next_plan_text,
      reflectionText: report.reflection_text,
      visibility: "workspace",
      userIds: [],
      groupIds: [],
    });
    if (message) { onNotice(message, "error"); return; }
    setPublishing(true);
    const listKey = weeklyReportsKey(report.workspace_id, report.week_start, report.weekly_report_group_id);
    const detailKey = weeklyReportDetailKey(report.workspace_id, report.id);
    const previousList = queryClient.getQueryData<WeeklyReport[]>(listKey);
    const previousDetail = queryClient.getQueryData<WeeklyReport>(detailKey);
    const optimistic = {
      ...report,
      status: "published" as const,
      published_at: report.published_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    queryClient.setQueryData<WeeklyReport[]>(listKey, (items) =>
      items?.map((item) => item.id === report.id ? optimistic : item));
    queryClient.setQueryData(detailKey, optimistic);
    try {
      const saved = await saveWeeklyReport(supabase!, {
        id: report.id,
        workspaceId: report.workspace_id,
        weeklyReportGroupId: report.weekly_report_group_id,
        weekStart: report.week_start,
        okrProgressText: report.okr_progress_text ?? "",
        completedText: report.completed_text,
        nextPlanText: report.next_plan_text,
        reflectionText: report.reflection_text,
        visibility: report.visibility,
        userIds: report.user_acl_ids,
        groupIds: report.group_acl_ids,
        notificationGroupIds: report.notification_group_ids,
        publish: true,
      });
      const dispatchResult = await dispatchSavedReportNotifications(saved, report.notification_revision);
      const savedWithSummary = dispatchResult.report;
      queryClient.setQueryData<WeeklyReport[]>(listKey, (items = []) =>
        sortWeeklyReports([savedWithSummary, ...items.filter((item) => item.id !== saved.id)]));
      queryClient.setQueryData(detailKey, savedWithSummary);
      onNotice(dispatchResult.message, dispatchResult.tone);
    } catch (error) {
      queryClient.setQueryData(listKey, previousList);
      queryClient.setQueryData(detailKey, previousDetail);
      onNotice(error instanceof Error ? error.message : "发布周报失败", "error");
    } finally {
      setPublishing(false);
    }
  };
  const retryNotifications = async () => {
    if (readOnly || retrying || report.notification_revision < 1) return;
    setRetrying(true);
    try {
      const summary = await dispatchWeeklyReportNotifications({
        reportId: report.id,
        revision: report.notification_revision,
        retryFailed: true,
      });
      const next = { ...report, notification_summary: summary };
      queryClient.setQueryData(weeklyReportDetailKey(report.workspace_id, report.id), next);
      queryClient.setQueryData<WeeklyReport[]>(
        weeklyReportsKey(report.workspace_id, report.week_start, report.weekly_report_group_id),
        (items) => items?.map((item) => item.id === report.id ? next : item),
      );
      onNotice(
        summary.failed
          ? `已重试群通知，成功 ${summary.sent} 个，仍失败 ${summary.failed} 个`
          : `群通知已全部发送，共 ${summary.sent} 个群`,
        summary.failed ? "error" : "success",
      );
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "重试群通知失败", "error");
    } finally {
      setRetrying(false);
    }
  };
  return (
    <article className="weekly-report-page weekly-report-viewer">
      <header className="weekly-report-page-header">
        <button type="button" className="weekly-report-back" aria-label="返回周报列表" onClick={onBack}><ArrowLeft /></button>
        <div className="weekly-report-viewer-title">
          {member && <MemberAvatar member={member} className="weekly-report-viewer-avatar" />}
          <div><h1>{member ? memberDisplayName(member) : "团队成员"}的第 {meta.week} 周周报</h1><span>{meta.year} 年 · {meta.range}</span></div>
        </div>
        {isAuthor && <div className="weekly-report-page-actions"><button className="button secondary" disabled={readOnly} onClick={onEdit}>编辑</button>{report.status === "draft" && <button className="button primary" disabled={readOnly || publishing} onClick={() => void publish()}>发布</button>}<button className="button danger" disabled={readOnly || deleting} onClick={() => void remove()}><Trash2 />删除</button></div>}
      </header>
      {readOnly && !supabase ? null : readOnly && <p className="weekly-report-write-notice">当前周报为只读；填写需要在线且在人员配置名单中。</p>}
      <div className="weekly-report-view-meta"><span className={clsx("weekly-report-status", report.status)}>{report.status === "draft" ? "草稿" : "已发布"}</span><span>{visibilityLabel(report)}</span><span>更新于 {new Date(report.updated_at).toLocaleString("zh-CN")}</span></div>
      {report.okr_progress_text?.trim() && <WeeklyReportContent title="OKR 进展" value={report.okr_progress_text} className="weekly-report-okr-content" />}
      <WeeklyReportContent title="本周完成" value={report.completed_text} />
      <WeeklyReportContent title="下周计划" value={report.next_plan_text} />
      <WeeklyReportContent title="总结感想" value={report.reflection_text} />
      {isAuthor && report.status === "published" && report.notification_summary && (
        <WeeklyReportNotificationStatus
          summary={report.notification_summary}
          disabled={readOnly || retrying}
          onRetry={() => void retryNotifications()}
        />
      )}
    </article>
  );
}

export function WeeklyReportContent({ title, value, className }: { title: string; value: string; className?: string }) {
  const trimmed = value.trim();
  return (
    <section className={clsx("weekly-report-content", className)}>
      <h2>{title}</h2>
      {trimmed ? (
        <div className="weekly-report-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ children, href, title: linkTitle }) => (
                <a href={href} title={linkTitle} target="_blank" rel="noreferrer">{children}</a>
              ),
              table: ({ children }) => (
                <div className="weekly-report-table-scroll">
                  <table>{children}</table>
                </div>
              ),
            }}
          >
            {trimmed}
          </ReactMarkdown>
        </div>
      ) : <span>未填写</span>}
    </section>
  );
}

function WeeklyReportNotificationStatus({ summary, disabled, onRetry }: {
  summary: WeeklyReportNotificationSummary;
  disabled: boolean;
  onRetry: () => void;
}) {
  const retryable = summary.failed > 0 || summary.pending > 0;
  return (
    <section className="weekly-report-notification-status">
      <div>
        <h2><Bell />群通知</h2>
        <p>
          已发送 {summary.sent} 个
          {summary.failed > 0 && ` · 失败 ${summary.failed} 个`}
          {summary.pending > 0 && ` · 待确认 ${summary.pending} 个`}
        </p>
        {summary.failed_group_names.length > 0 && (
          <span>失败群：{summary.failed_group_names.join("、")}</span>
        )}
      </div>
      {retryable && (
        <button type="button" className="button secondary" disabled={disabled} onClick={onRetry}>
          {disabled ? "处理中…" : "重试失败通知"}
        </button>
      )}
    </section>
  );
}

function WeeklyReportEditor({
  group, groupError, navigationGuard,
  report,
  weekStart,
  workspaceId,
  currentUserId,
  members,
  groups,
  labels,
  tasks,
  online,
  demoMode,
  onBack,
  onNavigate,
  onNotice,
}: {
  group: WeeklyReportGroup;
  groupError: boolean;
  navigationGuard: RefObject<WeeklyReportNavigationGuard | null>;
  report: WeeklyReport | null;
  weekStart: string;
  workspaceId: string;
  currentUserId: string;
  members: Member[];
  groups: UserGroup[];
  labels: Label[];
  tasks: Task[];
  online: boolean;
  demoMode: boolean;
  onBack: () => void;
  onNavigate: (route: WeeklyReportsRoute, replace?: boolean) => void;
  onNotice: NoticeHandler;
}) {
  const canWrite = group.participant_ids.includes(currentUserId) && !groupError;
  const queryClient = useQueryClient();
  const notificationGroupsQuery = useQuery({
    queryKey: weeklyReportNotificationGroupsKey(workspaceId),
    queryFn: () => loadWeeklyReportNotificationGroups(supabase!, workspaceId),
    enabled: Boolean(supabase) && !demoMode,
  });
  const [okrProgressText, setOkrProgressText] = useState(report?.okr_progress_text ?? "");
  const [completedText, setCompletedText] = useState(report?.completed_text ?? "");
  const [nextPlanText, setNextPlanText] = useState(report?.next_plan_text ?? "");
  const [reflectionText, setReflectionText] = useState(report?.reflection_text ?? "");
  const visibility: WeeklyReportVisibility = "workspace";
  const userIds: string[] = [];
  const groupIds: string[] = [];
  const [notificationGroupIds, setNotificationGroupIds] = useState(
    report?.notification_group_ids ?? [],
  );
  const [notificationDialogOpen, setNotificationDialogOpen] = useState(false);
  const [pickerSection, setPickerSection] = useState<WeeklyReportSection | null>(null);
  const [pickerFilters, setPickerFilters] = useState<Record<WeeklyReportSection, WeeklyReportTaskFilters>>({
    completed: defaultWeeklyReportTaskFilters("completed"),
    next_plan: defaultWeeklyReportTaskFilters("next_plan"),
  });
  const [pickerAnchor, setPickerAnchor] = useState<{ left: number; top: number }>();
  const [busy, setBusy] = useState(false);
  const meta = weeklyReportWeekMeta(weekStart);
  const readOnly = !online || demoMode || !supabase || !canWrite;
  const notificationGroups = notificationGroupsQuery.data ?? [];

  const createNotificationGroup = async (input: {
    name: string;
    webhook: string;
    signingSecret: string;
  }) => {
    const created = await createWeeklyReportNotificationGroup({ workspaceId, ...input });
    queryClient.setQueryData<WeeklyReportNotificationGroup[]>(
      weeklyReportNotificationGroupsKey(workspaceId),
      (groups = []) => [...groups.filter((group) => group.id !== created.id), created],
    );
    setNotificationGroupIds((current) => current.includes(created.id)
      ? current
      : [...current, created.id]);
    onNotice("通知群已创建并选中");
  };

  const removeNotificationGroup = async (group: WeeklyReportNotificationGroup) => {
    if (readOnly) return;
    if (!window.confirm(`确定删除通知群“${group.name}”吗？该群属于整个团队，删除后所有成员都无法再使用。`)) return;
    const key = weeklyReportNotificationGroupsKey(workspaceId);
    const previous = queryClient.getQueryData<WeeklyReportNotificationGroup[]>(key);
    const previousSelected = notificationGroupIds;
    queryClient.setQueryData<WeeklyReportNotificationGroup[]>(key, (groups) =>
      groups?.filter((item) => item.id !== group.id));
    setNotificationGroupIds((current) => current.filter((id) => id !== group.id));
    try {
      await deleteWeeklyReportNotificationGroup(group.id);
      onNotice("通知群已删除");
    } catch (error) {
      queryClient.setQueryData(key, previous);
      setNotificationGroupIds(previousSelected);
      onNotice(error instanceof Error ? error.message : "删除通知群失败", "error");
    }
  };

  const submit = async (publish: boolean, stay = false): Promise<boolean> => {
    if (readOnly) {
      onNotice(demoMode ? "产品演示中的周报为只读示例" : !online ? "离线时周报仅可查看" : "仅本组应填人员可以填写周报", "error");
      return false;
    }
    const willBePublished = publish || report?.status === "published";
    if (willBePublished) {
      const message = weeklyReportPublishError({ okrProgressText, completedText, nextPlanText, reflectionText, visibility, userIds, groupIds });
      if (message) { onNotice(message, "error"); return false; }
    }
    setBusy(true);
    const listKey = weeklyReportsKey(workspaceId, weekStart, group.id);
    const detailKey = report ? weeklyReportDetailKey(workspaceId, report.id) : null;
    const previousList = queryClient.getQueryData<WeeklyReport[]>(listKey);
    const previousDetail = detailKey ? queryClient.getQueryData<WeeklyReport>(detailKey) : undefined;
    if (report) {
      const optimistic: WeeklyReport = {
        ...report, okr_progress_text: okrProgressText, completed_text: completedText, next_plan_text: nextPlanText,
        reflection_text: reflectionText, visibility,
        user_acl_ids: [],
        group_acl_ids: [],
        notification_group_ids: notificationGroupIds,
        status: willBePublished ? "published" : "draft",
        published_at: willBePublished ? report.published_at ?? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData(listKey, (items: WeeklyReport[] | undefined) =>
        items?.map((item) => item.id === report.id ? optimistic : item));
      queryClient.setQueryData(detailKey!, optimistic);
    }
    try {
      const saved = await saveWeeklyReport(supabase!, {
        id: report?.id,
        workspaceId,
        weeklyReportGroupId: group.id,
        weekStart,
        okrProgressText,
        completedText,
        nextPlanText,
        reflectionText,
        visibility,
        userIds,
        groupIds,
        notificationGroupIds,
        publish,
      });
      const dispatchResult = await dispatchSavedReportNotifications(
        saved,
        report?.notification_revision ?? 0,
      );
      const savedWithSummary = dispatchResult.report;
      queryClient.setQueryData<WeeklyReport[]>(listKey, (items = []) =>
        sortWeeklyReports([savedWithSummary, ...items.filter((item) => item.id !== saved.id)]));
      queryClient.setQueryData(weeklyReportDetailKey(workspaceId, saved.id), savedWithSummary);
      onNotice(
        saved.status === "draft" ? "周报草稿已保存" : dispatchResult.message,
        saved.status === "draft" ? "success" : dispatchResult.tone,
      );
      if (!stay) onNavigate({ workspaceId, kind: "weekly_reports", page: "view", reportId: saved.id }, true);
      return true;
    } catch (error) {
      queryClient.setQueryData(listKey, previousList);
      if (detailKey) queryClient.setQueryData(detailKey, previousDetail);
      onNotice(error instanceof Error ? error.message : "保存周报失败", "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const dirty = okrProgressText !== (report?.okr_progress_text ?? "") || completedText !== (report?.completed_text ?? "")
    || nextPlanText !== (report?.next_plan_text ?? "") || reflectionText !== (report?.reflection_text ?? "")
    || JSON.stringify(notificationGroupIds) !== JSON.stringify(report?.notification_group_ids ?? []);
  useEffect(() => {
    navigationGuard.current = { dirty, busy, save: () => submit(false, true) };
    return () => { navigationGuard.current = null; };
  });
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const openPicker = (section: WeeklyReportSection, button: HTMLButtonElement) => {
    const bounds = button.getBoundingClientRect();
    setPickerAnchor({ left: bounds.left, top: bounds.bottom + 8 });
    setPickerSection(section);
  };
  const pickerMatches = pickerSection
    ? filterWeeklyReportPickerTasks(tasks, {
        section: pickerSection,
        weekStart,
        time: pickerFilters[pickerSection].time,
        assignee: pickerFilters[pickerSection].assignee,
        currentUserId,
      })
    : [];
  const pickerMatchIds = new Set(pickerMatches.map((task) => task.id));
  const pickerContextParentIds = new Set(pickerMatches.flatMap((task) => task.parent_task_id ? [task.parent_task_id] : []));
  const pickerTasks = tasks.filter((task) => pickerMatchIds.has(task.id) || pickerContextParentIds.has(task.id));
  const pickerExcludedKeys = tasks
    .filter((task) => pickerContextParentIds.has(task.id) && !pickerMatchIds.has(task.id))
    .map((task) => task.id);
  return (
    <div className="weekly-report-page weekly-report-editor">
      <header className="weekly-report-page-header">
        <button type="button" className="weekly-report-back" aria-label="返回" onClick={onBack}><ArrowLeft /></button>
        <div><h1>{report ? "编辑周报" : "创建周报"}</h1><span>{meta.year} 年第 {meta.week} 周 · {meta.range}</span></div>
      </header>
      {readOnly && <p className="weekly-report-write-notice">{!online ? "离线时周报仅可查看" : demoMode ? "产品演示中的周报为只读示例" : groupError ? "周报填写权限暂不可用，请稍后重试" : "你未被配置为周报填写人员，请联系团队空间管理员。"}</p>}
      {!report && <label className="weekly-report-week-choice">周次<select value={weekStart} onChange={(event) => onNavigate({ workspaceId, kind: "weekly_reports", page: "new", weekStart: event.target.value }, true)}><option value={weeklyReportWeekStart()}>本周 · {weeklyReportWeekMeta(weeklyReportWeekStart()).range}</option><option value={shiftWeeklyReportWeek(weeklyReportWeekStart(), -1)}>上一周 · {weeklyReportWeekMeta(shiftWeeklyReportWeek(weeklyReportWeekStart(), -1)).range}</option></select></label>}
      <WeeklyReportOkrSection
        workspaceId={workspaceId} currentUserId={currentUserId} weekStart={weekStart}
        members={members} readOnly={readOnly} demoMode={demoMode}
        value={okrProgressText} onChange={setOkrProgressText}
      />
      <WeeklyReportEditorSection
        title="本周完成"
        value={completedText}
        placeholder="记录本周完成的工作"
        readOnly={readOnly}
        onChange={setCompletedText}
        onPick={(button) => openPicker("completed", button)}
      />
      <WeeklyReportEditorSection
        title="下周计划"
        value={nextPlanText}
        placeholder="规划下周准备完成的工作"
        readOnly={readOnly}
        onChange={setNextPlanText}
        onPick={(button) => openPicker("next_plan", button)}
      />
      <section className="weekly-report-editor-section"><div className="weekly-report-editor-section-title"><h2>总结感想</h2></div><textarea aria-label="总结感想" placeholder="记录经验、问题与感想" value={reflectionText} readOnly={readOnly} onChange={(event) => setReflectionText(event.target.value)} /></section>
      <section className="weekly-report-visibility"><h2>可见范围</h2><p className="weekly-report-config-hint">继承周报组可见范围 · {group.visibility === "workspace" ? "团队空间全员可见" : "应填人员、指定用户和用户组可见"}</p></section>
      <WeeklyReportNotificationPicker
        groups={notificationGroups}
        selected={notificationGroupIds}
        disabled={readOnly}
        loading={notificationGroupsQuery.isLoading}
        error={notificationGroupsQuery.isError}
        onChange={setNotificationGroupIds}
        onCreate={() => setNotificationDialogOpen(true)}
        onDelete={(group) => void removeNotificationGroup(group)}
      />
      <footer className="weekly-report-editor-footer"><button type="button" className="button secondary" onClick={onBack}>取消</button><button type="button" className="button secondary" disabled={readOnly || busy} onClick={() => void submit(false)}>保存</button>{report?.status !== "published" && <button type="button" className="button primary" disabled={readOnly || busy} onClick={() => void submit(true)}>发布</button>}</footer>
      <FocusTaskPicker
        open={pickerSection !== null && !readOnly}
        mode="multi"
        title={pickerSection === "completed" ? "选择本周完成待办" : "选择下周计划待办"}
        tasks={pickerTasks}
        excludeKeys={pickerExcludedKeys}
        selectedTaskId={null}
        selectedTaskIds={[]}
        filters={pickerSection ? [
          {
            id: "time",
            label: "时间",
            value: pickerFilters[pickerSection].time,
            options: [
              { value: "through_this_week", label: "截止本周" },
              { value: "through_next_week", label: "截止下周" },
              { value: "all", label: "全部" },
            ],
            onChange: (value) => setPickerFilters((current) => ({
              ...current,
              [pickerSection]: { ...current[pickerSection], time: value as WeeklyReportTaskTimeFilter },
            })),
          },
          {
            id: "assignee",
            label: "指派人",
            value: pickerFilters[pickerSection].assignee,
            options: [
              { value: "me", label: "指派我" },
              { value: "unassigned", label: "无指派" },
              { value: "all", label: "全部" },
            ],
            onChange: (value) => setPickerFilters((current) => ({
              ...current,
              [pickerSection]: { ...current[pickerSection], assignee: value as WeeklyReportTaskAssigneeFilter },
            })),
          },
        ] : []}
        onOpenChange={(open) => { if (!open) setPickerSection(null); }}
        onSelect={() => undefined}
        onConfirmTaskIds={(ids) => {
          if (!pickerSection || readOnly) return;
          const selected = tasks.filter((task) => ids.includes(task.id));
          const appUrl = currentAppUrl();
          if (pickerSection === "completed") setCompletedText((current) => appendWeeklyReportTaskLines(current, selected, pickerSection, labels, tasks, appUrl));
          else setNextPlanText((current) => appendWeeklyReportTaskLines(current, selected, pickerSection, labels, tasks, appUrl));
        }}
        anchorPoint={pickerAnchor}
      />
      <WeeklyReportNotificationGroupDialog
        open={notificationDialogOpen}
        disabled={readOnly}
        onOpenChange={setNotificationDialogOpen}
        onCreate={createNotificationGroup}
      />
    </div>
  );
}

function WeeklyReportEditorSection({ title, value, placeholder, readOnly, onChange, onPick }: {
  title: string;
  value: string;
  placeholder: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onPick: (button: HTMLButtonElement) => void;
}) {
  return <section className="weekly-report-editor-section"><div className="weekly-report-editor-section-title"><h2>{title}</h2><div><button type="button" disabled={readOnly} onClick={(event) => onPick(event.currentTarget)}><Plus />从待办选择</button></div></div><textarea aria-label={title} placeholder={placeholder} value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} /></section>;
}

function WeeklyReportNotificationPicker({
  groups,
  selected,
  disabled,
  loading,
  error,
  onChange,
  onCreate,
  onDelete,
}: {
  groups: WeeklyReportNotificationGroup[];
  selected: string[];
  disabled: boolean;
  loading: boolean;
  error: boolean;
  onChange: (ids: string[]) => void;
  onCreate: () => void;
  onDelete: (group: WeeklyReportNotificationGroup) => void;
}) {
  const pickerRef = useRef<HTMLDetailsElement>(null);
  const selectedGroups = groups.filter((group) => selected.includes(group.id));

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      const picker = pickerRef.current;
      if (!picker?.open) return;
      if (event.target instanceof Node && picker.contains(event.target)) return;
      picker.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, []);

  return (
    <section className="weekly-report-notifications">
      <h2><Bell />群通知</h2>
      <p>通知群属于当前团队，所有成员均可选用。群消息会展示周报全文，请确认群成员范围。</p>
      {selectedGroups.length > 0 && (
        <div className="weekly-report-notification-chips" aria-label="已选通知群">
          {selectedGroups.map((group) => (
            <span key={group.id}>
              {group.name}
              <button
                type="button"
                aria-label={`取消选择${group.name}`}
                disabled={disabled}
                onClick={() => onChange(selected.filter((id) => id !== group.id))}
              ><X /></button>
            </span>
          ))}
        </div>
      )}
      <details ref={pickerRef} className="weekly-report-notification-picker">
        <summary
          aria-disabled={disabled}
          onClick={(event) => { if (disabled) event.preventDefault(); }}
        >
          <span>{selectedGroups.length ? `已选 ${selectedGroups.length} 个通知群` : "选择通知群（可多选）"}</span>
          <ChevronDown />
        </summary>
        <div className="weekly-report-notification-menu">
          <button type="button" className="create" disabled={disabled} onClick={onCreate}>
            <Plus />创建通知群
          </button>
          {loading ? <p>正在读取通知群…</p>
            : error ? <p role="alert">通知群加载失败，请稍后重试</p>
              : groups.length === 0 ? <p>团队还没有通知群</p>
                : groups.map((group) => (
                  <div className="weekly-report-notification-option" key={group.id}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={selected.includes(group.id)}
                        onChange={(event) => onChange(event.target.checked
                          ? [...selected, group.id]
                          : selected.filter((id) => id !== group.id))}
                      />
                      <span><strong>{group.name}</strong><small>钉钉群</small></span>
                    </label>
                    <button
                      type="button"
                      className="delete"
                      aria-label={`删除通知群${group.name}`}
                      title="删除通知群"
                      disabled={disabled}
                      onClick={() => onDelete(group)}
                    ><Trash2 /></button>
                  </div>
                ))}
        </div>
      </details>
      <span className="weekly-report-notification-hint">
        {selectedGroups.length ? "发布或更新周报后，将向所选群发送通知。" : "未选择通知群，不会发送群通知。"}
      </span>
    </section>
  );
}


function WeeklyReportEmpty({ icon, text }: { icon: "loading" | "error" | "empty"; text: string }) {
  return <div className={clsx("weekly-report-empty", icon)}><FileText /><p>{text}</p></div>;
}

function visibilityLabel(_report: WeeklyReport) {
  return "继承周报组可见范围";
}

function formatRelativeTime(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return new Date(value).toLocaleDateString("zh-CN");
}

function createDemoWeeklyReports(workspaceId: string, currentUserId: string, members: Member[], weekStart: string, groupId: string): WeeklyReport[] {
  if (weekStart !== weeklyReportWeekStart()) return [];
  const timestamp = new Date().toISOString();
  const ordered = [...members].sort((left, right) =>
    Number(right.user_id === currentUserId) - Number(left.user_id === currentUserId));
  return ordered.slice(0, 3).map((member, index) => ({
    id: `demo-weekly-report-${index + 1}`,
    weekly_report_group_id: groupId,
    workspace_id: workspaceId,
    author_id: member.user_id,
    week_start: weekStart,
    okr_progress_text: "",
    completed_text: "- 完成了 [产品体验优化](https://app.anttodo.com/workspaces/workspace-team/tasks/demo-product)\n- 完成 `本周需求验收`",
    next_plan_text: "- 计划完成 `周报模块联调`",
    reflection_text: "本周协作顺畅，下周继续收敛细节。",
    status: member.user_id === currentUserId ? "draft" : "published",
    visibility: "workspace",
    user_acl_ids: [],
    group_acl_ids: [],
    notification_group_ids: [],
    notification_revision: 0,
    notification_summary: null,
    published_at: member.user_id === currentUserId ? null : timestamp,
    created_at: timestamp,
    updated_at: new Date(Date.now() - index * 3_600_000).toISOString(),
  }));
}

async function dispatchSavedReportNotifications(
  saved: WeeklyReport,
  previousRevision: number,
) {
  if (saved.status !== "published"
    || saved.notification_revision <= previousRevision
    || saved.notification_group_ids.length === 0) {
    return { report: saved, message: "周报已保存", tone: "success" as const };
  }
  try {
    const summary = await dispatchWeeklyReportNotifications({
      reportId: saved.id,
      revision: saved.notification_revision,
    });
    const report = { ...saved, notification_summary: summary };
    if (summary.failed > 0 || summary.pending > 0) {
      return {
        report,
        message: `周报已保存；群通知成功 ${summary.sent} 个，失败或待确认 ${summary.failed + summary.pending} 个`,
        tone: "error" as const,
      };
    }
    return {
      report,
      message: `周报已保存并通知 ${summary.sent} 个群`,
      tone: "success" as const,
    };
  } catch {
    return {
      report: {
        ...saved,
        notification_summary: {
          revision: saved.notification_revision,
          total: saved.notification_group_ids.length,
          sent: 0,
          failed: 0,
          pending: saved.notification_group_ids.length,
          failed_group_names: [],
        },
      },
      message: "周报已保存，群通知状态暂无法确认，可在详情页重试",
      tone: "error" as const,
    };
  }
}
