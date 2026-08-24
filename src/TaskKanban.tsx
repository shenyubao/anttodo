import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, Circle, Ellipsis, GripVertical, NotebookPen, Plus } from "lucide-react";
import {
  Fragment,
  memo,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { AiCliAvatar } from "./AiCliAvatar";
import { MemberAvatar } from "./MemberAvatar";
import { TaskContextMenu } from "./TaskContextMenu";
import { TaskSectionComposer } from "./TaskSectionComposer";
import { getPriorityOption } from "./PriorityControl";
import { getDueStatus } from "./lib/dueTime";
import { formatContactDisplayName, useShowContactNames } from "./lib/displayPreference";
import { formatHoursList, parseEstimateHoursText } from "./lib/taskHours";
import { aiCliLabel } from "./lib/aiWork";
import type { KanbanColumn } from "./lib/taskKanban";
import { customGroupKey } from "./lib/taskList";
import type {
  DateTimePreferences,
  Label,
  LabelPermissionLevel,
  Member,
  NoticeHandler,
  ReminderSchedule,
  Task,
  TaskKind,
  TaskPriority,
  UserLabelOrder,
} from "./types";
import { TaskTitleTokenChips, TaskTitleTokenMenu } from "./TaskTitleTokenMenu";
import { useTaskTitleTokens, type TaskTitleTokenSubmit } from "./useTaskTitleTokens";

type CreateTaskInput = {
  title: string;
  labelIds: string[];
  description?: string;
  dueAt?: string | null;
  dueTimezone?: string | null;
  estimateHours?: number | null;
  priority?: TaskPriority;
  kind?: TaskKind;
  assigneeId?: string | null;
};

export type KanbanCreatePayload = TaskTitleTokenSubmit & {
  estimateHours?: number | null;
};

const kanbanCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    const draggingSection = args.active.data.current?.type === "section";
    const matchingCollisions = pointerCollisions.filter(({ id }) => {
      const targetType = args.droppableContainers
        .find((container) => container.id === id)?.data.current?.type;
      return draggingSection ? targetType === "section" : targetType !== "section";
    });
    if (matchingCollisions.length > 0) return matchingCollisions;
  }
  return closestCenter(args);
};

