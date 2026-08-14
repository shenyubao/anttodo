import FullCalendar, {
  type CalendarRef,
  type DatesSetInfo,
  type EventDragStartInfo,
  type EventDragStopInfo,
  type EventDropInfo,
  type EventReceiveInfo,
  type EventInput,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin, { Draggable } from "@fullcalendar/react/interaction";
import listPlugin from "@fullcalendar/react/list";
import multiMonthPlugin from "@fullcalendar/react/multimonth";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import zhCnLocale from "@fullcalendar/react/locales/zh-cn";
import classicTheme from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import {
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderClosed,
  FolderOpen,
  GripVertical,
  Inbox,
  LockKeyhole,
  PanelLeft,
  Tag,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useShortcutHandler } from "./ShortcutProvider";
import {
  chineseCalendarDetail,
  systemTimeZone,
} from "./lib/dateTimePreferences";
import { MiniCalendar } from "./MiniCalendar";
import {
  buildScheduleTaskGroups,
  canRescheduleTask,
  clearSchedulePatch,
  schedulePatchForCalendarMove,
  schedulePatchFromDrop,
} from "./lib/calendarScheduling";
import {
  areAllUserGroupsFullyVisible,
  CALENDAR_UNASSIGNED_ID,
  calendarAssigneeFilterIds,
  isUserGroupFullyVisible,
  taskIsVisibleOnCalendar,
} from "./lib/calendarVisibility";
import {
  compareSiblingLabels,
  hasExplicitLabelColor,
  userLabelOrderMap,
} from "./lib/labels";
import { memberDisplayName } from "./lib/taskTitleTokens";
import { MemberAvatar } from "./MemberAvatar";
import type {
  DateTimePreferences,
  Label,
  ReminderSchedule,
  Task,
  WorkspaceBundle,
} from "./types";

type CalendarViewId =
  | "day"
  | "week"
  | "month"
  | "year"
  | "agenda"
  | "multiDay"
  | "multiWeek";

type CalendarViewDefinition = {
  id: CalendarViewId;
  label: string;
  fullCalendarView: string;
  shortcut: string;
};

const CALENDAR_VIEWS: CalendarViewDefinition[] = [
  { id: "day", label: "日", fullCalendarView: "timeGridDay", shortcut: "D/1" },
  { id: "week", label: "周", fullCalendarView: "timeGridWeek", shortcut: "W/2" },
  { id: "month", label: "月", fullCalendarView: "dayGridMonth", shortcut: "M/3" },
  { id: "year", label: "年", fullCalendarView: "multiMonthYear", shortcut: "Y/4" },
  { id: "agenda", label: "日程", fullCalendarView: "listMonth", shortcut: "A/5" },
  { id: "multiDay", label: "多日", fullCalendarView: "timeGridMultiDay", shortcut: "" },
  { id: "multiWeek", label: "多周", fullCalendarView: "dayGridMultiWeek", shortcut: "" },
];

const VIEW_STORAGE_KEY = "anttodo:calendar-view";
const MULTI_DAY_STORAGE_KEY = "anttodo:calendar-multi-day-count";
const MULTI_WEEK_STORAGE_KEY = "anttodo:calendar-multi-week-count";
const SCHEDULE_PANEL_OPEN_KEY = "anttodo:calendar-schedule-panel-open";
const USER_GROUPS_COLLAPSED_KEY = "anttodo:calendar-user-groups-collapsed";
const USERS_COLLAPSED_KEY = "anttodo:calendar-users-collapsed";
const LABELS_COLLAPSED_KEY = "anttodo:calendar-labels-collapsed";

function readStoredCollapsed(key: string) {
  // First visit defaults to collapsed; only an explicit "0" keeps a section open.
  return window.localStorage.getItem(key) !== "0";
}

function readStoredNumber(key: string, fallback: number, min: number, max: number) {
  const parsed = Number(window.localStorage.getItem(key));
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function readStoredView(): CalendarViewId {
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return CALENDAR_VIEWS.some((view) => view.id === stored)
    ? stored as CalendarViewId
    : "month";
}

function readSchedulePanelOpen() {
  return window.localStorage.getItem(SCHEDULE_PANEL_OPEN_KEY) !== "0";
}

function taskEvent(task: Task, labels: Label[], editable = false): EventInput | null {
  if (task.deleted_at || !task.due_at) return null;
  const label = labels.find((candidate) => task.label_ids.includes(candidate.id));
  const color = label?.color || "#9EB3FC";
  const start = task.due_start_at || task.due_at;
  return {
    id: task.id,
    title: task.title,
    start,
    end: task.due_start_at ? task.due_at : undefined,
    allDay: task.due_is_all_day,
    editable,
    color,
    contrastColor: task.kind !== "note" && task.status === "completed"
      ? "rgba(25,25,25,.5)"
      : "#191919",
    className: task.kind !== "note" && task.status === "completed"
      ? "calendar-event-completed"
      : "",
  };
}

function HolidayBadge({
  date,
  enabled,
}: {
  date: Date;
  enabled: boolean;
}) {
  if (!enabled) return null;
  const detail = chineseCalendarDetail(date);
  if (!detail.holidayLabel) return null;
  return (
    <span
      className={clsx(
        "calendar-holiday-badge",
        detail.holidayLabel === "班" ? "workday" : "holiday",
      )}
      title={detail.holidayName || (detail.holidayLabel === "班" ? "调休上班" : "法定假期")}
      aria-label={detail.holidayLabel === "班" ? "调休上班" : "法定假期"}
    >
      {detail.holidayLabel}
    </span>
  );
}

function CalendarVisibilityCheck({
  checked,
  color,
  className,
}: {
  checked: boolean;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={clsx("calendar-visibility-check", checked && "checked", className)}
      style={checked ? { backgroundColor: color, borderColor: color } : undefined}
      aria-hidden="true"
    >
      {checked && <Check />}
    </span>
  );
}

function CalendarLabelTree({
  labels,
  userLabelOrder,
  visibleCalendarIds,
  collapsed,
  onToggleCollapsed,
  onToggleCalendar,
  parentId = null,
  depth = 0,
}: {
  labels: Label[];
  userLabelOrder: WorkspaceBundle["userLabelOrder"];
  visibleCalendarIds: Set<string>;
  collapsed: Record<string, boolean>;
  onToggleCollapsed: (labelId: string) => void;
  onToggleCalendar: (labelId: string) => void;
  parentId?: string | null;
  depth?: number;
}) {
  const labelIds = new Set(labels.map((label) => label.id));
  const orderMap = userLabelOrderMap(userLabelOrder);
  const children = labels
    .filter((label) => label.parent_id === parentId
      || (parentId === null && label.parent_id !== null && !labelIds.has(label.parent_id)))
    .sort((a, b) => compareSiblingLabels(a, b, parentId, orderMap));

  return children.map((label) => {
    const hasChildren = labels.some((candidate) => candidate.parent_id === label.id);
    const isCollapsed = collapsed[label.id] ?? false;
    const visible = visibleCalendarIds.has(label.id);
    const labelIcon = hasChildren
      ? (isCollapsed ? <FolderClosed /> : <FolderOpen />)
      : <Tag />;

    return (
      <div
        key={label.id}
        className="label-tree-node"
        role="treeitem"
        aria-expanded={hasChildren ? !isCollapsed : undefined}
      >
        <button
          type="button"
          className="label-row calendar-label-row"
          style={{ paddingLeft: 12 + depth * 16 }}
          aria-pressed={visible}
          onClick={() => onToggleCalendar(label.id)}
        >
          <span
            className={clsx("label-type-icon", hasChildren && "label-group-icon")}
            onClick={hasChildren
              ? (event) => {
                  event.stopPropagation();
                  onToggleCollapsed(label.id);
                }
              : undefined}
          >
            {labelIcon}
          </span>
          <span className="label-name">{label.name}</span>
          {label.kind === "private" && <LockKeyhole size={12} />}
          {hasExplicitLabelColor(label.color) && (
            <i
              className="label-color-dot"
              style={{ backgroundColor: label.color }}
              aria-hidden="true"
            />
          )}
          <CalendarVisibilityCheck checked={visible} color={label.color} />
        </button>
        {hasChildren && !isCollapsed && (
          <div role="group">
            <CalendarLabelTree
              labels={labels}
              userLabelOrder={userLabelOrder}
              visibleCalendarIds={visibleCalendarIds}
              collapsed={collapsed}
              onToggleCollapsed={onToggleCollapsed}
              onToggleCalendar={onToggleCalendar}
              parentId={label.id}
              depth={depth + 1}
            />
          </div>
        )}
      </div>
    );
  });
}

export function CalendarSidebar({
  openMobile,
  bundle,
  visibleCalendarIds,
  visibleAssigneeIds,
  onCloseMobile,
  onToggleCalendar,
  onShowAll,
  onToggleAssignee,
  onShowAllAssignees,
  onToggleUserGroup,
  onShowAllUserGroups,
  visibleDate,
  dateTimePreferences,
  onSelectDate,
}: {
  openMobile: boolean;
  bundle: WorkspaceBundle;
  visibleCalendarIds: Set<string>;
  visibleAssigneeIds: Set<string>;
  onCloseMobile: () => void;
  onToggleCalendar: (id: string) => void;
  onShowAll: () => void;
  onToggleAssignee: (id: string) => void;
  onShowAllAssignees: () => void;
  onToggleUserGroup: (groupId: string) => void;
  onShowAllUserGroups: () => void;
  visibleDate: Date;
  dateTimePreferences: DateTimePreferences;
  onSelectDate: (date: Date) => void;
}) {
  const [collapsedLabels, setCollapsedLabels] = useState<Record<string, boolean>>({});
  const [userGroupsCollapsed, setUserGroupsCollapsed] = useState(
    () => readStoredCollapsed(USER_GROUPS_COLLAPSED_KEY),
  );
  const [usersCollapsed, setUsersCollapsed] = useState(
    () => readStoredCollapsed(USERS_COLLAPSED_KEY),
  );
  const [labelsSectionCollapsed, setLabelsSectionCollapsed] = useState(
    () => readStoredCollapsed(LABELS_COLLAPSED_KEY),
  );
  const calendarIds = ["inbox", ...bundle.labels.map((label) => label.id)];
  const allVisible = calendarIds.every((calendarId) => visibleCalendarIds.has(calendarId));
  const inboxVisible = visibleCalendarIds.has("inbox");
  const assigneeIds = calendarAssigneeFilterIds(bundle.members);
  const allAssigneesVisible = assigneeIds.every((id) => visibleAssigneeIds.has(id));
  const unassignedVisible = visibleAssigneeIds.has(CALENDAR_UNASSIGNED_ID);
  const sortedUserGroups = useMemo(
    () => [...bundle.userGroups].sort((left, right) =>
      left.name.localeCompare(right.name, "zh-Hans-CN")),
    [bundle.userGroups],
  );
  const allUserGroupsVisible = areAllUserGroupsFullyVisible(
    sortedUserGroups.map((group) => group.id),
    visibleAssigneeIds,
    bundle.userGroupMembers,
  );
  const sortedMembers = useMemo(
    () => [...bundle.members].sort((left, right) =>
      memberDisplayName(left).localeCompare(memberDisplayName(right), "zh-Hans-CN")),
    [bundle.members],
  );

  function toggleUserGroupsCollapsed() {
    setUserGroupsCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem(USER_GROUPS_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  function toggleUsersCollapsed() {
    setUsersCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem(USERS_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  function toggleLabelsSectionCollapsed() {
    setLabelsSectionCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem(LABELS_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <>
      {openMobile && (
        <button className="sidebar-scrim" onClick={onCloseMobile} aria-label="关闭侧栏" />
      )}
      <aside className={clsx("sidebar", "calendar-sidebar", openMobile && "mobile-open")}>
        <MiniCalendar
          bundle={bundle}
          visibleCalendarIds={visibleCalendarIds}
          visibleAssigneeIds={visibleAssigneeIds}
          visibleDate={visibleDate}
          dateTimePreferences={dateTimePreferences}
          onSelectDate={onSelectDate}
        />
        <div className="calendar-sidebar-filters">
          <div className="calendar-user-group-section">
            <div className="sidebar-section-header calendar-user-group-section-header">
              <button
                type="button"
                className="calendar-section-collapse"
                aria-expanded={!userGroupsCollapsed}
                aria-controls="calendar-user-group-list"
                onClick={toggleUserGroupsCollapsed}
              >
                {userGroupsCollapsed ? <ChevronRight /> : <ChevronDown />}
                <span>用户组</span>
              </button>
              <button
                type="button"
                className="calendar-select-all"
                aria-label="全选用户组"
                aria-pressed={allUserGroupsVisible}
                disabled={sortedUserGroups.length === 0}
                onClick={onShowAllUserGroups}
              >
                <span
                  className={clsx(
                    "calendar-visibility-check",
                    "calendar-user-group-all-check",
                    allUserGroupsVisible && "active",
                  )}
                  style={allUserGroupsVisible
                    ? { backgroundColor: "#4772fa", borderColor: "#4772fa" }
                    : undefined}
                  aria-hidden="true"
                >
                  {allUserGroupsVisible && <Check />}
                </span>
              </button>
            </div>
            {!userGroupsCollapsed && (
              <div id="calendar-user-group-list" className="calendar-list" aria-label="用户组">
                {sortedUserGroups.length === 0 ? (
                  <p className="calendar-filter-empty">暂无用户组</p>
                ) : sortedUserGroups.map((group) => {
                  const visible = isUserGroupFullyVisible(
                    group.id,
                    visibleAssigneeIds,
                    bundle.userGroupMembers,
                  );
                  return (
                    <button
                      key={group.id}
                      type="button"
                      className="label-row calendar-label-row"
                      aria-pressed={visible}
                      onClick={() => onToggleUserGroup(group.id)}
                    >
                      <span className="label-type-icon"><Users /></span>
                      <span className="label-name">{group.name}</span>
                      <CalendarVisibilityCheck checked={visible} color="#4772fa" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="calendar-user-section">
            <div className="sidebar-section-header calendar-user-section-header">
              <button
                type="button"
                className="calendar-section-collapse"
                aria-expanded={!usersCollapsed}
                aria-controls="calendar-user-list"
                onClick={toggleUsersCollapsed}
              >
                {usersCollapsed ? <ChevronRight /> : <ChevronDown />}
                <span>用户</span>
              </button>
              <button
                type="button"
                className="calendar-select-all"
                aria-label="全选用户"
                aria-pressed={allAssigneesVisible}
                onClick={onShowAllAssignees}
              >
                <span
                  className={clsx(
                    "calendar-visibility-check",
                    "calendar-assignee-all-check",
                    allAssigneesVisible && "active",
                  )}
                  style={allAssigneesVisible
                    ? { backgroundColor: "#4772fa", borderColor: "#4772fa" }
                    : undefined}
                  aria-hidden="true"
                >
                  {allAssigneesVisible && <Check />}
                </span>
              </button>
            </div>
            {!usersCollapsed && (
              <div id="calendar-user-list" className="calendar-list" aria-label="用户">
                <button
                  type="button"
                  className="label-row calendar-label-row"
                  aria-pressed={unassignedVisible}
                  onClick={() => onToggleAssignee(CALENDAR_UNASSIGNED_ID)}
                >
                  <span className="label-type-icon"><UserRound /></span>
                  <span className="label-name">未指派</span>
                  <CalendarVisibilityCheck checked={unassignedVisible} color="#4772fa" />
                </button>
                {sortedMembers.map((member) => {
                  const visible = visibleAssigneeIds.has(member.user_id);
                  return (
                    <button
                      key={member.user_id}
                      type="button"
                      className="label-row calendar-label-row"
                      aria-pressed={visible}
                      onClick={() => onToggleAssignee(member.user_id)}
                    >
                      <span className="label-type-icon calendar-user-avatar-wrap">
                        <MemberAvatar member={member} className="calendar-user-avatar" />
                      </span>
                      <span className="label-name">{memberDisplayName(member)}</span>
                      <CalendarVisibilityCheck checked={visible} color="#4772fa" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="calendar-label-section">
            <div className="sidebar-section-header calendar-label-section-header">
              <button
                type="button"
                className="calendar-section-collapse"
                aria-expanded={!labelsSectionCollapsed}
                aria-controls="calendar-label-list"
                onClick={toggleLabelsSectionCollapsed}
              >
                {labelsSectionCollapsed ? <ChevronRight /> : <ChevronDown />}
                <span>标签</span>
              </button>
              <button
                type="button"
                className="calendar-select-all"
                aria-label="全选"
                aria-pressed={allVisible}
                onClick={onShowAll}
              >
                <span
                  className={clsx("calendar-visibility-check", "calendar-all-check", allVisible && "active")}
                  style={allVisible
                    ? { backgroundColor: "#4772fa", borderColor: "#4772fa" }
                    : undefined}
                  aria-hidden="true"
                >
                  {allVisible && <Check />}
                </span>
              </button>
            </div>
            {!labelsSectionCollapsed && (
              <div id="calendar-label-list" className="calendar-list" aria-label="标签">
                <button
                  type="button"
                  className="label-row calendar-label-row"
                  aria-pressed={inboxVisible}
                  onClick={() => onToggleCalendar("inbox")}
                >
                  <span className="label-type-icon"><Inbox /></span>
                  <span className="label-name">收集箱</span>
                  <CalendarVisibilityCheck checked={inboxVisible} color="#8e95a3" />
                </button>
                <div className="calendar-label-tree" role="tree" aria-label="标签树">
                  <CalendarLabelTree
                    labels={bundle.labels}
                    userLabelOrder={bundle.userLabelOrder}
                    visibleCalendarIds={visibleCalendarIds}
                    collapsed={collapsedLabels}
                    onToggleCollapsed={(labelId) => setCollapsedLabels((current) => ({
                      ...current,
                      [labelId]: !current[labelId],
                    }))}
                    onToggleCalendar={onToggleCalendar}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function ScheduleTaskPanel({
  bundle,
  currentUserId,
  online,
  pendingTaskIds,
  optimisticallyUnscheduledTaskIds,
  visibleCalendarIds,
  visibleAssigneeIds,
  calendarTaskDragging,
  panelRef,
  onClose,
  onSelectTask,
}: {
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  pendingTaskIds: ReadonlySet<string>;
  optimisticallyUnscheduledTaskIds: ReadonlySet<string>;
  visibleCalendarIds: Set<string>;
  visibleAssigneeIds: Set<string>;
  calendarTaskDragging: boolean;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const panelBundle = useMemo(() => optimisticallyUnscheduledTaskIds.size === 0
    ? bundle
    : {
      ...bundle,
      tasks: bundle.tasks.map((task) => optimisticallyUnscheduledTaskIds.has(task.id)
        ? { ...task, ...clearSchedulePatch() }
        : task),
    }, [bundle, optimisticallyUnscheduledTaskIds]);
  const groups = useMemo(
    () => buildScheduleTaskGroups(
      panelBundle,
      currentUserId,
      pendingTaskIds,
      visibleCalendarIds,
      visibleAssigneeIds,
    ),
    [currentUserId, panelBundle, pendingTaskIds, visibleAssigneeIds, visibleCalendarIds],
  );

  return (
    <aside
      className={clsx("calendar-schedule-panel", calendarTaskDragging && "is-calendar-drop-target")}
      aria-label="安排任务"
      ref={panelRef}
    >
      <header className="calendar-schedule-header">
        <strong>安排任务</strong>
        <button aria-label="关闭安排任务" onClick={onClose}><X /></button>
      </header>
      {calendarTaskDragging && (
        <div className="calendar-schedule-drop-hint" role="status">
          拖到此处取消安排
        </div>
      )}
      {!online && <p className="calendar-schedule-offline">离线模式下只能查看任务</p>}
      <div className="calendar-schedule-groups">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.id);
          const color = group.label?.color ?? "#8e95a3";
          return (
            <section
              className="calendar-schedule-group"
              key={group.id}
              style={{ "--schedule-label-color": color } as React.CSSProperties}
            >
              <button
                className="calendar-schedule-group-header"
                style={{ paddingLeft: 12 + group.depth * 14 }}
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(group.id)) next.delete(group.id);
                  else next.add(group.id);
                  return next;
                })}
              >
                <ChevronDown />
                {group.label ? <i /> : <Inbox />}
                <span>{group.label?.name ?? "收集箱"}</span>
                <em>{group.tasks.length}</em>
              </button>
              {!isCollapsed && group.tasks.map((task) => (
                <div
                  className={clsx("calendar-schedule-task", online && "is-draggable")}
                  data-task-id={task.id}
                  data-event-title={task.title}
                  data-event-color={group.label?.color ?? "#9EB3FC"}
                  key={`${group.id}:${task.id}`}
                  title={online ? "拖到日历中安排截止时间" : "离线模式下不能安排任务"}
                >
                  <GripVertical className="calendar-schedule-drag-handle" aria-hidden="true" />
                  <button onClick={() => onSelectTask(task.id)}>{task.title}</button>
                </div>
              ))}
            </section>
          );
        })}
        {groups.length === 0 && (
          <div className="calendar-schedule-empty">
            <CalendarDays />
            <strong>没有待安排的任务</strong>
            <span>未设置截止时间的待办会显示在这里</span>
          </div>
        )}
      </div>
    </aside>
  );
}

export function CalendarWorkspace({
  bundle,
  currentUserId,
  online,
  visibleCalendarIds,
  visibleAssigneeIds,
  dateTimePreferences,
  onSelectTask,
  onSaveTaskSchedule,
  onNotice,
  sidebarVisible,
  onToggleSidebar,
  navigationDate,
  onVisibleDateChange,
}: {
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  visibleCalendarIds: Set<string>;
  visibleAssigneeIds: Set<string>;
  dateTimePreferences: DateTimePreferences;
  onSelectTask: (taskId: string) => void;
  onSaveTaskSchedule: (
    taskId: string,
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onNotice: (message: string) => void;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  navigationDate: Date | null;
  onVisibleDateChange: (date: Date) => void;
}) {
  const calendarRef = useRef<CalendarRef>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const schedulePanelRef = useRef<HTMLDivElement>(null);
  const unscheduleDropTaskIdsRef = useRef<Set<string>>(new Set());
  const [view, setView] = useState<CalendarViewId>(readStoredView);
  const [multiDayCount, setMultiDayCount] = useState(() =>
    readStoredNumber(MULTI_DAY_STORAGE_KEY, 3, 2, 14));
  const [multiWeekCount, setMultiWeekCount] = useState(() =>
    readStoredNumber(MULTI_WEEK_STORAGE_KEY, 4, 2, 12));
  const [title, setTitle] = useState("");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [schedulePanelOpen, setSchedulePanelOpen] = useState(readSchedulePanelOpen);
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(() => new Set());
  const [calendarMutationTaskIds, setCalendarMutationTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [optimisticallyUnscheduledTaskIds, setOptimisticallyUnscheduledTaskIds] = useState<
    Set<string>
  >(() => new Set());
  const [draggingCalendarTaskId, setDraggingCalendarTaskId] = useState<string | null>(null);
  const [optimisticEvents, setOptimisticEvents] = useState<Record<string, EventInput>>({});

  const events = useMemo(() => [
    ...bundle.tasks.flatMap((task) => {
      if (optimisticallyUnscheduledTaskIds.has(task.id)) return [];
      if (!taskIsVisibleOnCalendar(task, visibleCalendarIds, visibleAssigneeIds)) return [];
      const event = taskEvent(
        task,
        bundle.labels,
        online
          && view !== "agenda"
          && !calendarMutationTaskIds.has(task.id)
          && canRescheduleTask(bundle, task, currentUserId),
      );
      return event ? [event] : [];
    }),
    ...Object.values(optimisticEvents),
  ], [
    bundle,
    calendarMutationTaskIds,
    currentUserId,
    online,
    optimisticEvents,
    optimisticallyUnscheduledTaskIds,
    view,
    visibleAssigneeIds,
    visibleCalendarIds,
  ]);

  const activeView = CALENDAR_VIEWS.find((candidate) => candidate.id === view)!;

  useEffect(() => {
    if (navigationDate) calendarRef.current?.getApi().gotoDate(navigationDate);
  }, [navigationDate]);

  useEffect(() => {
    const container = schedulePanelRef.current;
    if (!container || !schedulePanelOpen || !online) return;
    const draggable = new Draggable(container, {
      itemSelector: ".calendar-schedule-task.is-draggable",
      minDistance: 6,
      longPressDelay: 350,
      eventData: (element) => ({
        id: element.dataset.taskId,
        title: element.dataset.eventTitle,
        color: element.dataset.eventColor,
        contrastColor: "#191919",
        extendedProps: { taskId: element.dataset.taskId },
      }),
    });
    return () => draggable.destroy();
  }, [online, schedulePanelOpen]);

  useEffect(() => {
    if (!viewMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setViewMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [viewMenuOpen]);

  function changeView(nextView: CalendarViewId) {
    const definition = CALENDAR_VIEWS.find((candidate) => candidate.id === nextView)!;
    setView(nextView);
    window.localStorage.setItem(VIEW_STORAGE_KEY, nextView);
    calendarRef.current?.getApi().changeView(definition.fullCalendarView);
    setViewMenuOpen(false);
  }

  useShortcutHandler("calendar.viewDay", () => changeView("day"));
  useShortcutHandler("calendar.viewWeek", () => changeView("week"));
  useShortcutHandler("calendar.viewMonth", () => changeView("month"));
  useShortcutHandler("calendar.viewYear", () => changeView("year"));
  useShortcutHandler("calendar.viewAgenda", () => changeView("agenda"));
  useShortcutHandler("calendar.today", () => {
    calendarRef.current?.getApi().today();
  });
  useShortcutHandler("calendar.prev", () => {
    calendarRef.current?.getApi().prev();
  });
  useShortcutHandler("calendar.next", () => {
    calendarRef.current?.getApi().next();
  });

  function updateMultiDayCount(value: number) {
    setMultiDayCount(value);
    window.localStorage.setItem(MULTI_DAY_STORAGE_KEY, String(value));
    if (view === "multiDay") {
      calendarRef.current?.getApi().changeView("timeGridMultiDay");
    }
  }

  function updateMultiWeekCount(value: number) {
    setMultiWeekCount(value);
    window.localStorage.setItem(MULTI_WEEK_STORAGE_KEY, String(value));
    if (view === "multiWeek") {
      calendarRef.current?.getApi().changeView("dayGridMultiWeek");
    }
  }

  function setSchedulePanelVisibility(open: boolean) {
    setSchedulePanelOpen(open);
    window.localStorage.setItem(SCHEDULE_PANEL_OPEN_KEY, open ? "1" : "0");
  }

  function scheduleForTask(task: Task): ReminderSchedule {
    return {
      reminders: task.reminders.map((reminder) => ({
        anchor: reminder.anchor,
        offset_value: reminder.offset_value,
        offset_unit: reminder.offset_unit,
        local_time: reminder.local_time,
      })),
      persistent: task.reminder_persistent,
      recurrence: task.recurrence ?? null,
    };
  }

  function setCalendarTaskMutation(taskId: string, pending: boolean) {
    setCalendarMutationTaskIds((current) => {
      const next = new Set(current);
      if (pending) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }

  async function moveCalendarTask(info: EventDropInfo) {
    const taskId = info.event.id;
    if (unscheduleDropTaskIdsRef.current.has(taskId)) {
      info.revert();
      return;
    }
    const task = bundle.tasks.find((candidate) => candidate.id === taskId);
    const dropDate = info.event.start;
    if (
      !online
      || view === "agenda"
      || !task
      || !dropDate
      || calendarMutationTaskIds.has(taskId)
      || !canRescheduleTask(bundle, task, currentUserId)
    ) {
      info.revert();
      return;
    }

    const timeZone = dateTimePreferences.timeZoneEnabled
      ? systemTimeZone()
      : task.due_timezone;
    const patch = schedulePatchForCalendarMove(task, dropDate, info.event.allDay, timeZone);
    setCalendarTaskMutation(taskId, true);
    try {
      await onSaveTaskSchedule(taskId, patch, scheduleForTask(task));
    } catch (cause) {
      info.revert();
      onNotice(cause instanceof Error ? cause.message : "任务改期失败，请重试");
    } finally {
      setCalendarTaskMutation(taskId, false);
    }
  }

  async function returnCalendarTaskToCandidates(task: Task) {
    const taskId = task.id;
    setCalendarTaskMutation(taskId, true);
    setOptimisticallyUnscheduledTaskIds((current) => new Set(current).add(taskId));
    try {
      await onSaveTaskSchedule(taskId, clearSchedulePatch(), {
        reminders: [],
        persistent: false,
        recurrence: null,
      });
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : "取消任务安排失败，请重试");
    } finally {
      unscheduleDropTaskIdsRef.current.delete(taskId);
      setOptimisticallyUnscheduledTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
      setCalendarTaskMutation(taskId, false);
    }
  }

  function stopCalendarTaskDrag(info: EventDragStopInfo) {
    setDraggingCalendarTaskId(null);
    const panel = schedulePanelRef.current;
    const task = bundle.tasks.find((candidate) => candidate.id === info.event.id);
    if (!panel || !schedulePanelOpen || !online || view === "agenda" || !task) return;
    const bounds = panel.getBoundingClientRect();
    const { clientX, clientY } = info.jsEvent;
    const droppedOnPanel = clientX >= bounds.left
      && clientX <= bounds.right
      && clientY >= bounds.top
      && clientY <= bounds.bottom;
    if (!droppedOnPanel || !canRescheduleTask(bundle, task, currentUserId)) return;

    unscheduleDropTaskIdsRef.current.add(task.id);
    void returnCalendarTaskToCandidates(task);
  }

  async function receiveScheduledTask(info: EventReceiveInfo) {
    const taskId = String(info.event.extendedProps.taskId ?? info.event.id);
    const task = bundle.tasks.find((candidate) => candidate.id === taskId);
    const dropDate = info.event.start;
    const allDay = info.event.allDay;
    info.event.remove();
    if (
      !online
      || view === "agenda"
      || !task
      || !dropDate
      || pendingTaskIds.has(taskId)
      || !canRescheduleTask(bundle, task, currentUserId)
    ) return;

    const timeZone = dateTimePreferences.timeZoneEnabled
      ? systemTimeZone()
      : task.due_timezone;
    const patch = schedulePatchFromDrop(dropDate, allDay, timeZone);
    const optimistic = taskEvent({ ...task, ...patch }, bundle.labels);
    setPendingTaskIds((current) => new Set(current).add(taskId));
    if (optimistic) {
      setOptimisticEvents((current) => ({ ...current, [taskId]: optimistic }));
    }
    try {
      await onSaveTaskSchedule(taskId, patch, scheduleForTask(task));
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : "任务安排失败，请重试");
    } finally {
      setPendingTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
      setOptimisticEvents((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    }
  }

  return (
    <div className={clsx("calendar-workspace", schedulePanelOpen && "schedule-panel-open")}>
      <div className="calendar-stage">
        <header className="calendar-toolbar">
        <div className="calendar-toolbar-title">
          <button
            className="calendar-sidebar-toggle"
            onClick={onToggleSidebar}
            aria-label={sidebarVisible ? "打开导航或隐藏日历列表" : "打开导航或显示日历列表"}
            aria-pressed={sidebarVisible}
          >
            <PanelLeft />
          </button>
          <h1>{title}</h1>
        </div>
        <div className="calendar-toolbar-actions">
          <div className="calendar-view-anchor" ref={menuRef}>
            <button
              className="calendar-view-trigger"
              aria-haspopup="menu"
              aria-expanded={viewMenuOpen}
              onClick={() => setViewMenuOpen((open) => !open)}
            >
              {activeView.label === "多日" ? `${multiDayCount}日` : activeView.label === "多周" ? `${multiWeekCount}周` : activeView.label}
              <ChevronDown />
            </button>
            {viewMenuOpen && (
              <div className="calendar-view-menu" role="menu" aria-label="选择日历视图">
                {CALENDAR_VIEWS.map((definition, index) => (
                  <div
                    key={definition.id}
                    className={clsx(
                      "calendar-view-row",
                      definition.id === view && "active",
                      index === 5 && "with-divider",
                    )}
                  >
                    <button role="menuitemradio" aria-checked={definition.id === view} onClick={() => changeView(definition.id)}>
                      <span className="calendar-view-check">{definition.id === view && <Check />}</span>
                      <span>{definition.label}</span>
                    </button>
                    {definition.id === "multiDay" ? (
                      <select
                        aria-label="多日视图天数"
                        value={multiDayCount}
                        onChange={(event) => updateMultiDayCount(Number(event.target.value))}
                      >
                        {[2, 3, 4, 5, 7, 10, 14].map((count) => <option key={count} value={count}>{count}日</option>)}
                      </select>
                    ) : definition.id === "multiWeek" ? (
                      <select
                        aria-label="多周视图周数"
                        value={multiWeekCount}
                        onChange={(event) => updateMultiWeekCount(Number(event.target.value))}
                      >
                        {[2, 3, 4, 5, 6, 8, 10, 12].map((count) => <option key={count} value={count}>{count}周</option>)}
                      </select>
                    ) : (
                      <span className="calendar-view-shortcut">{definition.shortcut}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="calendar-date-navigation">
            <button aria-label="上一个日期范围" onClick={() => calendarRef.current?.getApi().prev()}><ChevronLeft /></button>
            <button onClick={() => calendarRef.current?.getApi().today()}>今天</button>
            <button aria-label="下一个日期范围" onClick={() => calendarRef.current?.getApi().next()}><ChevronRight /></button>
          </div>
          {!schedulePanelOpen && (
            <button
              className="calendar-schedule-toggle"
              aria-label="显示安排任务"
              onClick={() => setSchedulePanelVisibility(true)}
            >
              <CalendarPlus />
            </button>
          )}
        </div>
      </header>
      <div className="calendar-canvas">
        <FullCalendar
          ref={calendarRef}
          plugins={[classicTheme, interactionPlugin, dayGridPlugin, timeGridPlugin, listPlugin, multiMonthPlugin]}
          locale={zhCnLocale}
          initialView={activeView.fullCalendarView}
          firstDay={dateTimePreferences.weekStartsOn}
          weekNumbers={dateTimePreferences.showWeekNumbers}
          weekNumberCalculation="ISO"
          headerToolbar={false}
          height="100%"
          expandRows
          nowIndicator
          navLinks
          dayMaxEvents={3}
          eventDisplay="block"
          displayEventTime={false}
          allDayText="全天"
          noEventsText="这段时间没有任务"
          slotMinTime="06:00:00"
          slotMaxTime="24:00:00"
          slotDuration="00:30:00"
          events={events}
          editable={online && view !== "agenda"}
          eventDurationEditable={false}
          droppable={online && view !== "agenda"}
          dayCellTopContent={(info) => (
            <div className="calendar-main-day-top">
              <span>{info.date.getDate()}</span>
              <HolidayBadge
                date={info.date}
                enabled={dateTimePreferences.showHolidayAdjustments}
              />
            </div>
          )}
          views={{
            timeGridMultiDay: {
              type: "timeGrid",
              duration: { days: multiDayCount },
              dateIncrement: { days: multiDayCount },
            },
            dayGridMultiWeek: {
              type: "dayGrid",
              duration: { weeks: multiWeekCount },
              dateIncrement: { weeks: multiWeekCount },
            },
          }}
          datesSet={(info: DatesSetInfo) => {
            setTitle(info.view.title);
            onVisibleDateChange(info.view.currentStart);
          }}
          eventClick={(info) => onSelectTask(info.event.id)}
          eventDragStart={(info: EventDragStartInfo) => setDraggingCalendarTaskId(info.event.id)}
          eventDragStop={stopCalendarTaskDrag}
          eventDrop={(info) => void moveCalendarTask(info)}
          eventReceive={(info) => void receiveScheduledTask(info)}
        />
      </div>
      </div>
      {schedulePanelOpen && (
        <>
          <button
            className="calendar-schedule-scrim"
            aria-label="关闭安排任务"
            onClick={() => setSchedulePanelVisibility(false)}
          />
          <ScheduleTaskPanel
            bundle={bundle}
            currentUserId={currentUserId}
            online={online}
            pendingTaskIds={pendingTaskIds}
            optimisticallyUnscheduledTaskIds={optimisticallyUnscheduledTaskIds}
            visibleCalendarIds={visibleCalendarIds}
            visibleAssigneeIds={visibleAssigneeIds}
            calendarTaskDragging={draggingCalendarTaskId !== null}
            panelRef={schedulePanelRef}
            onClose={() => setSchedulePanelVisibility(false)}
            onSelectTask={onSelectTask}
          />
        </>
      )}
    </div>
  );
}
