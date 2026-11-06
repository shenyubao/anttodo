import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { permissionRefreshStatus, subscribePermissionRefresh, type PermissionScope } from "./permissionRefresh";

export function usePermissionRefresh(workspaceId: string, scope?: PermissionScope) {
  const client = useQueryClient();
  return useSyncExternalStore(
    useCallback((listener) => subscribePermissionRefresh(client, listener, workspaceId), [client, workspaceId]),
    () => permissionRefreshStatus(client, workspaceId, scope),
  );
}