export function TaskKanban({
  columns,
  labels,
  members,
  labelPermissionLevels,
  userLabelOrder,
  workspaceId,
  currentUserId,
  defaultAssigneeId = null,
  selectedTaskId,
  online,
  now,
  dateTimePreferences,
  showLabels,
  showHours,
  customSort,
  customGrouping,
  canManageSections,
  sectionDraftIndex,
  sectionDraftName,
  sectionDraftBusy,
  canEditTask,
  canCreateInColumn,
  canReceiveInColumn,
  onCreateInColumn,
  onMoveTask,
  onSetColumnOrder,
  onStartAddSection,
  onSectionDraftNameChange,
  onSubmitSectionDraft,
  onCancelSectionDraft,
  onRenameSection,
  onDeleteSection,
  onReorderSections,
  onSelectTask,
  onUpdateTask,
  onSaveTaskSchedule,
  onSaveChildTaskSchedule,
  onCreateTask,
  onCreateChildTask,
  onUpdateChildTask,
  onDeleteChildTask,
  onAddTaskDependencies,
  pickerTasks,
  onPurgeTask,
  onNotice,
}: {
  columns: KanbanColumn[];
  labels: Label[];
  members: Member[];
  labelPermissionLevels: Record<string, LabelPermissionLevel | undefined>;
  userLabelOrder?: Iterable<Pick<UserLabelOrder, "label_id" | "position">>;
  workspaceId: string;
  currentUserId: string;
  defaultAssigneeId?: string | null;
  selectedTaskId: string | null;
  online: boolean;
  now: Date;
  dateTimePreferences: DateTimePreferences;
  showLabels: boolean;
  showHours: boolean;
  customSort: boolean;
  customGrouping: boolean;
  canManageSections: boolean;
  sectionDraftIndex: number | null;
  sectionDraftName: string;
  sectionDraftBusy: boolean;
  canEditTask: (task: Task) => boolean;
  canCreateInColumn: (column: KanbanColumn) => boolean;
  canReceiveInColumn: (column: KanbanColumn) => boolean;
  onCreateInColumn: (column: KanbanColumn, payload: KanbanCreatePayload) => Promise<void>;
  onMoveTask: (task: Task, source: KanbanColumn, target: KanbanColumn) => Promise<void>;
  onSetColumnOrder: (column: KanbanColumn, taskIds: string[]) => Promise<void>;
  onStartAddSection: (index: number) => void;
  onSectionDraftNameChange: (name: string) => void;
  onSubmitSectionDraft: () => Promise<void>;
  onCancelSectionDraft: () => void;
  onRenameSection: (sectionId: string, name: string) => Promise<void>;
  onDeleteSection: (sectionId: string) => Promise<void>;
  onReorderSections: (sectionIds: string[]) => Promise<void>;
  onSelectTask: (taskId: string) => void;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
  onSaveTaskSchedule: (
    taskId: string,
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onSaveChildTaskSchedule: (
    targetTaskId: string,
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onCreateTask: (input: CreateTaskInput) => Promise<unknown>;
  onCreateChildTask: (
    taskId: string,
    title: string,
    extras?: Partial<Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone" | "assignee_id" | "cli_assignee" | "priority" | "parent_task_id">>,
  ) => Promise<void>;
  onUpdateChildTask: (
    targetTaskId: string,
    patch: Partial<Pick<Task, "due_at" | "title" | "priority" | "parent_task_id" | "position">>,
  ) => Promise<void>;
  onDeleteChildTask: (targetTaskId: string) => Promise<void>;
  onAddTaskDependencies: (
    taskId: string,
    targets: import("./types").TaskDependencyTarget[],
    targetTaskId?: string | null,
  ) => Promise<void>;
  pickerTasks?: Task[];
  onPurgeTask: (taskId: string) => Promise<void>;
  onNotice: NoticeHandler;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [taskMenu, setTaskMenu] = useState<{
    task: Task;
    x: number;
    y: number;
  } | null>(null);
  const [activeCard, setActiveCard] = useState<Task | null>(null);
  const columnsById = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns],
  );
  const labelById = useMemo(
    () => new Map(labels.map((label) => [label.id, label])),
    [labels],
  );
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.user_id, member])),
    [members],
  );
  const customSectionColumns = useMemo(
    () => columns.filter((column) => column.target.kind === "section"),
    [columns],
  );
  const trailingColumns = useMemo(
    () => columns.filter((column) => column.target.kind !== "section"),
    [columns],
  );

  async function handleDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    if (event.active.data.current?.type === "section") {
      if (!canManageSections || event.active.id === event.over.id) return;
      const orderedKeys = customSectionColumns.map((column) =>
        column.target.kind === "section" ? customGroupKey(column.target.sectionId) : "");
      const activeKey = String(
        event.active.data.current.groupKey
          ?? event.active.data.current.sectionId
          ?? "",
      );
      const targetColumnId = String(event.over.data.current?.columnId ?? "");
      const target = columnsById.get(targetColumnId);
      const overKey = String(
        event.over.data.current?.groupKey
          ?? (target?.target.kind === "section"
            ? customGroupKey(target.target.sectionId)
            : ""),
      );
      const from = orderedKeys.indexOf(activeKey);
      const to = orderedKeys.indexOf(overKey);
      if (from < 0 || to < 0 || from === to) return;
      try {
        await onReorderSections(arrayMove(orderedKeys, from, to));
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "分组排序失败，请重试");
      }
      return;
    }
    const taskId = String(event.active.data.current?.taskId ?? "");
    const sourceId = String(event.active.data.current?.columnId ?? "");
    const targetId = String(event.over.data.current?.columnId ?? "");
    const task = columnsById.get(sourceId)?.tasks.find((item) => item.id === taskId);
    const source = columnsById.get(sourceId);
    const target = columnsById.get(targetId);
    if (!task || !source || !target || !online || !canEditTask(task)) return;

    try {
      if (source.id !== target.id) {
        await onMoveTask(task, source, target);
        return;
      }
      if (!customSort || event.active.id === event.over.id) return;
      const overTaskId = String(event.over.data.current?.taskId ?? "");
      const from = source.tasks.findIndex((item) => item.id === taskId);
      const to = source.tasks.findIndex((item) => item.id === overTaskId);
      if (from < 0 || to < 0) return;
      await onSetColumnOrder(source, arrayMove(source.tasks, from, to).map((item) => item.id));
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "看板移动失败，请重试");
    }
  }

  function handleDragStart(event: DragStartEvent) {
    if (event.active.data.current?.type === "section") {
      setActiveCard(null);
      return;
    }
    const taskId = String(event.active.data.current?.taskId ?? "");
    const columnId = String(event.active.data.current?.columnId ?? "");
    setActiveCard(
      columnsById.get(columnId)?.tasks.find((task) => task.id === taskId) ?? null,
    );
  }

  const renderColumn = (column: KanbanColumn) => (
    <KanbanColumnView
      key={column.id}
      column={column}
      labels={labels}
      members={members}
      labelById={labelById}
      memberById={memberById}
      labelPermissionLevels={labelPermissionLevels}
      userLabelOrder={userLabelOrder}
      currentUserId={currentUserId}
      defaultAssigneeId={defaultAssigneeId}
      selectedTaskId={selectedTaskId}
      online={online}
      now={now}
      showLabels={showLabels}
      showHours={showHours}
      customSort={customSort}
      customGrouping={customGrouping}
      canEditTask={canEditTask}
      canCreate={canCreateInColumn(column)}
      canReceive={canReceiveInColumn(column)}
      canManageSection={canManageSections && column.target.kind === "section"}
      sectionIndex={customSectionColumns.findIndex((item) => item.id === column.id)}
      onCreate={onCreateInColumn}
      onStartAddSection={onStartAddSection}
      onRenameSection={onRenameSection}
      onDeleteSection={onDeleteSection}
      onSelectTask={onSelectTask}
      onUpdateTask={onUpdateTask}
      onError={onNotice}
      onContextMenu={(task, x, y) => {
        onSelectTask(task.id);
        setTaskMenu({ task, x, y });
      }}
    />
  );

  return (
    <div className="kanban-scroll" aria-label="任务看板">
      <DndContext
        sensors={sensors}
        collisionDetection={kanbanCollisionDetection}
        onDragStart={handleDragStart}
        onDragCancel={() => setActiveCard(null)}
        onDragEnd={(event) => {
          setActiveCard(null);
          void handleDragEnd(event);
        }}
      >
        <div className="kanban-board">
          {customGrouping ? (
            <SortableContext
              items={customSectionColumns.map((column) => `kanban-section:${column.id}`)}
              strategy={horizontalListSortingStrategy}
            >
              {customSectionColumns.map((column, index) => (
                <Fragment key={column.id}>
                  {sectionDraftIndex === index && (
                    <TaskSectionComposer
                      variant="kanban"
                      name={sectionDraftName}
                      busy={sectionDraftBusy}
                      onNameChange={onSectionDraftNameChange}
                      onSubmit={onSubmitSectionDraft}
                      onCancel={onCancelSectionDraft}
                    />
                  )}
                  {renderColumn(column)}
                </Fragment>
              ))}
              {sectionDraftIndex === customSectionColumns.length && (
                <TaskSectionComposer
                  variant="kanban"
                  name={sectionDraftName}
                  busy={sectionDraftBusy}
                  onNameChange={onSectionDraftNameChange}
                  onSubmit={onSubmitSectionDraft}
                  onCancel={onCancelSectionDraft}
                />
              )}
              {sectionDraftIndex === null && (
                <button
                  type="button"
                  className="kanban-new-section"
                  disabled={!canManageSections}
                  onClick={() => onStartAddSection(customSectionColumns.length)}
                >
                  <Plus />
                  <span>新分组</span>
                </button>
              )}
              {trailingColumns.map(renderColumn)}
            </SortableContext>
          ) : columns.map(renderColumn)}
        </div>
        {createPortal(
          <DragOverlay adjustScale={false} dropAnimation={null} zIndex={2200}>
            {activeCard ? (
              <KanbanCardOverlay
                task={activeCard}
                labelById={labelById}
                memberById={memberById}
                now={now}
                showLabels={showLabels}
                showHours={showHours}
              />
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
      {taskMenu && (
        <TaskContextMenu
          task={taskMenu.task}
          workspaceId={workspaceId}
          x={taskMenu.x}
          y={taskMenu.y}
          online={online && (canEditTask(taskMenu.task) || Boolean(taskMenu.task.connector_id))}
          now={now}
          dateTimePreferences={dateTimePreferences}
          onClose={() => setTaskMenu(null)}
          onUpdateTask={onUpdateTask}
          onSaveTaskSchedule={onSaveTaskSchedule}
          onSaveChildTaskSchedule={onSaveChildTaskSchedule}
          onCreateTask={onCreateTask}
          onCreateChildTask={onCreateChildTask}
          onUpdateChildTask={onUpdateChildTask}
          onDeleteChildTask={onDeleteChildTask}
          onPurgeTask={onPurgeTask}
          onExpandChildTasks={() => undefined}
          onNotice={onNotice}
          pickerTasks={pickerTasks ?? columns.flatMap((column) => column.tasks)}
          onAddDependencies={onAddTaskDependencies}
        />
      )}
    </div>
  );
}

function KanbanColumnView({
  column,
  labels,
  members,
  labelById,
  memberById,
  labelPermissionLevels,
  userLabelOrder,
  currentUserId,
  defaultAssigneeId = null,
  selectedTaskId,
  online,
  now,
  showLabels,
  showHours,
  customSort,
  customGrouping,
  canEditTask,
  canCreate,
  canReceive,
  canManageSection,
  sectionIndex,
  onCreate,
  onStartAddSection,
  onRenameSection,
  onDeleteSection,
  onSelectTask,
  onUpdateTask,
  onError,
  onContextMenu,
}: {
  column: KanbanColumn;
  labels: Label[];
  members: Member[];
  labelById: Map<string, Label>;
  memberById: Map<string, Member>;
  labelPermissionLevels: Record<string, LabelPermissionLevel | undefined>;
  userLabelOrder?: Iterable<Pick<UserLabelOrder, "label_id" | "position">>;
  currentUserId: string;
  defaultAssigneeId?: string | null;
  selectedTaskId: string | null;
  online: boolean;
  now: Date;
  showLabels: boolean;
  showHours: boolean;
  customSort: boolean;
  customGrouping: boolean;
  canEditTask: (task: Task) => boolean;
  canCreate: boolean;
  canReceive: boolean;
  canManageSection: boolean;
  sectionIndex: number;
  onCreate: (column: KanbanColumn, payload: KanbanCreatePayload) => Promise<void>;
  onStartAddSection: (index: number) => void;
  onRenameSection: (sectionId: string, name: string) => Promise<void>;
  onDeleteSection: (sectionId: string) => Promise<void>;
  onSelectTask: (taskId: string) => void;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
  onError: NoticeHandler;
  onContextMenu: (task: Task, x: number, y: number) => void;
}) {
  const { active, over, setNodeRef, isOver } = useDroppable({
    id: `kanban-column:${column.id}`,
    data: {
      columnId: column.id,
      ...(column.target.kind === "section"
        ? { groupKey: customGroupKey(column.target.sectionId) }
        : {}),
    },
    disabled: !canReceive,
  });
  const sectionId = column.target.kind === "section" ? column.target.sectionId : null;
  const groupKey = column.target.kind === "section" ? customGroupKey(sectionId) : null;
  const sectionSortable = useSortable({
    id: `kanban-section:${column.id}`,
    data: { type: "section", sectionId, groupKey, columnId: column.id },
    disabled: !canManageSection,
  });
  const [adding, setAdding] = useState(false);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [sectionName, setSectionName] = useState(column.title);
  const renameSubmittingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tokens = useTaskTitleTokens({
    members,
    labels,
    labelPermissionLevels,
    userLabelOrder,
    currentUserId,
    defaultAssigneeId,
    features: { assignee: true, labels: true },
    inputRef,
  });
  const taskIsOverColumn = active?.data.current?.type !== "section"
    && over?.data.current?.columnId === column.id;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (tokens.token) return;
    const payload = tokens.toSubmitPayload();
    if (!payload.title || !canCreate) return;
    const hoursParsed = parseEstimateHoursText(payload.title);
    const nextPayload = hoursParsed
      ? {
          ...payload,
          title: hoursParsed.title.trim() || payload.title,
          estimateHours: hoursParsed.estimateHours,
        }
      : { ...payload, estimateHours: null as number | null };
    if (!nextPayload.title) return;
    // Release the composer immediately; optimistic cache update happens in onCreate.
    tokens.reset();
    setAdding(false);
    void onCreate(column, nextPayload).catch((error) => {
      onError(error instanceof Error ? error.message : "新建失败，请重试");
    });
  }

  async function saveSectionName() {
    if (!sectionId || renameSubmittingRef.current) return;
    const normalized = sectionName.trim();
    if (!normalized) {
      setSectionName(column.title);
      setRenaming(false);
      return;
    }
    if (normalized === column.title) {
      setRenaming(false);
      return;
    }
    renameSubmittingRef.current = true;
    try {
      await onRenameSection(sectionId, normalized);
      setRenaming(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : "重命名失败，请重试");
    } finally {
      renameSubmittingRef.current = false;
    }
  }

  const sortableIds = column.tasks.map((task) => `kanban-card:${column.id}:${task.id}`);

  return (
    <section
      ref={(node) => {
        setNodeRef(node);
        sectionSortable.setNodeRef(node);
      }}
      className={clsx(
        "kanban-column",
        (isOver || taskIsOverColumn) && "drop-target",
        sectionSortable.isDragging && "section-dragging",
      )}
      aria-labelledby={`kanban-column-title-${column.id}`}
      style={{
        transform: CSS.Transform.toString(sectionSortable.transform),
        transition: sectionSortable.transition,
        zIndex: sectionSortable.isDragging ? 3 : undefined,
      }}
    >
      <header className="kanban-column-header">
        {canManageSection && (
          <button
            type="button"
            className="kanban-section-drag-handle"
            aria-label={`拖动分组“${column.title}”`}
            {...sectionSortable.attributes}
            {...sectionSortable.listeners}
          >
            <GripVertical />
          </button>
        )}
        {renaming ? (
          <form
            className="kanban-section-rename"
            onSubmit={(event) => {
              event.preventDefault();
              void saveSectionName();
            }}
          >
            <input
              autoFocus
              value={sectionName}
              maxLength={100}
              onChange={(event) => setSectionName(event.target.value)}
              onBlur={() => void saveSectionName()}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                setSectionName(column.title);
                setRenaming(false);
              }}
            />
          </form>
        ) : (
          <div className="kanban-column-title">
            <h2 id={`kanban-column-title-${column.id}`}>{column.title}</h2>
            <span>{column.tasks.length}</span>
          </div>
        )}
        <div className="kanban-column-actions">
          <button
            type="button"
            aria-label={`在“${column.title}”中新建`}
            disabled={!canCreate}
            onClick={() => setAdding(true)}
          >
            <Plus />
          </button>
          {canManageSection && (
            <button
              type="button"
              aria-label={`管理分组“${column.title}”`}
              aria-haspopup="menu"
              aria-expanded={sectionMenuOpen}
              onClick={() => setSectionMenuOpen((value) => !value)}
            >
              <Ellipsis />
            </button>
          )}
          {canManageSection && sectionMenuOpen && (
            <div className="task-section-menu kanban-section-menu" role="menu">
              {sectionId && (
                <button
                  role="menuitem"
                  onClick={() => {
                    setSectionMenuOpen(false);
                    setSectionName(column.title);
                    setRenaming(true);
                  }}
                >
                  重命名
                </button>
              )}
              <button
                role="menuitem"
                onClick={() => {
                  setSectionMenuOpen(false);
                  onStartAddSection(sectionIndex);
                }}
              >
                在左侧添加分组
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setSectionMenuOpen(false);
                  onStartAddSection(sectionIndex + 1);
                }}
              >
                在右侧添加分组
              </button>
              {sectionId && (
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setSectionMenuOpen(false);
                    if (window.confirm(`删除分组“${column.title}”？任务和笔记会移至未分组。`)) {
                      void onDeleteSection(sectionId).catch((error) =>
                        onError(error instanceof Error ? error.message : "删除分组失败，请重试"));
                    }
                  }}
                >
                  删除
                </button>
              )}
            </div>
          )}
        </div>
      </header>
      {adding && (
        <form className="kanban-quick-add" onSubmit={(event) => void submit(event)}>
          <div className="task-title-token-field">
            <input
              ref={inputRef}
              autoFocus
              value={tokens.title}
              aria-label={`添加任务至“${column.title}”`}
              placeholder="添加任务"
              onChange={tokens.handleChange}
              onKeyDown={(event) => {
                if (tokens.handleKeyDown(event)) return;
                if (event.key === "Escape") {
                  tokens.reset();
                  setAdding(false);
                }
              }}
              onBlur={() => {
                const onlyDefaultAssignee = !tokens.assigneeId
                  || tokens.assigneeId === (defaultAssigneeId ?? null);
                if (!tokens.title.trim() && onlyDefaultAssignee && tokens.labelIds.length === 0) {
                  tokens.reset();
                  setAdding(false);
                }
              }}
            />
            {tokens.token && (
              <TaskTitleTokenMenu
                kind={tokens.token.kind}
                assigneeCandidates={tokens.assigneeCandidates}
                labelCandidates={tokens.labelCandidates}
                activeIndex={tokens.activeIndex}
                onSelectAssignee={tokens.selectAssignee}
                onSelectLabel={tokens.selectLabel}
              />
            )}
          </div>
          <TaskTitleTokenChips
            assignee={tokens.assignee}
            labels={tokens.selectedLabels}
            onRemoveAssignee={tokens.removeAssignee}
            onRemoveLabel={tokens.removeLabel}
          />
        </form>
      )}
      <div className="kanban-column-body">
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {column.tasks.map((task) => (
            <KanbanCard
              key={`${column.id}:${task.id}`}
              columnId={column.id}
              task={task}
              labelById={labelById}
              memberById={memberById}
              selected={selectedTaskId === task.id}
              online={online && canEditTask(task)}
              now={now}
              showLabels={showLabels}
              showHours={showHours}
              draggable={online && canEditTask(task) && (
                (customGrouping && column.target.kind === "section")
                || customSort
                || !["created", "completed"].includes(column.target.kind)
              )}
              onSelectTask={onSelectTask}
              onUpdateTask={onUpdateTask}
              onError={onError}
              onContextMenu={onContextMenu}
            />
          ))}
        </SortableContext>
      </div>
    </section>
  );
}

