import { X } from "lucide-react";
import { MemberAvatar } from "./MemberAvatar";
import { memberDisplayName } from "./lib/taskTitleTokens";
import type { Label, Member } from "./types";

export function TaskTitleTokenMenu({
  kind,
  assigneeCandidates,
  labelCandidates,
  activeIndex,
  onSelectAssignee,
  onSelectLabel,
}: {
  kind: "assignee" | "label";
  assigneeCandidates: Member[];
  labelCandidates: Label[];
  activeIndex: number;
  onSelectAssignee: (member: Member) => void;
  onSelectLabel: (label: Label) => void;
}) {
  if (kind === "assignee") {
    return (
      <div className="task-title-token-menu" role="listbox" aria-label="选择指派人">
        {assigneeCandidates.length === 0 ? (
          <p>没有匹配的成员</p>
        ) : (
          assigneeCandidates.map((member, index) => (
            <button
              key={member.user_id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelectAssignee(member);
              }}
            >
              <MemberAvatar member={member} className="task-title-token-avatar" />
              <span>{memberDisplayName(member)}</span>
            </button>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="task-title-token-menu" role="listbox" aria-label="选择标签">
      {labelCandidates.length === 0 ? (
        <p>没有匹配的标签</p>
      ) : (
        labelCandidates.map((label, index) => (
          <button
            key={label.id}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelectLabel(label);
            }}
          >
            <span
              className="task-title-token-label-swatch"
              style={{ background: label.color }}
              aria-hidden="true"
            />
            <span>{label.name}</span>
          </button>
        ))
      )}
    </div>
  );
}

export function TaskTitleTokenChips({
  assignee,
  labels,
  disabled,
  onRemoveAssignee,
  onRemoveLabel,
}: {
  assignee: Member | null;
  labels: Label[];
  disabled?: boolean;
  onRemoveAssignee: () => void;
  onRemoveLabel: (labelId: string) => void;
}) {
  if (!assignee && labels.length === 0) return null;

  return (
    <div className="task-title-token-chips">
      {assignee && (
        <button
          type="button"
          className="task-title-token-chip assignee"
          disabled={disabled}
          aria-label={`移除指派人 ${memberDisplayName(assignee)}`}
          onClick={onRemoveAssignee}
        >
          <MemberAvatar member={assignee} className="task-title-token-chip-avatar" />
          <span>{memberDisplayName(assignee)}</span>
          <X aria-hidden="true" />
        </button>
      )}
      {labels.map((label) => (
        <button
          key={label.id}
          type="button"
          className="task-title-token-chip label"
          disabled={disabled}
          aria-label={`移除标签 ${label.name}`}
          onClick={() => onRemoveLabel(label.id)}
        >
          <span
            className="task-title-token-label-swatch"
            style={{ background: label.color }}
            aria-hidden="true"
          />
          <span>{label.name}</span>
          <X aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
