import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createTask, loadTaskTree } from "./api";

describe("task detail query", () => {
  it("selects dependencies through the owning task foreign key", async () => {
    let taskSelect = "";
    const client = {
      rpc: async () => ({ data: [{ id: "task-1" }], error: null }),
      from: () => ({
        select: (columns: string) => {
          taskSelect = columns;
          return {
            in: async () => ({
              data: [{ id: "task-1", parent_task_id: null, task_dependencies: [] }],
              error: null,
            }),
          };
        },
      }),
    } as unknown as SupabaseClient;

    await loadTaskTree(client, "task-1");

    expect(taskSelect).toContain(
      "task_dependencies:task_dependencies!task_dependencies_task_id_fkey(*)",
    );
  });
});

describe("nested task creation", () => {
  it("inserts without representation and fetches the task separately", async () => {
    let insertedRow: Record<string, unknown> | undefined;
    let selectedId = "";
    const taskRow = {
      id: "task-new",
      workspace_id: "workspace-1",
      parent_task_id: "task-parent",
      title: "Nested task",
      kind: "todo",
    };
    const client = {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
      from: (table: string) => {
        expect(table).toBe("tasks");
        return {
          insert: async (row: Record<string, unknown>) => {
            insertedRow = row;
            return { error: null };
          },
          select: () => ({
            eq: (column: string, value: string) => {
              expect(column).toBe("id");
              selectedId = value;
              return {
                single: async () => ({ data: taskRow, error: null }),
              };
            },
          }),
        };
      },
    } as unknown as SupabaseClient;

    const created = await createTask(client, {
      workspaceId: "workspace-1",
      parentTaskId: "task-parent",
      title: "Nested task",
      labelIds: [],
    });

    expect(insertedRow?.id).toEqual(selectedId);
    expect(insertedRow?.parent_task_id).toBe("task-parent");
    expect(created.id).toBe("task-new");
  });
});