function resolveTaskLabels(task: Task, labelById: Map<string, Label>) {
  const result: Label[] = [];
  for (const labelId of task.label_ids) {
    const label = labelById.get(labelId);
    if (label) result.push(label);
  }
  return result;
}

function KanbanCardAssignee({ member }: { member: Member }) {
  const showContactNames = useShowContactNames();
  const name = member.profile?.display_name ?? "团队成员";
  return (
    <span className="task-assignee kanban-card-assignee">
      <MemberAvatar
        member={member}
        className="kanban-card-avatar"
        title={`负责人：${name}`}
      />
      {showContactNames && (
        <span className="task-assignee-name">
          {formatContactDisplayName(name)}
        </span>
      )}
    </span>
  );
}

const KanbanCard = memo(function KanbanCard({
  columnId,
  task,
  labelById,
  memberById,
  selected,
  online,
  now,
  showLabels,
  showHours,
  draggable,
  onSelectTask,
  onUpdateTask,
  onError,
  onContextMenu,
}: {
  columnId: string;
  task: Task;
  labelById: Map<string, Label>;
  memberById: Map<string, Member>;
  selected: boolean;
  online: boolean;
  now: Date;
  showLabels: boolean;
  showHours: boolean;
  draggable: boolean;
  onSelectTask: (taskId: string) => void;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
  onError: NoticeHandler;
  onContextMenu: (task: Task, x: number, y: number) => void;
}) {
  const sortableId = `kanban-card:${columnId}:${task.id}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    data: { taskId: task.id, columnId },
    disabled: !draggable,
  });
  const taskLabels = showLabels ? resolveTaskLabels(task, labelById) : [];
  const assignee = task.assignee_id ? memberById.get(task.assignee_id) : undefined;
  const dueStatus = getDueStatus(task.due_at, now);
  const hoursLabel = showHours
    ? formatHoursList(task.estimate_hours, task.actual_hours)
    : null;
  return (
    <article
      ref={setNodeRef}
      className={clsx(
        "kanban-card",
        selected && "selected",
        task.status === "completed" && task.kind !== "note" && "completed",
        draggable && "is-draggable",
        isDragging && "dragging",
      )}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        "--priority-color": getPriorityOption(task.priority).color,
      } as CSSProperties}
      aria-label={draggable
        ? `拖动${task.kind === "note" ? "笔记" : "任务"}“${task.title}”`
        : undefined}
      onClick={() => onSelectTask(task.id)}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(task, event.clientX, event.clientY);
      }}
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
    >
      {draggable && (
        <span className="kanban-card-drag" aria-hidden="true">
          <GripVertical />
        </span>
      )}
      <div className="kanban-card-main">
        {task.kind === "note" ? (
          <span className="kanban-note-icon" aria-label="笔记"><NotebookPen /></span>
        ) : (
          <button
            type="button"
            className="kanban-checkbox"
            aria-label={task.status === "completed" ? "标记未完成" : "完成任务"}
            disabled={!online}
            onClick={(event) => {
              event.stopPropagation();
              void onUpdateTask(task.id, {
                status: task.status === "completed" ? "open" : "completed",
                completed_at: task.status === "completed" ? null : new Date().toISOString(),
              }).catch((error) => {
                onError(error instanceof Error ? error.message : "任务更新失败，请重试", "error");
              });
            }}
          >
            {task.status === "completed" ? <Check /> : <Circle />}
          </button>
        )}
        <span className="kanban-card-content">
          <span className="kanban-card-title">{task.title}</span>
        </span>
      </div>
      <div className="kanban-card-meta">
        {dueStatus && <time className={dueStatus.overdue ? "overdue" : ""}>{dueStatus.label}</time>}
        {hoursLabel && <span className="task-hours">{hoursLabel}</span>}
        {task.children.length > 0 && (
          <span>{task.children.filter((childTask) => (childTask.status === "completed")).length}/{task.children.length}</span>
        )}
        {showLabels && taskLabels.slice(0, 2).map((label) => (
          <span
            key={label.id}
            className="kanban-card-label"
            style={{ "--kanban-label-color": label.color } as CSSProperties}
          >
            <i />{label.name}
          </span>
        ))}
        {assignee && <KanbanCardAssignee member={assignee} />}
        {task.cli_assignee && (
          <AiCliAvatar
            tool={task.cli_assignee}
            className="kanban-card-avatar"
            title={`负责人：${aiCliLabel(task.cli_assignee)}`}
          />
        )}
      </div>
    </article>
  );
});

function KanbanCardOverlay({
  task,
  labelById,
  memberById,
  now,
  showLabels,
  showHours,
}: {
  task: Task;
  labelById: Map<string, Label>;
  memberById: Map<string, Member>;
  now: Date;
  showLabels: boolean;
  showHours: boolean;
}) {
  const taskLabels = showLabels ? resolveTaskLabels(task, labelById) : [];
  const assignee = task.assignee_id ? memberById.get(task.assignee_id) : undefined;
  const dueStatus = task.status === "completed" ? null : getDueStatus(task.due_at, now);
  const hoursLabel = showHours
    ? formatHoursList(task.estimate_hours, task.actual_hours)
    : null;
  return (
    <article
      className={clsx(
        "kanban-card",
        "kanban-card-overlay",
        task.status === "completed" && task.kind !== "note" && "completed",
      )}
      style={{
        "--priority-color": getPriorityOption(task.priority).color,
      } as CSSProperties}
      aria-hidden="true"
    >
      <div className="kanban-card-main">
        {task.kind === "note" ? (
          <span className="kanban-note-icon"><NotebookPen /></span>
        ) : (
          <span className="kanban-checkbox">
            {task.status === "completed" ? <Check /> : <Circle />}
          </span>
        )}
        <span className="kanban-card-content">
          <span className="kanban-card-title">{task.title}</span>
        </span>
      </div>
      <div className="kanban-card-meta">
        {dueStatus && <time className={dueStatus.overdue ? "overdue" : ""}>{dueStatus.label}</time>}
        {hoursLabel && <span className="task-hours">{hoursLabel}</span>}
        {task.children.length > 0 && (
          <span>{task.children.filter((childTask) => (childTask.status === "completed")).length}/{task.children.length}</span>
        )}
        {showLabels && taskLabels.slice(0, 2).map((label) => (
          <span
            key={label.id}
            className="kanban-card-label"
            style={{ "--kanban-label-color": label.color } as CSSProperties}
          >
            <i />{label.name}
          </span>
        ))}
        {assignee && <KanbanCardAssignee member={assignee} />}
        {task.cli_assignee && (
          <AiCliAvatar
            tool={task.cli_assignee}
            className="kanban-card-avatar"
            title={`负责人：${aiCliLabel(task.cli_assignee)}`}
          />
        )}
      </div>
    </article>
  );
}
