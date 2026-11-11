import { useEffect, useMemo, useRef, useState } from "react";
import { closestCenter, pointerWithin, type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent, type KeyboardCoordinateGetter } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Task } from "./types";
import type { TaskListGroup } from "./lib/taskList";
import { ancestorChain, nextSiblingPosition } from "./lib/taskTree";
import { isOptimisticTaskId } from "./lib/taskCache";
import { resolveTaskTreeDrop, taskDragItemId, type TaskDropPlacement, type TaskTreeDrop, type TaskUpdateOptions } from "./lib/taskTreeDrop";

export function useTaskListTreeDrag(input: {
  tasks: Task[];
  groups: TaskListGroup[];
  listKey: string;
  enabled: boolean;
  manualOrder: boolean;
  canPlaceInSection?: boolean;
  canEdit: (task: Task) => boolean;
  canPersistOrder: (tasks: Task[]) => string[];
  onUpdate: (id: string, patch: Partial<Task>, options?: TaskUpdateOptions) => Promise<void>;
  onExpand?: (ids: string[]) => void;
  onHiddenAfterMove?: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drop, setDrop] = useState<TaskTreeDrop | null>(null);
  const [pending, setPending] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const pendingRef = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const keyboardPlacement = useRef<TaskDropPlacement>("before");
  const keyboardTarget = useRef<string | number | null>(null);
  const keyboardOutdent = useRef(false);
  const tasksById = useMemo(() => new Map(input.tasks.map((task) => [task.id, task])), [input.tasks]);
  const latest = useRef({ ...input, tasksById });
  latest.current = { ...input, tasksById };
  const completedMove = useRef<{ taskId: string; parentTaskId: string | null } | null>(null);

  useEffect(() => {
    const move = completedMove.current;
    if (pending || !move || tasksById.get(move.taskId)?.parent_task_id !== move.parentTaskId) return;
    completedMove.current = null;
    const rootId = ancestorChain(input.tasks, move.taskId)[0]?.id;
    if (!input.groups.some((group) => group.tasks.some((task) => task.id === rootId))) latest.current.onHiddenAfterMove?.();
  }, [input.tasks, input.groups, pending, tasksById]);

  useEffect(() => {
    if (!activeId || !drop || drop.placement !== "inside" || drop.reason) return;
    const id = drop.overId;
    const timer = setTimeout(() => setExpandedIds((previous) => new Set([...previous, id])), 600);
    return () => clearTimeout(timer);
  }, [activeId, drop?.overId, drop?.placement, drop?.reason]);

  const collisionDetection: CollisionDetection = (args) => {
    pointer.current = args.pointerCoordinates;
    if (String(args.active.id).startsWith("section:")) {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((container) => !latest.current.tasksById.get(taskDragItemId(container))?.parent_task_id) });
    }
    const candidates = args.droppableContainers.filter((container) => {
      const id = taskDragItemId(container);
      const task = latest.current.tasksById.get(id);
      return id !== taskDragItemId(args.active) && !id.startsWith("section:")
        && ((task && !task.deleted_at && !isOptimisticTaskId(id)) || id.startsWith("group:"));
    });
    if (!args.pointerCoordinates) {
      const target = candidates.find((container) => container.id === keyboardTarget.current);
      return target ? [{ id: target.id }] : [];
    }
    const hits = pointerWithin({ ...args, droppableContainers: candidates });
    // Group rectangles contain their rows; prefer the row under the pointer.
    return hits.filter((hit) => !String(hit.id).startsWith("group:")).length
      ? hits.filter((hit) => !String(hit.id).startsWith("group:")) : hits;
  };

  const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
    if (String(args.context.active?.id).startsWith("section:")) return sortableKeyboardCoordinates(event, args);
    if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
      event.preventDefault();
      keyboardPlacement.current = event.code === "ArrowRight" ? "inside" : "after";
      keyboardOutdent.current = event.code === "ArrowLeft";
      return { ...args.currentCoordinates, x: args.currentCoordinates.x + (event.code === "ArrowRight" ? 16 : -16) };
    }
    if (event.code !== "ArrowUp" && event.code !== "ArrowDown") return;
    event.preventDefault();
    keyboardOutdent.current = false;
    keyboardPlacement.current = event.code === "ArrowDown" ? "after" : "before";
    const { active, collisionRect, droppableContainers, droppableRects } = args.context;
    if (!active || !collisionRect) return;
    const currentRect = droppableRects.get(keyboardTarget.current ?? active.id) ?? collisionRect;
    const candidates = droppableContainers.getEnabled().flatMap((container) => {
      const taskId = taskDragItemId(container);
      const rect = droppableRects.get(container.id);
      if (!rect || taskId === taskDragItemId(active) || !latest.current.tasksById.has(taskId)) return [];
      return (event.code === "ArrowDown" ? rect.top > currentRect.top + 1 : rect.top < currentRect.top - 1)
        ? [{ id: container.id, rect }] : [];
    }).sort((left, right) => event.code === "ArrowDown" ? left.rect.top - right.rect.top : right.rect.top - left.rect.top);
    const target = candidates[0];
    if (!target) return;
    keyboardTarget.current = target.id;
    return { x: args.currentCoordinates.x + target.rect.left - collisionRect.left,
      y: args.currentCoordinates.y + target.rect.top - collisionRect.top };
  };

  function resolve(event: DragMoveEvent | DragEndEvent): TaskTreeDrop | null {
    if (!event.over || !latest.current.enabled || pendingRef.current) return null;
    const taskId = taskDragItemId(event.active);
    const moving = latest.current.tasksById.get(taskId);
    if (!moving || !latest.current.canEdit(moving)) return null;
    let overId = taskDragItemId(event.over);
    const group = latest.current.groups.find((item) => `group:${item.id}` === overId);
    if (group) {
      if (!moving.parent_task_id) return null; // Existing root-to-group sorting remains in the list handler.
      return {
        overId, placement: "after", parentTaskId: null,
        position: nextSiblingPosition(latest.current.tasks.filter((task) => task.workspace_id === moving.workspace_id), null),
        depth: 1, reason: null, label: "提升为顶级任务",
      };
    }
    let over = latest.current.tasksById.get(overId);
    if (!over) return null;
    if (!pointer.current && keyboardOutdent.current && over.parent_task_id) {
      over = latest.current.tasksById.get(over.parent_task_id) ?? over;
      overId = over.id;
    }
    const rect = event.over.rect;
    const ratio = pointer.current ? (pointer.current.y - rect.top) / rect.height : 0;
    const placement = pointer.current
      ? ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside"
      : keyboardPlacement.current;
    const resolved = resolveTaskTreeDrop({ tasks: latest.current.tasks, taskId, overId, placement, canEdit: latest.current.canEdit });
    const result = resolved ? { ...resolved, groupId: event.over.data?.current?.groupId as string | undefined } : null;
    if (result && !result.parentTaskId && !moving.parent_task_id && !latest.current.manualOrder) {
      return { ...result, reason: "当前排序方式不支持手动调整顶级任务位置", label: "当前排序方式不支持手动调整顶级任务位置" };
    }
    return result;
  }

  function start(event: DragStartEvent) {
    pointer.current = null;
    keyboardPlacement.current = "before";
    keyboardTarget.current = null;
    keyboardOutdent.current = false;
    setDrop(null);
    setExpandedIds(new Set());
    setActiveId(taskDragItemId(event.active));
  }
  function move(event: DragMoveEvent) {
    const next = resolve(event);
    setDrop((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }
  function cancel() {
    setActiveId(null);
    setDrop(null);
    setExpandedIds(new Set());
  }
  async function finish(event: DragEndEvent): Promise<boolean> {
    if (pendingRef.current) return true;
    const result = resolve(event);
    const id = taskDragItemId(event.active);
    setActiveId(null);
    setDrop(null);
    if (!result) { setExpandedIds(new Set()); return false; }
    if (result.reason) { setExpandedIds(new Set()); throw new Error(result.reason); }
    const moving = latest.current.tasksById.get(id)!;
    if (moving.parent_task_id === result.parentTaskId && moving.position === result.position && result.parentTaskId) {
      setExpandedIds(new Set());
      return true;
    }
    const targetRootId = ancestorChain(latest.current.tasks, result.overId)[0]?.id;
    const targetGroup = latest.current.groups.find((group) => `group:${group.id}` === result.overId
      || group.tasks.some((task) => task.id === targetRootId));
    let listMove: TaskUpdateOptions["listMove"];
    if (!result.parentTaskId && (latest.current.manualOrder || latest.current.canPlaceInSection) && targetGroup) {
      const ordered = targetGroup.tasks.filter((task) => task.id !== id);
      const index = ordered.findIndex((task) => task.id === result.overId);
      ordered.splice(index < 0 ? ordered.length : index + (result.placement === "after" ? 1 : 0), 0, moving);
      listMove = { listKey: latest.current.listKey, sectionId: targetGroup.sectionId ?? null, taskIds: latest.current.canPersistOrder(ordered) };
    }
    pendingRef.current = true;
    setPending(true);
    try {
      await latest.current.onUpdate(id, { parent_task_id: result.parentTaskId, position: result.position }, { treeMove: true, listMove });
      completedMove.current = { taskId: id, parentTaskId: result.parentTaskId };
      const expanded = result.parentTaskId ? ancestorChain(latest.current.tasks, result.parentTaskId).map((task) => task.id) : [];
      latest.current.onExpand?.(expanded);
      setExpandedIds(new Set(expanded));
      return true;
    } catch (error) {
      setExpandedIds(new Set());
      throw error;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  return { value: { activeId, drop, pending, expandedIds }, collisionDetection, keyboardCoordinates, start, move, cancel, finish };
}
