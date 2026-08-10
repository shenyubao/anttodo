import { format, isSameDay, addMonths, startOfMonth } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  CalendarDays,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ExternalLink,
  LogOut,
  Plus,
  Settings,
  SquareCheck,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  createTask,
  loadDateTimePreferences,
  loadWorkspaceBundle,
  loadWorkspaces,
  saveTaskListPreference,
  saveTaskSchedule,
} from "./lib/api";
import { appRoutePath } from "./lib/appRoute";
import { CALENDAR_UNASSIGNED_ID } from "./lib/calendarVisibility";
import {
  DEFAULT_DATE_TIME_PREFERENCES,
  formatDueWithPreferences,
} from "./lib/dateTimePreferences";
import { supabase } from "./lib/supabase";
import {
  applyTaskListFilters,
  filterTasksForView,
  groupTasks,
  isCompletedTask,
  resolveTaskListPreference,
  sortTasks,
  taskListKey,
} from "./lib/taskList";
import {
  clearPendingWorkspace,
  readPendingWorkspace,
} from "./lib/workspaceInvites";
import { MiniCalendar } from "./MiniCalendar";
import { QuickAddForm } from "./QuickAddForm";
import { TaskFilterMenu } from "./TaskFilterMenu";
import { TaskViewMenu } from "./TaskViewMenu";
import type {
  DateTimePreferences,
  Task,
  TaskListPreference,
  WorkspaceBundle,
} from "./types";

type TrayTab = "inbox" | "calendar";

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function useMinuteNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, 60_050 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);
  return now;
}

function TrayTaskRow({
  task,
  dateTimePreferences,
  onToggle,
  onOpen,
  online,
}: {
  task: Task;
  dateTimePreferences: DateTimePreferences;
  onToggle: () => void;
  onOpen: () => void;
  online: boolean;
}) {
  const completed = isCompletedTask(task);
  const dueLabel = task.due_at
    ? formatDueWithPreferences(
      {
        due_at: task.due_at,
        due_start_at: task.due_start_at,
        due_is_all_day: task.due_is_all_day,
        due_timezone: task.due_timezone,
      },
      dateTimePreferences,
    )
    : null;

  return (
    <div className={clsx("tray-task-row", completed && "completed")}>
      <button
        type="button"
        className="tray-task-check"
        aria-label={completed ? "标记为未完成" : "标记为已完成"}
        disabled={!online || task.kind === "note"}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        {completed ? <SquareCheck /> : <Circle />}
      </button>
      <button type="button" className="tray-task-body" onClick={onOpen}>
        <span className="tray-task-title">{task.title || "未命名任务"}</span>
        <span className="tray-task-meta">
          {dueLabel && <em>{dueLabel}</em>}
          {task.description?.trim() && <em className="tray-task-note">备注</em>}
        </span>
      </button>
    </div>
  );
}

function TraySettingsMenu({
  open,
  onClose,
  onOpenMain,
  onOpenSettings,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  onOpenMain: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, onClose]);

  useEffect(() => {
    window.anttodoDesktop?.tray.setIgnoreBlur(open);
    return () => window.anttodoDesktop?.tray.setIgnoreBlur(false);
  }, [open]);

  if (!open) return null;

  return (
    <div className="tray-settings-menu" role="menu" ref={menuRef}>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onOpenMain();
          onClose();
        }}
      >
        <ExternalLink size={16} />
        <span>打开主窗口</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onOpenSettings();
          onClose();
        }}
      >
        <Settings size={16} />
        <span>设置</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onSignOut();
          onClose();
        }}
      >
        <LogOut size={16} />
        <span>退出登录</span>
      </button>
    </div>
  );
}

