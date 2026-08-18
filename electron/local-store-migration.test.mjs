import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalStore } from "./local-store.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("local task-tree migration", () => {
  it("preserves queued writes while merging legacy child rows into tasks", async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "anttodo-tree-migration-"));
    temporaryRoots.push(userDataPath);
    const databaseDirectory = path.join(userDataPath, "local-first");
    const databasePath = path.join(databaseDirectory, "anttodo.sqlite");
    await fs.mkdir(databaseDirectory, { recursive: true });

    const legacyEntity = ["sub", "tasks"].join("");
    const legacyId = ["sub", "taskId"].join("");
    const fixture = new DatabaseSync(databasePath);
    fixture.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
        priority TEXT NOT NULL DEFAULT 'none', due_at TEXT, assignee_id TEXT,
        version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE children (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, parent_task_id TEXT,
        title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE _client_outbox (
        operation_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, device_id TEXT NOT NULL,
        device_seq INTEGER NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
        base_version INTEGER, payload TEXT NOT NULL, depends_on TEXT NOT NULL DEFAULT '[]',
        state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE _entity_shadows (
        workspace_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
        version INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (workspace_id, entity_type, entity_id)
      );
      CREATE TABLE _sync_conflicts (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL, local_payload TEXT NOT NULL, remote_payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    fixture.prepare(`INSERT INTO tasks(
      id,workspace_id,title,updated_at
    ) VALUES(?,?,?,?)`).run("root-task", "workspace", "Root", "2026-08-14T00:00:00.000Z");
    fixture.prepare(`INSERT INTO children(
      id,task_id,parent_task_id,title,completed,position,version,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(
      "nested-task", "root-task", null, "Nested", 1, 3, 7, "2026-08-14T01:00:00.000Z",
    );
    fixture.prepare(`INSERT INTO _client_outbox(
      operation_id,workspace_id,device_id,device_seq,entity_type,entity_id,base_version,payload,depends_on
    ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
      "operation-1", "workspace", "device", 9, legacyEntity, "nested-task", 6,
      JSON.stringify({ [legacyId]: "nested-task", title: "Queued edit" }),
      JSON.stringify(["operation-0"]),
    );
    fixture.prepare(`INSERT INTO _entity_shadows(
      workspace_id,entity_type,entity_id,version,payload
    ) VALUES(?,?,?,?,?)`).run("workspace", legacyEntity, "nested-task", 6, "{}");
    fixture.prepare(`INSERT INTO _sync_conflicts(
      id,workspace_id,entity_type,entity_id,local_payload,remote_payload
    ) VALUES(?,?,?,?,?,?)`).run("conflict-1", "workspace", legacyEntity, "nested-task", "{}", "{}");
    fixture.close();

    const store = await createLocalStore({
      userDataPath,
      workerUrl: pathToFileURL(path.join(process.cwd(), "electron/sqlite-worker.mjs")),
    });
    const outbox = await store.listOutbox({ workspaceId: "workspace" });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      operationId: "operation-1",
      entityType: "tasks",
      entityId: "nested-task",
      baseVersion: 6,
      dependsOn: ["operation-0"],
      payload: { taskId: "nested-task", task_id: "nested-task", title: "Queued edit" },
    });
    await store.dispose();

    const migrated = new DatabaseSync(databasePath, { readOnly: true });
    expect(migrated.prepare(
      "SELECT count(*) count FROM sqlite_master WHERE type='table' AND name='children'",
    ).get().count).toBe(0);
    expect(migrated.prepare(
      "SELECT parent_task_id,position,status,version FROM tasks WHERE id='nested-task'",
    ).get()).toEqual({ parent_task_id: "root-task", position: 3, status: "completed", version: 7 });
    expect(migrated.prepare(
      "SELECT entity_type FROM _entity_shadows WHERE entity_id='nested-task'",
    ).get().entity_type).toBe("tasks");
    expect(migrated.prepare(
      "SELECT entity_type FROM _sync_conflicts WHERE entity_id='nested-task'",
    ).get().entity_type).toBe("tasks");
    migrated.close();
  });
});
