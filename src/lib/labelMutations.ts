import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";
import type { LabelAccessDraft, WorkspaceBundle } from "../types";
import { updateLabelWithAccess } from "./api";
import { applyLabelAccessToBundle } from "./labels";

export async function saveLabelAccess(
  client: SupabaseClient,
  queryClient: QueryClient,
  workspaceId: string,
  labelId: string,
  draft: LabelAccessDraft,
  onRefreshError: (cause: unknown) => void,
) {
  const queryKey = ["workspace-bundle", workspaceId];
  const updated = await updateLabelWithAccess(client, labelId, draft);
  // A refresh started before the write must not overwrite the confirmed label.
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<WorkspaceBundle>(queryKey, (current) => current
    ? applyLabelAccessToBundle({
        ...current,
        labels: current.labels.map((label) => label.id === labelId ? updated : label),
      }, labelId, draft)
    : current,
  );
  // Permission changes can affect inherited labels and task visibility. Reconcile
  // in the background without making the editor wait for the entire bundle.
  void queryClient.invalidateQueries({ queryKey }, { throwOnError: true })
    .catch(onRefreshError);
}