export function TrayApp({
  userId,
}: {
  userId: string;
}) {
  const client = supabase!;
  const queryClient = useQueryClient();
  const online = useOnline();
  const now = useMinuteNow();
  const [tab, setTab] = useState<TrayTab>("inbox");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsActive, setSettingsActive] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  const workspacesQuery = useQuery({
    queryKey: ["workspaces", userId],
    queryFn: () => loadWorkspaces(client, userId),
  });

  useEffect(() => {
    if (!workspacesQuery.data?.length) return;
    const pendingWorkspaceId = readPendingWorkspace();
    const pending = workspacesQuery.data.find((item) => item.id === pendingWorkspaceId);
    const preferred = pending ?? workspacesQuery.data[0];
    if (!workspaceId) {
      setWorkspaceId(preferred.id);
      if (pending) clearPendingWorkspace();
    }
  }, [workspaceId, workspacesQuery.data]);

  const bundleQuery = useQuery({
    queryKey: ["workspace-bundle", workspaceId],
    queryFn: () => loadWorkspaceBundle(client, workspaceId!),
    enabled: Boolean(workspaceId),
  });
  const dateTimePreferencesQuery = useQuery({
    queryKey: ["date-time-preferences", userId],
    queryFn: () => loadDateTimePreferences(client, userId),
  });

  const bundle = bundleQuery.data;
  const dateTimePreferences = dateTimePreferencesQuery.data ?? DEFAULT_DATE_TIME_PREFERENCES;
  const listKey = taskListKey("inbox", null);
  const preference = resolveTaskListPreference(
    bundle?.taskListPreferences ?? [],
    listKey,
    bundle?.labels ?? [],
  );

  const inboxTasks = useMemo(() => {
    if (!bundle) return [];
    return applyTaskListFilters({
      tasks: filterTasksForView({
        tasks: bundle.tasks,
        labels: bundle.labels,
        smartView: "inbox",
        selectedLabelId: null,
      }),
      filterAssignee: preference.filter_assignee,
      filterWatching: preference.filter_watching,
      filterCreator: preference.filter_creator,
      filterDue: preference.filter_due,
      currentUserId: userId,
      now,
      weekStartsOn: dateTimePreferences.weekStartsOn,
    });
  }, [
    bundle,
    now,
    preference.filter_assignee,
    preference.filter_creator,
    preference.filter_due,
    preference.filter_watching,
    dateTimePreferences.weekStartsOn,
    userId,
  ]);

  const inboxGroups = useMemo(() => {
    if (!bundle) return [];
    const sections = bundle.taskSections.filter((section) => section.list_key === listKey);
    const placements = bundle.taskPlacements.filter(
      (placement) => placement.list_key === listKey,
    );
    return groupTasks({
      tasks: inboxTasks,
      grouping: preference.grouping,
      sort: preference.sort,
      direction: preference.direction,
      labels: bundle.labels,
      members: bundle.members,
      sections,
      placements,
      now,
      preferences: dateTimePreferences,
      selectedLabelId: null,
      userLabelOrder: bundle.userLabelOrder,
    });
  }, [bundle, dateTimePreferences, inboxTasks, listKey, now, preference]);

  const completedInboxTasks = useMemo(() => {
    if (!bundle) return [];
    return sortTasks(
      inboxTasks.filter(isCompletedTask),
      preference.sort,
      preference.direction,
      bundle.labels,
      bundle.members,
      bundle.taskPlacements.filter((placement) => placement.list_key === listKey),
      bundle.userLabelOrder,
    );
  }, [bundle, inboxTasks, listKey, preference.direction, preference.sort]);

  const dayTasks = useMemo(() => {
    if (!bundle) return [];
    return bundle.tasks
      .filter((task) => !task.deleted_at
        && task.due_at
        && isSameDay(new Date(task.due_at), selectedDate))
      .sort((a, b) => {
        const aDone = isCompletedTask(a) ? 1 : 0;
        const bDone = isCompletedTask(b) ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        return (a.due_at ?? "").localeCompare(b.due_at ?? "");
      });
  }, [bundle, selectedDate]);

  const visibleCalendarIds = useMemo(
    () => new Set(bundle?.labels.map((label) => label.id) ?? []),
    [bundle?.labels],
  );
  const visibleAssigneeIds = useMemo(
    () => new Set([
      ...(bundle?.members.map((member) => member.user_id) ?? []),
      CALENDAR_UNASSIGNED_ID,
    ]),
    [bundle?.members],
  );

  async function savePreference(
    patch: Partial<Pick<
      TaskListPreference,
      | "grouping"
      | "sort"
      | "direction"
      | "filter_assignee"
      | "filter_watching"
      | "filter_creator"
      | "filter_due"
    >>,
  ) {
    if (!workspaceId || !bundle) return;
    const next: TaskListPreference = {
      ...preference,
      ...patch,
      user_id: userId,
      workspace_id: workspaceId,
      list_key: listKey,
    };
    queryClient.setQueryData<WorkspaceBundle>(
      ["workspace-bundle", workspaceId],
      (current) => current
        ? {
            ...current,
            taskListPreferences: [
              ...current.taskListPreferences.filter(
                (item) => item.list_key !== listKey,
              ),
              next,
            ],
          }
        : current,
    );
    await saveTaskListPreference(client, next);
  }

  async function toggleTask(task: Task) {
    if (!workspaceId || !online || task.kind === "note") return;
    const nextStatus = task.status === "completed" ? "open" : "completed";
    const patch = {
      status: nextStatus as Task["status"],
      completed_at: nextStatus === "completed" ? new Date().toISOString() : null,
    };
    const queryKey = ["workspace-bundle", workspaceId];
    const previous = queryClient.getQueryData<WorkspaceBundle>(queryKey);
    queryClient.setQueryData<WorkspaceBundle>(queryKey, (current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((item) =>
              item.id === task.id
                ? { ...item, ...patch, updated_at: new Date().toISOString() }
                : item),
          }
        : current);
    const { error } = await client.from("tasks").update(patch).eq("id", task.id);
    if (error) {
      queryClient.setQueryData(queryKey, previous);
    }
  }

  async function submitQuickTask(payload: {
    title: string;
    due: {
      due_at: string | null;
      due_start_at: string | null;
      due_is_all_day: boolean;
      due_timezone: string;
    } | null;
    assigneeId: string | null;
    labelIds: string[];
  }) {
    if (!workspaceId || !online || busy) return;
    const title = payload.title.trim();
    if (!title) return;
    setBusy(true);
    try {
      const created = await createTask(client, {
        workspaceId,
        title,
        labelIds: payload.labelIds,
        dueAt: payload.due?.due_at ?? null,
        dueTimezone: payload.due?.due_timezone ?? null,
        assigneeId: payload.assigneeId,
        kind: "todo",
        priority: "low",
      });
      const createdId = typeof created === "object" && created && "id" in created
        ? String((created as { id: string }).id)
        : typeof created === "string"
        ? created
        : null;
      if (
        createdId
        && payload.due
        && (payload.due.due_is_all_day || payload.due.due_start_at)
      ) {
        await saveTaskSchedule(
          client,
          createdId,
          {
            due_at: payload.due.due_at,
            due_start_at: payload.due.due_start_at,
            due_is_all_day: payload.due.due_is_all_day,
            due_timezone: payload.due.due_timezone,
          },
          { reminders: [], recurrence: null, persistent: false },
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["workspace-bundle", workspaceId] });
    } finally {
      setBusy(false);
    }
  }

  function openTask(taskId: string) {
    if (!workspaceId) return;
    window.anttodoDesktop?.tray.openTask({ workspaceId, taskId });
  }

  function selectTab(next: TrayTab) {
    setSettingsOpen(false);
    setSettingsActive(false);
    setTab(next);
  }

  function toggleSettings(event?: MouseEvent<HTMLButtonElement>) {
    event?.preventDefault();
    setSettingsOpen((value) => !value);
    setSettingsActive(true);
  }

  if (workspacesQuery.isLoading || !workspaceId || bundleQuery.isLoading) {
    return (
      <div className="tray-shell">
        <div className="tray-loading">正在加载…</div>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="tray-shell">
        <div className="tray-loading">无法加载任务</div>
      </div>
    );
  }

  return (
    <div className="tray-shell">
      <div className="tray-body">
        {tab === "inbox" && (
          <section className="tray-panel tray-inbox" aria-label="收集箱">
            <header className="tray-header">
              <h1>收集箱</h1>
              <div className="header-actions">
                <TaskViewMenu
                  preference={preference}
                  online={online}
                  onChange={savePreference}
                />
                <TaskFilterMenu
                  preference={preference}
                  online={online}
                  onChange={savePreference}
                />
              </div>
            </header>
            <QuickAddForm
              online={online}
              canManage
              busy={busy}
              kind="todo"
              placeholder={online
                ? "添加任务至“收集箱”，回车即可创建"
                : "离线状态下不可新增任务"}
              now={now}
              dateTimePreferences={dateTimePreferences}
              leadingIcon={<Plus />}
              settings={null}
              members={bundle.members}
              labels={bundle.labels}
              labelPermissionLevels={bundle.labelPermissionLevels}
              userLabelOrder={bundle.userLabelOrder}
              currentUserId={userId}
              defaultLabelIds={[]}
              defaultAssigneeId={null}
              onSubmit={submitQuickTask}
            />
            <div className="tray-task-scroll">
              {inboxGroups.map((group) => (
                <div key={group.id} className="tray-task-group">
                  {preference.grouping !== "none" && group.title && (
                    <div className="tray-group-title">{group.title}</div>
                  )}
                  {group.tasks.map((task) => (
                    <TrayTaskRow
                      key={task.id}
                      task={task}
                      dateTimePreferences={dateTimePreferences}
                      online={online}
                      onToggle={() => void toggleTask(task)}
                      onOpen={() => openTask(task.id)}
                    />
                  ))}
                </div>
              ))}
              {completedInboxTasks.length > 0 && (
                <div className="tray-task-group">
                  <div className="tray-group-title">已完成</div>
                  {completedInboxTasks.map((task) => (
                    <TrayTaskRow
                      key={task.id}
                      task={task}
                      dateTimePreferences={dateTimePreferences}
                      online={online}
                      onToggle={() => void toggleTask(task)}
                      onOpen={() => openTask(task.id)}
                    />
                  ))}
                </div>
              )}
              {inboxGroups.every((group) => group.tasks.length === 0)
                && completedInboxTasks.length === 0 && (
                <div className="tray-empty">
                  <p>收集箱是空的</p>
                  <span>用上方输入框快速添加待办</span>
                </div>
              )}
            </div>
          </section>
        )}

        {tab === "calendar" && (
          <section className="tray-panel tray-calendar" aria-label="日历">
            <header className="tray-header">
              <h1>{format(selectedDate, "yyyy年 M月", { locale: zhCN })}</h1>
              <div className="tray-calendar-nav">
                <button
                  type="button"
                  aria-label="上一个月"
                  onClick={() => setSelectedDate((current) => addMonths(startOfMonth(current), -1))}
                >
                  <ChevronLeft />
                </button>
                <button
                  type="button"
                  className="tray-calendar-today"
                  aria-label="回到今天"
                  onClick={() => setSelectedDate(new Date())}
                >
                  <span />
                </button>
                <button
                  type="button"
                  aria-label="下一个月"
                  onClick={() => setSelectedDate((current) => addMonths(startOfMonth(current), 1))}
                >
                  <ChevronRight />
                </button>
              </div>
            </header>
            <MiniCalendar
              bundle={bundle}
              visibleCalendarIds={visibleCalendarIds}
              visibleAssigneeIds={visibleAssigneeIds}
              visibleDate={selectedDate}
              dateTimePreferences={dateTimePreferences}
              onSelectDate={setSelectedDate}
              showHeader={false}
            />
            <div className="tray-task-scroll">
              {dayTasks.length === 0 ? (
                <div className="tray-empty tray-calendar-empty">
                  <CalendarDays size={40} strokeWidth={1.5} />
                  <p>你这一天没有任务</p>
                  <span>放松一下吧</span>
                </div>
              ) : (
                dayTasks.map((task) => (
                  <TrayTaskRow
                    key={task.id}
                    task={task}
                    dateTimePreferences={dateTimePreferences}
                    online={online}
                    onToggle={() => void toggleTask(task)}
                    onOpen={() => openTask(task.id)}
                  />
                ))
              )}
            </div>
          </section>
        )}
      </div>

      <nav className="tray-tabbar" aria-label="迷你导航">
        <TraySettingsMenu
          open={settingsOpen}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsActive(false);
          }}
          onOpenMain={() => window.anttodoDesktop?.tray.showMainWindow()}
          onOpenSettings={() => window.anttodoDesktop?.tray.openSettings()}
          onSignOut={() => {
            void client.auth.signOut();
            window.anttodoDesktop?.tray.hide();
          }}
        />
        <button
          type="button"
          className={clsx(tab === "inbox" && !settingsActive && "active")}
          aria-label="收集箱"
          aria-current={tab === "inbox" && !settingsActive ? "page" : undefined}
          onClick={() => selectTab("inbox")}
        >
          <CheckSquare2 />
        </button>
        <button
          type="button"
          className={clsx(tab === "calendar" && !settingsActive && "active")}
          aria-label="日历"
          aria-current={tab === "calendar" && !settingsActive ? "page" : undefined}
          onClick={() => selectTab("calendar")}
        >
          <CalendarDays />
        </button>
        <button
          type="button"
          className={clsx(settingsActive && "active")}
          aria-label="设置"
          aria-expanded={settingsOpen}
          onClick={(event) => toggleSettings(event)}
        >
          <Settings />
        </button>
      </nav>
    </div>
  );
}

// Keep route helper available for deep-link tests without importing App.
export function trayTaskRoute(workspaceId: string, taskId: string) {
  return appRoutePath({
    workspaceId,
    kind: "task",
    taskId,
    itemKind: "task",
  });
}
