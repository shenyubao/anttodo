import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { isOptimisticTaskId } from "./lib/taskCache";
import { childrenOf, siblingReorderPatch, taskParentId } from "./lib/taskTree";
import type { Task } from "./types";

export type SortableTaskTreeDragHandle = {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
};

export function SortableTaskTree({
  tasks,
  parentId,
  collapsedIds,
  disabled = false,
  embedded = false,
  canDragItem,
  onReorder,
  renderRow,
}: {
  tasks: readonly Task[];
  parentId: string;
  collapsedIds: ReadonlySet<string>;
  disabled?: boolean;
  embedded?: boolean;
  canDragItem?: (task: Task) => boolean;
  onReorder?: (taskId: string, parentTaskId: string | null, position: number) => void;
  renderRow: (input: {
    task: Task;
    depth: number;
    dragHandle: SortableTaskTreeDragHandle | null;
  }) => ReactNode;
}) {
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const collisionDetection = useMemo<CollisionDetection>(() => (args) => {
    const activeId = String(args.active.id);
    const active = tasksRef.current.find((item) => item.id === activeId);
    const siblingIds = new Set(
      childrenOf(tasksRef.current, taskParentId(active ?? { parent_task_id: parentId }))
        .map((item) => item.id),
    );
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((container) => (
        siblingIds.has(String(container.id))
      )),
    });
  }, [parentId]);

  function handleDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const patch = siblingReorderPatch(
      tasksRef.current,
      String(event.active.id),
      String(event.over.id),
    );
    if (!patch) return;
    onReorder?.(String(event.active.id), patch.parent_task_id, patch.position);
  }

  const tree = (
    <SortableTaskTreeGroup
      tasks={tasks}
      parentId={parentId}
      depth={1}
      collapsedIds={collapsedIds}
      disabled={disabled}
      canDragItem={canDragItem}
      renderRow={renderRow}
    />
  );
  if (embedded) return tree;
  return (
    <DndContext
      id={`child-tree:${parentId}`}
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragEnd={handleDragEnd}
    >
      {tree}
    </DndContext>
  );
}

function SortableTaskTreeGroup({
  tasks,
  parentId,
  depth,
  collapsedIds,
  disabled,
  canDragItem,
  renderRow,
}: {
  tasks: readonly Task[];
  parentId: string;
  depth: number;
  collapsedIds: ReadonlySet<string>;
  disabled: boolean;
  canDragItem?: (task: Task) => boolean;
  renderRow: (input: {
    task: Task;
    depth: number;
    dragHandle: SortableTaskTreeDragHandle | null;
  }) => ReactNode;
}) {
  const siblings = childrenOf(tasks, parentId);
  if (siblings.length === 0) return null;
  return (
    <SortableContext
      items={siblings.map((task) => task.id)}
      strategy={verticalListSortingStrategy}
    >
      {siblings.map((task) => (
        <SortableTaskTreeNode
          key={task.id}
          task={task}
          tasks={tasks}
          depth={depth}
          siblingCount={siblings.length}
          collapsedIds={collapsedIds}
          disabled={disabled}
          canDragItem={canDragItem}
          renderRow={renderRow}
        />
      ))}
    </SortableContext>
  );
}

function SortableTaskTreeNode({
  task,
  tasks,
  depth,
  siblingCount,
  collapsedIds,
  disabled,
  canDragItem,
  renderRow,
}: {
  task: Task;
  tasks: readonly Task[];
  depth: number;
  siblingCount: number;
  collapsedIds: ReadonlySet<string>;
  disabled: boolean;
  canDragItem?: (task: Task) => boolean;
  renderRow: (input: {
    task: Task;
    depth: number;
    dragHandle: SortableTaskTreeDragHandle | null;
  }) => ReactNode;
}) {
  const dragEnabled = !disabled
    && siblingCount > 1
    && !isOptimisticTaskId(task.id)
    && (canDragItem?.(task) ?? true);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !dragEnabled });
  const collapsed = collapsedIds.has(task.id);
  const hasChildren = childrenOf(tasks, task.id).length > 0;

  return (
    <div
      ref={setNodeRef}
      className={clsx("sortable-task-tree-item", isDragging && "dragging")}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      } as CSSProperties}
    >
      {renderRow({
        task,
        depth,
        dragHandle: dragEnabled ? { attributes, listeners } : null,
      })}
      {!collapsed && hasChildren && (
        <SortableTaskTreeGroup
          tasks={tasks}
          parentId={task.id}
          depth={depth + 1}
          collapsedIds={collapsedIds}
          disabled={disabled}
          canDragItem={canDragItem}
          renderRow={renderRow}
        />
      )}
    </div>
  );
}
