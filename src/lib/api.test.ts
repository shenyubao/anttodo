import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createTask, loadTaskTree, loadWorkspaces, loadWorkspaceTasksByIds } from "./api";

describe("workspace list query", () => {
  it("loads workspaces without embedding through foreign keys", async () => {
    const selects: Record<string, string> = {};
    const client = {
      from: (table: string) => ({
        select: (columns: string) => {
          selects[table] = columns;
          return {
            eq: () => ({
              order: async () => ({
                data: [{ role: "owner", workspace_id: "workspace-1" }],
                error: null,
              }),
            }),
            in: async () => ({
              data: [{ id: "workspace-1", name: "Team", slug: "team" }],
              error: null,
            }),
          };
        },
      }),
    } as unknown as SupabaseClient;

    await expect(loadWorkspaces(client, "user-1")).resolves.toEqual([
      { id: "workspace-1", name: "Team", slug: "team", role: "owner" },
    ]);
    expect(selects.workspace_members).toBe("role, workspace_id");
    expect(selects.workspaces).toBe("*");
  });
});

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

  it("loads task details in batches of at most 50 ids", async () => {
    const ids = Array.from({ length: 112 }, (_, index) => `task-${index + 1}`);
    const queriedBatches: string[][] = [];
    const client = {
      rpc: async () => ({ data: ids.map((id) => ({ id })), error: null }),
      from: () => ({
        select: () => ({
          in: async (_column: string, batch: string[]) => {
            queriedBatches.push(batch);
            return {
              data: batch.map((id) => ({
                id,
                parent_task_id: null,
                task_dependencies: [],
              })),
              error: null,
            };
          },
        }),
      }),
    } as unknown as SupabaseClient;

    const tasks = await loadTaskTree(client, "task-1");

    expect(queriedBatches.map((batch) => batch.length)).toEqual([50, 50, 12]);
    expect(queriedBatches.flat()).toEqual(ids);
    expect(tasks).toHaveLength(ids.length);
  });

  it("loads selected task ids without querying the rest of the workspace", async () => {
    const queriedBatches: string[][] = [];
    const client = {
      from: () => ({
        select: () => ({
          in: async (_column: string, batch: string[]) => {
            queriedBatches.push(batch);
            return {
              data: batch.map((id) => ({
                id,
                parent_task_id: null,
                task_dependencies: [],
              })),
              error: null,
            };
          },
        }),
      }),
    } as unknown as SupabaseClient;

    const tasks = await loadWorkspaceTasksByIds(client, ["task-1", "task-1", ""]);

    expect(queriedBatches).toEqual([["task-1"]]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("task-1");
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
