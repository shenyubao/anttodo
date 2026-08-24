import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  connectorSettingsQueryKey,
  connectorSyncSubtitle,
  invokeConnectorSync,
  isDemoWorkspace,
  manualSyncConnectors,
} from "./lib/connectorAdmin";
import type { Connector } from "./types";

export function ConnectorSyncButton({
  workspaceId,
  connectors,
  online,
  onNotice,
}: {
  workspaceId: string;
  connectors: Connector[];
  online: boolean;
  onNotice: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const syncable = useMemo(() => manualSyncConnectors(connectors), [connectors]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const syncConnector = useCallback(async (connector: Connector) => {
    if (!online || !connector.enabled || busyId) return;
    if (isDemoWorkspace(workspaceId)) {
      onNotice("演示模式无法触发连接器同步");
      return;
    }
    setBusyId(connector.id);
    try {
      await invokeConnectorSync(connector.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace-bundle", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: connectorSettingsQueryKey(workspaceId) }),
      ]);
      setOpen(false);
      onNotice("云效同步完成");
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : "同步失败");
    } finally {
      setBusyId(null);
    }
  }, [busyId, onNotice, online, queryClient, workspaceId]);

  if (syncable.length === 0) return null;

  return (
    <div className="connector-sync-anchor" ref={rootRef}>
      <button
        className="rail-button"
        type="button"
        aria-label="同步连接器"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <RefreshCw className={busyId ? "spin" : undefined} />
      </button>
      {open && (
        <div className="connector-sync-menu" role="menu" aria-label="连接器列表">
          {syncable.map((connector) => {
            const syncing = busyId === connector.id;
            const disabled = !online || !connector.enabled || Boolean(busyId);
            return (
              <button
                key={connector.id}
                type="button"
                role="menuitem"
                className="connector-sync-item"
                disabled={disabled}
                onClick={() => {
                  void syncConnector(connector);
                }}
              >
                <span className="connector-logo yunxiao" aria-hidden="true">云</span>
                <span className="connector-sync-copy">
                  <strong>{connector.name}</strong>
                  <small>{connectorSyncSubtitle(connector, { syncing })}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
