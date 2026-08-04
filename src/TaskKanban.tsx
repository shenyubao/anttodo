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
import { Fragment, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { AiCliAvatar } from "./AiCliAvatar";
import { MemberAvatar } from "./MemberAvatar";
import { TaskContextMenu } from "./TaskContextMenu";
import { TaskSectionComposer } from "./TaskSectionComposer";
import { getPriorityOption } from "./PriorityControl";
import { getDueStatus } from "./lib/dueTime";
import { aiCliLabel } from "./lib/aiWork";
import type { KanbanColumn } from "./lib/taskKanban";
import type {
  DateTimePreferences,
  Label,
  Member,
  ReminderSchedule,
  Subtask,
  Task,
  TaskKind,
  TaskPriority,
} from "./types";

type CreateTaskInput = {
  title: string;
  labelIds: string[];
  description?: string;
  dueAt?: string | null;
  dueTimezone?: string | null;
  priority?: TaskPriority;
  kind?: TaskKind;
  assigneeId?: string | null;
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
  workspaceId,
  selectedTaskId,
  online,
  now,
  dateTimePreferences,
  showLabels,
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
  onCreateTask,
  onCreateSubtask,
  onUpdateSubtask,
  onDeleteSubtask,
  onNotice,
}: {
  columns: KanbanColumn[];
  labels: Label[];
  members: Member[];
  workspaceId: string;
  selectedTaskId: string | null;
  online: boolean;
  now: Date;
  dateTimePreferences: DateTimePreferences;
  showLabels: boolean;
  customSort: boolean;
  customGrouping: boolean;
  canManageSections: boolean;
  sectionDraftIndex: number | null;
  sectionDraftName: string;
  sectionDraftBusy: boolean;
  canEditTask: (task: Task) => boolean;
  canCreateInColumn: (column: KanbanColumn) => boolean;
  canReceiveInColumn: (column: KanbanColumn) => boolean;
  onCreateInColumn: (column: KanbanColumn, title: string) => Promise<void>;
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
  onCreateTask: (input: CreateTaskInput) => Promise<unknown>;
  onCreateSubtask: (
    taskId: string,
    title: string,
    extras?: Partial<Pick<Subtask, "due_at" | "assignee_id" | "cli_assignee">>,
  ) => Promise<void>;
  onUpdateSubtask: (
    subtaskId: string,
    patch: Partial<Pick<Subtask, "due_at" | "title">>,
  ) => Promise<void>;
  onDeleteSubtask: (subtaskId: string) => Promise<void>;
  onNotice: (message: string) => void;
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
  const customSectionColumns = useMemo(
    () => columns.filter((column) =>
      column.target.kind === "section" && column.target.sectionId !== null),
    [columns],
  );
  const ungroupedColumns = useMemo(
    () => columns.filter((column) =>
      column.target.kind === "section" && column.target.sectionId === null),
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
      const activeSectionId = String(event.active.data.current.sectionId ?? "");
      const targetColumnId = String(event.over.data.current?.columnId ?? "");
      const target = columnsById.get(targetColumnId);
      const overSectionId = String(
        event.over.data.current?.sectionId
          ?? (target?.target.kind === "section" ? target.target.sectionId : "")
          ?? "",
      );
      const orderedIds = customSectionColumns.map((column) =>
        column.target.kind === "section" ? column.target.sectionId! : "");
      const from = orderedIds.indexOf(activeSectionId);
      const to = orderedIds.indexOf(overSectionId);
      if (from < 0 || to < 0) return;
      try {
        await onReorderSections(arrayMove(orderedIds, from, to));
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
      selectedTaskId={selectedTaskId}
      online={online}
      now={now}
      showLabels={showLabels}
      customSort={customSort}
      customGrouping={customGrouping}
      canEditTask={canEditTask}
      canCreate={canCreateInColumn(column)}
      canReceive={canReceiveInColumn(column)}
      canManageSection={canManageSections
        && column.target.kind === "section"
        && column.target.sectionId !== null}
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
              {ungroupedColumns.map(renderColumn)}
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
                labels={labels}
                members={members}
                now={now}
                showLabels={showLabels}
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
          online={online && canEditTask(taskMenu.task)}
          now={now}
          dateTimePreferences={dateTimePreferences}
          onClose={() => setTaskMenu(null)}
          onUpdateTask={onUpdateTask}
          onSaveTaskSchedule={onSaveTaskSchedule}
          onCreateTask={onCreateTask}
          onCreateSubtask={onCreateSubtask}
          onUpdateSubtask={onUpdateSubtask}
          onDeleteSubtask={onDeleteSubtask}
          onExpandSubtasks={() => undefined}
          onNotice={onNotice}
        />
      )}
    </div>
  );
}

