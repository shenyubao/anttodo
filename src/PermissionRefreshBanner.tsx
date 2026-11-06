import { useQueryClient } from "@tanstack/react-query";
import { retryPermissionRefresh } from "./lib/permissionRefresh";
import { usePermissionRefresh } from "./lib/usePermissionRefresh";

export function PermissionRefreshBanner({ workspaceId, online }: { workspaceId: string; online: boolean }) {
  const client = useQueryClient();
  const status = usePermissionRefresh(workspaceId);
  if (status === "ready") return null;
  return <div className="permission-refresh-banner" role={status === "error" ? "alert" : "status"}>
    <span>{status === "error" ? "权限刷新失败，现有内容暂时只读。已保存的用户组无需重复提交。" : "正在核对权限，相关内容暂时只读。"}</span>
    {status === "error" && <button type="button" className="button secondary" disabled={!online}
      onClick={() => retryPermissionRefresh(client, workspaceId)}>重新加载</button>}
  </div>;
}
