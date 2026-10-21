import clsx from "clsx";
import { Check, Search, UserRound } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AiCliAvatar } from "./AiCliAvatar";
import { MemberAvatar } from "./MemberAvatar";
import { aiCliLabel, sameAssignee } from "./lib/aiWork";
import { formatContactDisplayName, useShowContactNames } from "./lib/displayPreference";
import type { AiCliTool, AssigneeTarget, Member } from "./types";

export function AssigneePicker({
  members, candidates = members, currentUserId, target, onAssign,
  disabled = false, cliTools = [], resetKey, compact = false, className,
  showName, placeholder, portal = false,
}: {
  members: Member[];
  candidates?: Member[];
  currentUserId: string;
  target: AssigneeTarget;
  onAssign: (target: AssigneeTarget) => Promise<void>;
  disabled?: boolean;
  cliTools?: AiCliTool[];
  resetKey: string;
  compact?: boolean;
  className?: string;
  showName?: boolean;
  placeholder?: string;
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const contactNamesPreference = useShowContactNames();
  const showContactNames = showName ?? contactNamesPreference;
  const assignee = target.kind === "user"
    ? members.find((member) => member.user_id === target.userId)
    : undefined;
  const needle = query.trim().toLowerCase();
  const matchesQuery = (labels: string[]) =>
    !needle || labels.some((label) => label.toLowerCase().includes(needle));
  const showUnassigned = matchesQuery(["不指派"]);
  const filteredCliTools = cliTools.filter((tool) => matchesQuery([aiCliLabel(tool), tool]));
  const filteredCandidates = candidates.filter((member) => {
    const displayName = member.profile?.display_name ?? "团队成员";
    const labels = member.user_id === currentUserId
      ? [displayName, "我"]
      : [displayName];
    return matchesQuery(labels);
  });
  const pinnedCandidate = target.kind === "user"
    ? filteredCandidates.find((member) => member.user_id === target.userId)
    : undefined;
  const restCandidates = pinnedCandidate
    ? filteredCandidates.filter((member) => member.user_id !== pinnedCandidate.user_id)
    : filteredCandidates;
  const hasMatches = showUnassigned || filteredCliTools.length > 0 || filteredCandidates.length > 0;

  useEffect(() => {
    setOpen(false);
    setError("");
  }, [resetKey]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !portal) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(164, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 20;
      const above = rect.top - 20;
      const height = Math.min(280, Math.max(below, above));
      const measured = Math.min(menuRef.current?.offsetHeight ?? 280, height);
      setMenuStyle({ position: "fixed", width,
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        top: below >= measured ? rect.bottom + 8 : Math.max(12, rect.top - measured - 8),
        right: "auto", maxHeight: height,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, portal, query]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function choose(nextTarget: AssigneeTarget) {
    if (saving || disabled) return;
    if (sameAssignee(target, nextTarget)) {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onAssign(nextTarget);
      setOpen(false);
      triggerRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "负责人保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  function moveMenuFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]:not(:disabled)',
      ),
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : items.length - 1
      : (currentIndex + direction + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  const assigneeName = target.kind === "cli"
    ? aiCliLabel(target.tool)
    : assignee?.profile?.display_name ?? "未指派";
  const showAssigneeName = showContactNames && Boolean(assignee);

  function renderMemberOption(member: (typeof candidates)[number]) {
    return (
      <button
        key={member.user_id}
        type="button"
        role="menuitemradio"
        aria-checked={target.kind === "user" && target.userId === member.user_id}
        disabled={disabled || saving}
        onClick={() => void choose({ kind: "user", userId: member.user_id })}
      >
        <MemberAvatar member={member} className="assignee-menu-avatar" />
        <span>{member.user_id === currentUserId ? "我" : member.profile?.display_name ?? "团队成员"}</span>
        <Check className="assignee-selected-icon" />
      </button>
    );
  }

  const menu = (
  <div
    ref={menuRef}
    style={portal ? menuStyle : undefined}
    className="task-assignee-menu"
    role="menu"
    aria-label="选择负责人"
    onKeyDown={moveMenuFocus}
  >
    <label className="task-assignee-search">
      <Search aria-hidden="true" />
      <input
        ref={searchRef}
        type="search"
        value={query}
        placeholder="搜索"
        aria-label="搜索负责人"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Escape") {
            return;
          }
          event.stopPropagation();
        }}
      />
    </label>
    <div className="task-assignee-menu-list">
      {showUnassigned && (
        <button
          type="button"
          role="menuitemradio"
          aria-checked={target.kind === "none"}
          disabled={disabled || saving}
          onClick={() => void choose({ kind: "none" })}
        >
          <UserRound className="assignee-none-icon" />
          <span>不指派</span>
          <Check className="assignee-selected-icon" />
        </button>
      )}
      {pinnedCandidate && renderMemberOption(pinnedCandidate)}
      {filteredCliTools.map((tool) => (
        <button
          key={tool}
          type="button"
          role="menuitemradio"
          aria-checked={target.kind === "cli" && target.tool === tool}
          disabled={disabled || saving}
          onClick={() => void choose({ kind: "cli", tool })}
        >
          <AiCliAvatar tool={tool} className="assignee-menu-avatar" />
          <span>{aiCliLabel(tool)}</span>
          <Check className="assignee-selected-icon" />
        </button>
      ))}
      {filteredCliTools.length > 0 && <div className="task-assignee-divider" aria-hidden="true" />}
      {restCandidates.map((member) => renderMemberOption(member))}
      {!needle && candidates.length === 0 && (
        <p className="task-assignee-status">暂无可指派成员</p>
      )}
      {needle && !hasMatches && (
        <p className="task-assignee-status">未找到匹配成员</p>
      )}
      {error && <p className="task-assignee-error" role="alert">{error}</p>}
    </div>
  </div>
  );

  return (
    <div
      className={clsx(
        "task-assignee-control",
        compact && "childTask-assignee-control",
        className,
        showAssigneeName && "has-contact-name",
      )}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className={clsx(
          "task-assignee-trigger",
          open && "active",
          showAssigneeName && "has-contact-name",
        )}
        aria-label={`负责人：${assigneeName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || saving}
        onClick={() => setOpen((value) => !value)}
      >
        {target.kind === "cli" ? (
          <AiCliAvatar tool={target.tool} className="detail-assignee-avatar" />
        ) : assignee ? (
          <MemberAvatar member={assignee} className="detail-assignee-avatar" />
        ) : (
          <UserRound />
        )}
        {showAssigneeName && assignee ? (
          <span className="task-assignee-name">
            {formatContactDisplayName(assignee.profile?.display_name ?? "团队成员")}
          </span>
        ) : placeholder && !assignee && target.kind === "none" ? <span className="task-assignee-name">{placeholder}</span> : null}
      </button>
      {open && (portal ? createPortal(menu, document.body) : menu)}
    </div>
  );
}
