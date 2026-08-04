import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, Circle, GripVertical, NotebookPen, Plus } from "lucide-react";
import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import clsx from "clsx";
import { AiCliAvatar } from "./AiCliAvatar";
import { MemberAvatar } from "./MemberAvatar";
import { TaskContextMenu } from "./TaskContextMenu";
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
  canEditTask,
  canCreateInColumn,
  canReceiveInColumn,
  onCreateInColumn,
  onMoveTask,
  onSetColumnOrder,
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
  canEditTask: (task: Task) => boolean;
  canCreateInColumn: (column: KanbanColumn) => boolean;
  canReceiveInColumn: (column: KanbanColumn) => boolean;
  onCreateInColumn: (column: KanbanColumn, title: string) => Promise<void>;
  onMoveTask: (task: Task, source: KanbanColumn, target: KanbanColumn) => Promise<void>;
  onSetColumnOrder: (column: KanbanColumn, taskIds: string[]) => Promise<void>;
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
    patch: Partial<Pick<Subtask, "due_at">>,
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
  const columnsById = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns],
  );

  async function handleDragEnd(event: DragEndEvent) {
    if (!event.over) return;
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

  return (
    <div className="kanban-scroll" aria-label="任务看板">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void handleDragEnd(event)}>
        <div className="kanban-board">
          {columns.map((column) => (
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
              canEditTask={canEditTask}
              canCreate={canCreateInColumn(column)}
              canReceive={canReceiveInColumn(column)}
              onCreate={onCreateInColumn}
              onSelectTask={onSelectTask}
              onUpdateTask={onUpdateTask}
              onError={onNotice}
              onContextMenu={(task, x, y) => {
                onSelectTask(task.id);
                setTaskMenu({ task, x, y });
              }}
            />
          ))}
        </div>
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
  canEditTask,
  canCreate,
  canReceive,
  onCreate,
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
  canEditTask: (task: Task) => boolean;
  canCreate: boolean;
  canReceive: boolean;
  onCreate: (column: KanbanColumn, title: string) => Promise<void>;
  onSelectTask: (taskId: string) => void;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
  onError: (message: string) => void;
  onContextMenu: (task: Task, x: number, y: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `kanban-column:${column.id}`,
    data: { columnId: column.id },
    disabled: !canReceive,
  });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

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

  const sortableIds = column.tasks.map((task) => `kanban-card:${column.id}:${task.id}`);

  return (
    <section
      ref={setNodeRef}
      className={clsx("kanban-column", isOver && "drop-target")}
      aria-labelledby={`kanban-column-title-${column.id}`}
    >
      <header className="kanban-column-header">
        <div>
          <h2 id={`kanban-column-title-${column.id}`}>{column.title}</h2>
          <span>{column.tasks.length}</span>
        </div>
        <button
          type="button"
          aria-label={`在“${column.title}”中新建`}
          disabled={!canCreate}
          onClick={() => setAdding(true)}
        >
          <Plus />
        </button>
      </header>
      {adding && (
        <form className="kanban-quick-add" onSubmit={(event) => void submit(event)}>
          <input
            autoFocus
            value={title}
            disabled={busy}
            aria-label={`添加任务至“${column.title}”`}
            placeholder={column.target.kind === "note" ? "添加笔记" : "添加任务"}
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
                customSort || !["created", "note", "completed"].includes(column.target.kind)
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
