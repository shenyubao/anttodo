import clsx from "clsx";
import { Check, FolderOpen, Minus } from "lucide-react";
import type { CSSProperties } from "react";
import { orderedLabelTreeRows } from "./lib/taskList";
import type { Label, UserLabelOrder } from "./types";

export type LabelTreeMenuSelection = boolean | "mixed";

export function LabelTreeMenuItems({
  labels,
  userLabelOrder,
  selectionFor,
  disabledFor,
  onToggle,
}: {
  labels: Label[];
  userLabelOrder?: Iterable<Pick<UserLabelOrder, "label_id" | "position">>;
  selectionFor: (label: Label) => LabelTreeMenuSelection;
  disabledFor?: (label: Label) => boolean;
  onToggle: (label: Label) => void;
}) {
  return orderedLabelTreeRows(labels, userLabelOrder).map(({ label, depth, hasChildren }) => {
    const selection = selectionFor(label);
    return (
      <button
        key={label.id}
        type="button"
        className={clsx("task-label-tree-menu-item", hasChildren && "has-children")}
        style={{ "--label-tree-depth": depth } as CSSProperties}
        role="menuitemcheckbox"
        aria-checked={selection === "mixed" ? "mixed" : selection}
        disabled={disabledFor?.(label)}
        onClick={() => onToggle(label)}
      >
        <span className="task-label-tree-parent-icon" aria-hidden="true">
          {hasChildren && <FolderOpen />}
        </span>
        <i style={{ background: label.color }} aria-hidden="true" />
        <span className="task-label-tree-name">{label.name}</span>
        {selection === true ? <Check /> : selection === "mixed" ? <Minus /> : null}
      </button>
    );
  });
}