function KanbanColumnView({
  column,
  labels,
  members,
  selectedTaskId,
  online,
  now,
  showLabels,
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
  selectedTaskId: string | null;
  online: boolean;
  now: Date;
  showLabels: boolean;
  customSort: boolean;
  customGrouping: boolean;
  canEditTask: (task: Task) => boolean;
  canCreate: boolean;
  canReceive: boolean;
  canManageSection: boolean;
  sectionIndex: number;
  onCreate: (column: KanbanColumn, title: string) => Promise<void>;
  onStartAddSection: (index: number) => void;
  onRenameSection: (sectionId: string, name: string) => Promise<void>;
  onDeleteSection: (sectionId: string) => Promise<void>;
  onSelectTask: (taskId: string) => void;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
  onError: (message: string) => void;
  onContextMenu: (task: Task, x: number, y: number) => void;
}) {
  const { active, over, setNodeRef, isOver } = useDroppable({
    id: `kanban-column:${column.id}`,
    data: { columnId: column.id },
    disabled: !canReceive,
  });
  const sectionId = column.target.kind === "section" ? column.target.sectionId : null;
  const sectionSortable = useSortable({
    id: `kanban-section:${column.id}`,
    data: { type: "section", sectionId, columnId: column.id },
    disabled: !canManageSection,
  });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [sectionName, setSectionName] = useState(column.title);
  const renameSubmittingRef = useRef(false);
  const taskIsOverColumn = active?.data.current?.type !== "section"
    && over?.data.current?.columnId === column.id;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value || !canCreate || busy) return;
    setBusy(true);
    try {
      await onCreate(column, value);
      setTitle("");
      setAdding(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : "新建失败，请重试");
    } finally {
      setBusy(false);
    }
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
          {sectionId && (
            <button
              type="button"
              aria-label={`管理分组“${column.title}”`}
              aria-haspopup="menu"
              aria-expanded={sectionMenuOpen}
              disabled={!canManageSection}
              onClick={() => setSectionMenuOpen((value) => !value)}
            >
              <Ellipsis />
            </button>
          )}
          {sectionId && sectionMenuOpen && (
            <div className="task-section-menu kanban-section-menu" role="menu">
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
            </div>
          )}
        </div>
      </header>
      {adding && (
        <form className="kanban-quick-add" onSubmit={(event) => void submit(event)}>
          <input
            autoFocus
            value={title}
            disabled={busy}
            aria-label={`添加任务至“${column.title}”`}
            placeholder="添加任务"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setTitle("");
                setAdding(false);
              }
            }}
            onBlur={() => {
              if (!title.trim() && !busy) setAdding(false);
            }}
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
              labels={labels}
              members={members}
              selected={selectedTaskId === task.id}
              online={online && canEditTask(task)}
              now={now}
              showLabels={showLabels}
              draggable={online && canEditTask(task) && (
                (customGrouping && column.target.kind === "section")
                || customSort
                || !["created", "completed"].includes(column.target.kind)
              )}
              onSelect={() => onSelectTask(task.id)}
              onToggle={() => onUpdateTask(task.id, {
                status: task.status === "completed" ? "open" : "completed",
                completed_at: task.status === "completed" ? null : new Date().toISOString(),
              })}
              onError={onError}
              onContextMenu={(x, y) => onContextMenu(task, x, y)}
            />
          ))}
        </SortableContext>
      </div>
    </section>
  );
}

function KanbanCard({
  columnId,
  task,
  labels,
  members,
  selected,
  online,
  now,
  showLabels,
  draggable,
  onSelect,
  onToggle,
  onError,
  onContextMenu,
}: {
  columnId: string;
  task: Task;
  labels: Label[];
  members: Member[];
  selected: boolean;
  online: boolean;
  now: Date;
  showLabels: boolean;
  draggable: boolean;
  onSelect: () => void;
  onToggle: () => Promise<void>;
  onError: (message: string) => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const sortableId = `kanban-card:${columnId}:${task.id}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    data: { taskId: task.id, columnId },
    disabled: !draggable,
  });
  const taskLabels = labels.filter((label) => task.label_ids.includes(label.id));
  const assignee = members.find((member) => member.user_id === task.assignee_id);
  const dueStatus = getDueStatus(task.due_at, now);
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
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event.clientX, event.clientY);
      }}
      onPointerDown={draggable
        ? (event) => listeners?.onPointerDown?.(event)
        : undefined}
    >
      {draggable && (
        <button
          type="button"
          className="kanban-card-drag"
          aria-label={`拖动${task.kind === "note" ? "笔记" : "任务"}“${task.title}”`}
          {...attributes}
          {...listeners}
        >
          <GripVertical />
        </button>
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
              void onToggle().catch((error) => {
                onError(error instanceof Error ? error.message : "任务更新失败，请重试");
              });
            }}
          >
            {task.status === "completed" ? <Check /> : <Circle />}
          </button>
        )}
        <button type="button" className="kanban-card-content" onClick={onSelect}>
          <span className="kanban-card-title">{task.title}</span>
        </button>
      </div>
      <div className="kanban-card-meta">
        {dueStatus && <time className={dueStatus.overdue ? "overdue" : ""}>{dueStatus.label}</time>}
        {task.subtasks.length > 0 && (
          <span>{task.subtasks.filter((subtask) => subtask.completed).length}/{task.subtasks.length}</span>
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
        {assignee && (
          <MemberAvatar
            member={assignee}
            className="kanban-card-avatar"
            title={`负责人：${assignee.profile?.display_name ?? "团队成员"}`}
          />
        )}
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

function KanbanCardOverlay({
  task,
  labels,
  members,
  now,
  showLabels,
}: {
  task: Task;
  labels: Label[];
  members: Member[];
  now: Date;
  showLabels: boolean;
}) {
  const taskLabels = labels.filter((label) => task.label_ids.includes(label.id));
  const assignee = members.find((member) => member.user_id === task.assignee_id);
  const dueStatus = getDueStatus(task.due_at, now);
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
        {task.subtasks.length > 0 && (
          <span>{task.subtasks.filter((subtask) => subtask.completed).length}/{task.subtasks.length}</span>
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
        {assignee && (
          <MemberAvatar
            member={assignee}
            className="kanban-card-avatar"
            title={`负责人：${assignee.profile?.display_name ?? "团队成员"}`}
          />
        )}
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
