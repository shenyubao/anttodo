import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  applyTitleTokenSelection,
  detectTitleTokenAtCaret,
  filterAssigneeCandidates,
  filterLabelCandidates,
  memberDisplayName,
  type DetectedTitleToken,
  type TitleTokenFeatures,
} from "./lib/taskTitleTokens";
import type {
  Label,
  LabelPermissionLevel,
  Member,
  UserLabelOrder,
} from "./types";

export type TaskTitleTokenSubmit = {
  title: string;
  assigneeId: string | null;
  labelIds: string[];
};

export function useTaskTitleTokens({
  members,
  labels,
  labelPermissionLevels,
  userLabelOrder,
  currentUserId,
  defaultAssigneeId = null,
  features,
  inputRef,
}: {
  members: Member[];
  labels: Label[];
  labelPermissionLevels: Record<string, LabelPermissionLevel | undefined>;
  userLabelOrder?: Iterable<Pick<UserLabelOrder, "label_id" | "position">>;
  currentUserId: string;
  defaultAssigneeId?: string | null;
  features: TitleTokenFeatures;
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
}) {
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(defaultAssigneeId ?? null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [token, setToken] = useState<DetectedTitleToken | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setAssigneeId(defaultAssigneeId ?? null);
  }, [defaultAssigneeId]);

  const assignee = useMemo(
    () => (assigneeId ? members.find((member) => member.user_id === assigneeId) ?? null : null),
    [assigneeId, members],
  );

  const selectedLabels = useMemo(() => {
    const byId = new Map(labels.map((label) => [label.id, label]));
    return labelIds.flatMap((id) => {
      const label = byId.get(id);
      return label ? [label] : [];
    });
  }, [labelIds, labels]);

  const assigneeCandidates = useMemo(() => {
    if (!token || token.kind !== "assignee") return [];
    return filterAssigneeCandidates(members, currentUserId, token.query);
  }, [currentUserId, members, token]);

  const labelCandidates = useMemo(() => {
    if (!token || token.kind !== "label") return [];
    return filterLabelCandidates(
      labels,
      labelPermissionLevels,
      token.query,
      userLabelOrder,
      labelIds,
    );
  }, [labelIds, labelPermissionLevels, labels, token, userLabelOrder]);

  const candidates = token?.kind === "assignee" ? assigneeCandidates : labelCandidates;

  useEffect(() => {
    setActiveIndex(0);
  }, [token?.kind, token?.query, token?.start]);

  function syncToken(value: string, caret: number) {
    setToken(detectTitleTokenAtCaret(value, caret, features));
  }

  function focusCaret(nextCaret: number) {
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function handleChange(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const value = event.target.value;
    setTitle(value);
    syncToken(value, event.target.selectionStart ?? value.length);
  }

  function selectAssignee(member: Member) {
    if (!token || token.kind !== "assignee") return;
    const caret = inputRef.current?.selectionStart ?? title.length;
    const next = applyTitleTokenSelection(title, caret, token);
    setTitle(next.title);
    setAssigneeId(member.user_id);
    setToken(null);
    focusCaret(next.caret);
  }

  function selectLabel(label: Label) {
    if (!token || token.kind !== "label") return;
    const caret = inputRef.current?.selectionStart ?? title.length;
    const next = applyTitleTokenSelection(title, caret, token);
    setTitle(next.title);
    setLabelIds((current) => (current.includes(label.id) ? current : [...current, label.id]));
    setToken(null);
    focusCaret(next.caret);
  }

  function selectActiveCandidate() {
    if (!token || candidates.length === 0) return false;
    const index = Math.min(activeIndex, candidates.length - 1);
    if (token.kind === "assignee") {
      selectAssignee(assigneeCandidates[index]!);
    } else {
      selectLabel(labelCandidates[index]!);
    }
    return true;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (!token) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      setToken(null);
      return true;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (candidates.length === 0) return true;
      setActiveIndex((current) => (current + 1) % candidates.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (candidates.length === 0) return true;
      setActiveIndex((current) => (current - 1 + candidates.length) % candidates.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (candidates.length === 0) {
        event.preventDefault();
        setToken(null);
        return true;
      }
      event.preventDefault();
      selectActiveCandidate();
      return true;
    }
    return false;
  }

  function removeAssignee() {
    setAssigneeId(null);
  }

  function removeLabel(labelId: string) {
    setLabelIds((current) => current.filter((id) => id !== labelId));
  }

  function reset() {
    setTitle("");
    setAssigneeId(defaultAssigneeId ?? null);
    setLabelIds([]);
    setToken(null);
    setActiveIndex(0);
  }

  function toSubmitPayload(): TaskTitleTokenSubmit {
    return {
      title: title.trim(),
      assigneeId,
      labelIds: [...labelIds],
    };
  }

  return {
    title,
    setTitle,
    assigneeId,
    labelIds,
    assignee,
    selectedLabels,
    token,
    activeIndex,
    assigneeCandidates,
    labelCandidates,
    memberDisplayName,
    handleChange,
    handleKeyDown,
    selectAssignee,
    selectLabel,
    removeAssignee,
    removeLabel,
    reset,
    toSubmitPayload,
    setAssigneeId,
    setLabelIds,
  };
}
