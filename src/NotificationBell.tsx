import { Bell, CheckCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MemberAvatar } from "./MemberAvatar";
import { notificationHeadline, notificationSummary } from "./lib/notificationCopy";
import { commentRelativeTime } from "./TaskComments";
import type { AppNotification, Member } from "./types";

export function NotificationBell({
  notifications,
  loading,
  online,
  onRead,
  onReadAll,
  onOpenTask,
}: {
  notifications: AppNotification[];
  loading: boolean;
  online: boolean;
  onRead: (id: string) => Promise<void>;
  onReadAll: () => Promise<void>;
  onOpenTask: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((item) => !item.read_at).length;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="notification-anchor" ref={rootRef}>
      <button className="rail-button" aria-label={unread ? `通知，${unread} 条未读` : "通知"}
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Bell />
        {unread > 0 && <span className="notification-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <section className="notification-panel" role="dialog" aria-label="通知">
          <header>
            <strong>通知</strong>
            <button type="button" disabled={!online || unread === 0 || busy}
              onClick={async () => {
                setBusy(true);
                try { await onReadAll(); } finally { setBusy(false); }
              }}><CheckCheck />全部已读</button>
          </header>
          <div className="notification-list">
            {loading && <p className="notification-empty">正在读取通知…</p>}
            {!loading && notifications.length === 0 && (
              <p className="notification-empty">暂无通知</p>
            )}
            {notifications.map((item) => {
              const actor: Member = {
                workspace_id: item.workspace_id,
                user_id: item.actor_id,
                role: "member",
                profile: item.actor,
              };
              const summary = notificationSummary(item);
              return (
                <button type="button" className={item.read_at ? "read" : "unread"} key={item.id}
                  onClick={async () => {
                    if (!item.read_at) await onRead(item.id);
                    setOpen(false);
                    onOpenTask(item.task_id);
                  }}>
                  <MemberAvatar member={actor} className="notification-avatar" />
                  <span className="notification-copy">
                    <span>{notificationHeadline(item)}</span>
                    <em>{item.task?.title || "已删除内容"}</em>
                    {summary ? <span className="notification-summary">{summary}</span> : null}
                  </span>
                  <time dateTime={item.created_at}>{commentRelativeTime(item.created_at)}</time>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
