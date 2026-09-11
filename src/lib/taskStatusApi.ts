import type { SupabaseClient } from "@supabase/supabase-js";
import { TaskStatusConflict, type TaskStatusRecord } from "./taskStatus";

export async function writeTaskStatus(
  client: SupabaseClient,
  workspaceId: string,
  expected: TaskStatusRecord,
  status: "open" | "cancelled",
): Promise<TaskStatusRecord> {
  const { data, error } = await client.from("tasks")
    .update({ status, completed_at: null })
    .eq("workspace_id", workspaceId)
    .eq("id", expected.id)
    .eq("version", expected.version)
    .eq("status", expected.status)
    .eq("kind", "todo")
    .is("connector_id", null)
    .is("deleted_at", null)
    .select("id,status,completed_at,version,updated_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new TaskStatusConflict();
  return data as TaskStatusRecord;
}
