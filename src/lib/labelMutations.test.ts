import type { SupabaseClient } from "@supabase/supabase-js";
import { dehydrate, QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { LabelAccessDraft, WorkspaceBundle } from "../types";
import { createDemoBundle } from "./demo";
import { saveLabelAccess } from "./labelMutations";

const queryKey = ["workspace-bundle", "workspace-team"];
const draft: LabelAccessDraft = {
  name: "已更新",
  color: "#4ca1ff",
  parentId: null,
  kind: "team",
  viewScope: "users",
  manageScope: "groups",
  viewSubjectIds: ["viewer"],
  manageSubjectIds: ["managers"],
};

function setup() {
  const queryClient = new QueryClient({ defaultOptions: {
    queries: { retry: false, staleTime: Infinity },
  } });
  const bundle = createDemoBundle();
  const label = bundle.labels.find((item) => item.id === "product")!;
  queryClient.setQueryData(queryKey, bundle);
  const updated = { ...label, name: draft.name, color: draft.color,
    view_scope: draft.viewScope, manage_scope: draft.manageScope };
  const rpc = vi.fn().mockResolvedValue({ data: updated, error: null });
  const client = { rpc } as unknown as SupabaseClient;
  return { queryClient, bundle, updated, rpc, client };
}

describe("label save completion", () => {
  it("finishes after the write while bundle reconciliation is still pending", async () => {
    const { queryClient, bundle, updated, rpc, client } = setup();
    let finishRefresh!: (bundle: WorkspaceBundle) => void;
    const refresh = vi.fn(() => new Promise<WorkspaceBundle>((resolve) => { finishRefresh = resolve; }));
    const observer = new QueryObserver(queryClient, { queryKey, queryFn: refresh });
    const unsubscribe = observer.subscribe(() => {});
    const onRefreshError = vi.fn();
    try {
      await saveLabelAccess(client, queryClient, "workspace-team", "product", draft, onRefreshError);

      expect(rpc).toHaveBeenCalledOnce();
      expect(rpc.mock.calls[0][0]).toBe("update_label_with_access");
      expect(refresh).toHaveBeenCalledOnce();
      expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe("fetching");
      const cached = queryClient.getQueryData<WorkspaceBundle>(queryKey)!;
      expect(cached.labels.find((label) => label.id === "product")).toEqual(updated);
      expect(cached.tasks).toBe(bundle.tasks);
      expect(cached.labelUserAcls.filter((acl) => acl.label_id === "product"))
        .toEqual([{ label_id: "product", workspace_id: "workspace-team", user_id: "viewer", permission: "view" }]);
      expect(cached.labelGroupAcls.filter((acl) => acl.label_id === "product"))
        .toEqual([{ label_id: "product", workspace_id: "workspace-team", group_id: "managers", permission: "edit" }]);
      // The confirmed cache still uses the existing persistence format.
      expect(dehydrate(queryClient).queries[0]?.state.data).toEqual(cached);
      expect(onRefreshError).not.toHaveBeenCalled();

      const reconciled = { ...cached, labelPermissionLevels: { product: 1 as const } };
      finishRefresh(reconciled);
      await vi.waitFor(() => expect(queryClient.getQueryData(queryKey)).toEqual(reconciled));
    } finally {
      unsubscribe();
      queryClient.clear();
    }
  });

  it("leaves the previous cache intact and reports a failed write to the editor", async () => {
    const { queryClient, bundle, rpc, client } = setup();
    rpc.mockResolvedValue({ data: null, error: { message: "Permission denied" } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    try {
      await expect(saveLabelAccess(client, queryClient, "workspace-team", "product", draft, vi.fn()))
        .rejects.toThrow("Permission denied");
      expect(queryClient.getQueryData(queryKey)).toBe(bundle);
      expect(invalidate).not.toHaveBeenCalled();
    } finally {
      queryClient.clear();
    }
  });

  it("retains the successful write when the background refresh fails", async () => {
    const { queryClient, updated, rpc, client } = setup();
    const privateLabel = { ...updated, kind: "private" };
    rpc.mockResolvedValue({ data: privateLabel, error: null });
    const error = new Error("Refresh unavailable");
    const observer = new QueryObserver(queryClient, { queryKey, queryFn: async () => { throw error; } });
    const unsubscribe = observer.subscribe(() => {});
    const onRefreshError = vi.fn();
    try {
      await saveLabelAccess(client, queryClient, "workspace-team", "product", {
        ...draft, kind: "private",
      }, onRefreshError);
      await vi.waitFor(() => expect(onRefreshError).toHaveBeenCalledWith(error));
      const cached = queryClient.getQueryData<WorkspaceBundle>(queryKey)!;
      expect(cached.labels.find((label) => label.id === "product")).toEqual(privateLabel);
      expect(cached.labelUserAcls.filter((acl) => acl.label_id === "product")).toEqual([]);
      expect(cached.labelGroupAcls.filter((acl) => acl.label_id === "product")).toEqual([]);
    } finally {
      unsubscribe();
      queryClient.clear();
    }
  });
});
