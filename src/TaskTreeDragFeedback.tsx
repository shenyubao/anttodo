import { createContext, useContext } from "react";
import type { TaskTreeDrop } from "./lib/taskTreeDrop";

export const TaskTreeDragContext = createContext<{
  activeId: string | null;
  drop: TaskTreeDrop | null;
  pending: boolean;
  expandedIds: ReadonlySet<string>;
}>({ activeId: null, drop: null, pending: false, expandedIds: new Set() });

export function TaskTreeDropIndicator({ taskId, groupId }: { taskId: string; groupId?: string }) {
  const { drop } = useContext(TaskTreeDragContext);
  if (!drop || drop.overId !== taskId || (drop.groupId && drop.groupId !== groupId)) return null;
  return <span
    className={`task-tree-drop task-tree-drop-${drop.placement}${drop.reason ? " is-invalid" : ""}`}
    style={{ "--drop-inset": `${40 + (drop.depth - 1) * 16}px` } as React.CSSProperties}
    data-drop-placement={drop.placement}
    data-drop-valid={!drop.reason}
    aria-hidden="true"
  ><span className="task-tree-drop-label">{drop.label}</span></span>;
}
