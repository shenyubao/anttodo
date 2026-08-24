import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { listTasks } from "./api.js";

describe("task list query", () => {
  it("selects dependencies through the owning task foreign key", async () => {
    let taskSelect = "";
    const query = {
      select(columns: string) {
        taskSelect = columns;
        return this;
      },
      eq() {
        return this;
      },
      order() {
        return this;
      },
      range() {
        return this;
      },
      is() {
        return this;
      },
      then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    const client = {
      from: () => query,
    } as unknown as SupabaseClient;

    await listTasks(client, "workspace-1", "todo", { limit: 100, offset: 0 });

    expect(taskSelect).toContain(
      "task_dependencies:task_dependencies!task_dependencies_task_id_fkey(*)",
    );
  });
});
