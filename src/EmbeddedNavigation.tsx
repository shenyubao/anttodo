import {
  Check,
  ChevronDown,
  Download,
  GripVertical,
  LogOut,
  Plus,
  Settings,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ConnectorSyncButton } from "./ConnectorSyncButton";
import { initials } from "./MemberAvatar";
import { NotificationBell } from "./NotificationBell";
import type { FeatureModulePreferences } from "./lib/featureModulePreferences";
import {
  visiblePrimaryNavigationItems,
  type PrimaryAppSection,
} from "./lib/primaryNavigation";
import type { AppNotification, Workspace, WorkspaceBundle } from "./types";

export function EmbeddedNavigation({
  activeSection,
  featureModulePreferences,
  online,
  userName,
  avatarUrl,
  workspaces,
  workspaceId,
  connectors,
  notifications,
  notificationsLoading,
  searchOpen,
  onWorkspaceChange,
  onCreateWorkspace,
  onSectionChange,
  onSettings,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onOpenNotificationTask,
  onDownloadClient,
  onNotice,
  onSignOut,
}: {
  activeSection: PrimaryAppSection;
  featureModulePreferences: FeatureModulePreferences;
  online: boolean;
  userName: string;
  avatarUrl: string | null;
  workspaces: Workspace[];
  workspaceId: string;
  connectors: WorkspaceBundle["connectors"];
  notifications: AppNotification[];
  notificationsLoading: boolean;
  searchOpen: boolean;
  onWorkspaceChange: (id: string) => void;
  onCreateWorkspace: () => void;
  onSectionChange: (section: PrimaryAppSection) => void;
  onSettings: () => void;
  onMarkNotificationRead: (notificationId: string) => Promise<void>;
  onMarkAllNotificationsRead: () => Promise<void>;
  onOpenNotificationTask: (item: AppNotification) => void;
  onDownloadClient: () => void;
  onNotice: (message: string) => void;
  onSignOut: () => unknown;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [workspaceListOpen, setWorkspaceListOpen] = useState(false);
  const [connectorStatus, setConnectorStatus] = useState({ busy: false, error: false });
  const [position, setPosition] = useState<{ x: number; y: number } | null>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("anttodo:embedded-navigation-position") ?? "null") as {
        x?: unknown;
        y?: unknown;
      } | null;
      return typeof stored?.x === "number" && typeof stored.y === "number"
        ? { x: stored.x, y: stored.y }
        : null;
    } catch {
      return null;
    }
  });
  const [panelPlacement, setPanelPlacement] = useState<"above" | "below">("above");
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const showDownloadClient = !window.anttodoDesktop;
  const unread = useMemo(
    () => notifications.filter((notification) => !notification.read_at).length,
    [notifications],
  );
  const items = useMemo(
    () => visiblePrimaryNavigationItems(featureModulePreferences),
    [featureModulePreferences],
  );

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
        setWorkspaceListOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        setWorkspaceListOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!position) return;
    const keepInsideViewport = () => {
      const root = rootRef.current;
      if (!root) return;
      setPosition((current) => current ? {
        x: Math.min(Math.max(12, current.x), Math.max(12, window.innerWidth - root.offsetWidth - 12)),
        y: Math.min(Math.max(12, current.y), Math.max(12, window.innerHeight - root.offsetHeight - 12)),
      } : null);
    };
    window.addEventListener("resize", keepInsideViewport);
    keepInsideViewport();
    return () => window.removeEventListener("resize", keepInsideViewport);
  }, [position !== null]);

  const closeMore = () => {
    setMoreOpen(false);
    setWorkspaceListOpen(false);
  };

  const clampPosition = (x: number, y: number) => {
    const root = rootRef.current;
    if (!root) return { x, y };
    return {
      x: Math.min(Math.max(12, x), Math.max(12, window.innerWidth - root.offsetWidth - 12)),
      y: Math.min(Math.max(12, y), Math.max(12, window.innerHeight - root.offsetHeight - 12)),
    };
  };

  const savePosition = (next: { x: number; y: number } | null) => {
    setPosition(next);
    if (next) window.localStorage.setItem("anttodo:embedded-navigation-position", JSON.stringify(next));
    else window.localStorage.removeItem("anttodo:embedded-navigation-position");
  };

  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !rootRef.current) return;
    const bounds = rootRef.current.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    closeMore();
    setPosition({ x: bounds.left, y: bounds.top });
  };

  const drag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    setPosition(clampPosition(
      event.clientX - state.offsetX,
      event.clientY - state.offsetY,
    ));
  };

  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPosition((current) => {
      if (current) window.localStorage.setItem(
        "anttodo:embedded-navigation-position",
        JSON.stringify(current),
      );
      return current;
    });
  };

  const moveByKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      savePosition(null);
      return;
    }
    const delta = event.shiftKey ? 30 : 10;
    const direction = {
      ArrowLeft: [-delta, 0],
      ArrowRight: [delta, 0],
      ArrowUp: [0, -delta],
      ArrowDown: [0, delta],
    }[event.key];
    if (!direction || !rootRef.current) return;
    event.preventDefault();
    const bounds = rootRef.current.getBoundingClientRect();
    savePosition(clampPosition(bounds.left + direction[0], bounds.top + direction[1]));
  };

  return (
    <div
      className={clsx("embedded-navigation", position && "is-positioned")}
      ref={rootRef}
      style={position ? { left: position.x, top: position.y } : undefined}
    >
      <button
        type="button"
        className="embedded-navigation-drag-handle"
        aria-label="拖动嵌入导航"
        title="拖动导航；方向键微调，Home 恢复默认位置"
        onPointerDown={beginDrag}
        onPointerMove={drag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={moveByKeyboard}
      >
        <GripVertical />
      </button>
      <nav className="embedded-section-nav" aria-label="嵌入模式主导航">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.section === "search"
            ? searchOpen
            : activeSection === item.section;
          return (
            <button
              key={item.section}
              type="button"
              className={clsx(active && "active")}
              aria-label={item.label}
              aria-current={active && item.section !== "search" ? "page" : undefined}
              aria-pressed={item.section === "search" ? searchOpen : undefined}
              title={item.label}
              onClick={() => onSectionChange(item.section)}
            >
              <Icon />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="embedded-more-anchor">
        <button
          type="button"
          className={clsx("embedded-more-trigger", moreOpen && "active")}
          aria-label={`${userName}的账户与更多`}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          title="账户与更多"
          onClick={() => {
            setMoreOpen((open) => {
              if (!open && rootRef.current) {
                setPanelPlacement(rootRef.current.getBoundingClientRect().top < window.innerHeight / 2
                  ? "below"
                  : "above");
              }
              return !open;
            });
            setWorkspaceListOpen(false);
          }}
        >
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initials(userName)}</span>}
          {unread > 0 && (
            <i className="embedded-more-unread" aria-hidden="true">
              {unread > 99 ? "99+" : unread}
            </i>
          )}
          {(connectorStatus.busy || connectorStatus.error) && (
            <i
              className={clsx(
                "embedded-more-connector-status",
                connectorStatus.busy && "busy",
                connectorStatus.error && "error",
              )}
              aria-hidden="true"
            />
          )}
        </button>
        <section
          className={clsx("embedded-more-panel", panelPlacement === "below" && "below")}
          role="dialog"
          aria-label="账户与更多"
          hidden={!moreOpen}
        >
          <header>
            {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initials(userName)}</span>}
            <div><strong>{userName}</strong></div>
          </header>
          <div className="embedded-more-group">
            <span className="embedded-more-caption">账户</span>
            <button
              type="button"
              className="embedded-more-action"
              aria-expanded={workspaceListOpen}
              onClick={() => setWorkspaceListOpen((open) => !open)}
            >
              <span className="workspace-initial">
                {initials(workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? "团队").slice(0, 1)}
              </span>
              <span><strong>切换团队空间</strong><small>{workspaces.find((workspace) => workspace.id === workspaceId)?.name}</small></span>
              <ChevronDown className={clsx("embedded-more-chevron", workspaceListOpen && "open")} />
            </button>
            {workspaceListOpen && (
              <div className="embedded-workspace-list" role="menu" aria-label="选择团队空间">
                {workspaces.map((workspace) => (
                  <button
                    type="button"
                    key={workspace.id}
                    role="menuitemradio"
                    aria-checked={workspace.id === workspaceId}
                    onClick={() => {
                      onWorkspaceChange(workspace.id);
                      closeMore();
                    }}
                  >
                    <span className="workspace-initial">{initials(workspace.name).slice(0, 1)}</span>
                    <span>{workspace.name}</span>
                    {workspace.id === workspaceId && <Check />}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  disabled={!online}
                  onClick={() => {
                    closeMore();
                    onCreateWorkspace();
                  }}
                >
                  <Plus /><span>创建团队空间</span>
                </button>
              </div>
            )}
          </div>
          <div className="embedded-more-group">
            <span className="embedded-more-caption">协作</span>
            <ConnectorSyncButton
              workspaceId={workspaceId}
              connectors={connectors}
              online={online}
              onNotice={onNotice}
              variant="menu"
              active={moreOpen}
              onStatusChange={setConnectorStatus}
            />
            <NotificationBell
              notifications={notifications}
              loading={notificationsLoading}
              online={online}
              onRead={onMarkNotificationRead}
              onReadAll={onMarkAllNotificationsRead}
              onOpenNotification={(item) => {
                closeMore();
                onOpenNotificationTask(item);
              }}
              variant="menu"
              active={moreOpen}
            />
          </div>
          <div className="embedded-more-group">
            <span className="embedded-more-caption">应用</span>
            {showDownloadClient && (
              <button type="button" className="embedded-more-action" onClick={() => {
                closeMore();
                onDownloadClient();
              }}>
                <Download /><span><strong>下载客户端</strong></span>
              </button>
            )}
            <button type="button" className="embedded-more-action" onClick={() => {
              closeMore();
              onSettings();
            }}>
              <Settings /><span><strong>设置</strong></span>
            </button>
          </div>
          <div className="embedded-more-group embedded-more-session">
            <button type="button" className="embedded-more-action danger" onClick={() => {
              closeMore();
              void onSignOut();
            }}>
              <LogOut /><span><strong>退出登录</strong></span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
