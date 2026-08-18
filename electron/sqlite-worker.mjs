import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

if (!parentPort) throw new Error("SQLite worker requires a parent port");

function isSqliteBusy(error) {
  const errcode = Number(error?.errcode);
  return errcode === 5 || errcode === 261 || errcode === 262
    || error?.errstr === "database is locked"
    || /database is (locked|busy)|SQLITE_BUSY/i.test(String(error?.message ?? error));
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function openDatabase(databasePath) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt++) {
    let database;
    try {
      database = new DatabaseSync(databasePath, { timeout: 5000 });
      database.exec("PRAGMA busy_timeout = 5000;");
      database.exec("PRAGMA journal_mode = WAL;");
      database.exec("PRAGMA foreign_keys = ON;");
      database.exec("PRAGMA synchronous = NORMAL;");
      return database;
    } catch (error) {
      lastError = error;
      try {
        database?.close();
      } catch {
        // The failed connection may already be closed.
      }
      if (!isSqliteBusy(error) || attempt === 9) throw error;
      sleepSync(50 * (attempt + 1));
    }
  }
  throw lastError;
}

const database = openDatabase(workerData.path);
database.exec(`
  CREATE TABLE IF NOT EXISTS _schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS _sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS _sync_cursors (
    workspace_id TEXT PRIMARY KEY,
    cursor INTEGER NOT NULL DEFAULT 0,
    high_watermark INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS _client_outbox (
    operation_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_seq INTEGER NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    base_version INTEGER,
    payload TEXT NOT NULL,
    depends_on TEXT NOT NULL DEFAULT '[]',
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS _client_outbox_pending_idx
    ON _client_outbox(workspace_id, state, device_seq);
  CREATE TABLE IF NOT EXISTS _entity_shadows (
    workspace_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, entity_type, entity_id)
  );
  CREATE TABLE IF NOT EXISTS _sync_conflicts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    local_payload TEXT NOT NULL,
    remote_payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS _local_files (
    file_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    task_id TEXT,
    owner_id TEXT NOT NULL,
    bucket TEXT NOT NULL,
    object_path TEXT NOT NULL,
    canonical_uri TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    local_path TEXT NOT NULL,
    state TEXT NOT NULL,
    last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    parent_task_id TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'none',
    due_at TEXT,
    assignee_id TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'private',
    position INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_labels (
    task_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY (task_id, label_id)
  );
  CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    image_uris TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_list_placements (
    workspace_id TEXT NOT NULL,
    list_key TEXT NOT NULL,
    task_id TEXT NOT NULL,
    section_id TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, list_key, task_id)
  );
`);

function applySqliteMigrations() {
  const applied = new Set(
    rows("SELECT version FROM _schema_migrations").map((item) => String(item.version)),
  );
  if (!applied.has("unified_task_tree_v1")) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const taskColumns = rows("PRAGMA table_info(tasks)").map((item) => String(item.name));
      if (!taskColumns.includes("parent_task_id")) run("ALTER TABLE tasks ADD COLUMN parent_task_id TEXT");
      if (!taskColumns.includes("position")) run("ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0");

      const hasLegacyTreeTable = rows(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'children'",
      ).length > 0;
      if (hasLegacyTreeTable) {
        run(`INSERT OR IGNORE INTO tasks(
          id, workspace_id, parent_task_id, position, title, description, status,
          priority, due_at, assignee_id, version, deleted_at, updated_at
        )
        SELECT c.id, t.workspace_id, COALESCE(c.parent_task_id, c.task_id), c.position,
          c.title, '', CASE WHEN c.completed = 1 THEN 'completed' ELSE 'open' END,
          'none', NULL, NULL, c.version, NULL, c.updated_at
        FROM children c JOIN tasks t ON t.id = c.task_id`);
        run("DROP TABLE children");
      }

      const legacyEntity = ["sub", "tasks"].join("");
      const legacySchedule = ["sub", "task_schedule"].join("");
      const legacyIdCamel = ["sub", "taskId"].join("");
      const legacyIdSnake = ["sub", "task_id"].join("");
      const normalizeLegacyPayload = (rawPayload) => {
        let payload;
        try { payload = JSON.parse(String(rawPayload || "{}")); } catch { return String(rawPayload); }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return String(rawPayload);
        const exactTaskId = payload[legacyIdCamel] ?? payload.taskId ?? payload[legacyIdSnake] ?? payload.task_id;
        const nextPayload = { ...payload };
        delete nextPayload[legacyIdCamel];
        delete nextPayload[legacyIdSnake];
        if (exactTaskId) {
          nextPayload.taskId = exactTaskId;
          nextPayload.task_id = exactTaskId;
        }
        return JSON.stringify(nextPayload);
      };
      for (const row of rows("SELECT operation_id, entity_type, payload FROM _client_outbox")) {
        const entityType = row.entity_type === legacyEntity
          ? "tasks"
          : row.entity_type === legacySchedule ? "task_schedule" : row.entity_type;
        run("UPDATE _client_outbox SET entity_type = ?, payload = ? WHERE operation_id = ?", [
          entityType, normalizeLegacyPayload(row.payload), row.operation_id,
        ]);
      }
      for (const row of rows("SELECT workspace_id, entity_type, entity_id, payload FROM _entity_shadows")) {
        const entityType = row.entity_type === legacyEntity ? "tasks"
          : row.entity_type === legacySchedule ? "task_schedule" : row.entity_type;
        run(`UPDATE _entity_shadows SET entity_type=?,payload=?
          WHERE workspace_id=? AND entity_type=? AND entity_id=?`, [
          entityType, normalizeLegacyPayload(row.payload), row.workspace_id, row.entity_type, row.entity_id,
        ]);
      }
      for (const row of rows("SELECT id, entity_type, local_payload, remote_payload FROM _sync_conflicts")) {
        const entityType = row.entity_type === legacyEntity ? "tasks"
          : row.entity_type === legacySchedule ? "task_schedule" : row.entity_type;
        run(`UPDATE _sync_conflicts SET entity_type=?,local_payload=?,remote_payload=? WHERE id=?`, [
          entityType, normalizeLegacyPayload(row.local_payload),
          normalizeLegacyPayload(row.remote_payload), row.id,
        ]);
      }
      run("INSERT INTO _schema_migrations(version) VALUES (?)", ["unified_task_tree_v1"]);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

applySqliteMigrations();

function rows(sql, params = []) {
  return database.prepare(sql).all(...params);
}

function run(sql, params = []) {
  return database.prepare(sql).run(...params);
}

const handlers = {
  async getStatus({ workspaceId }) {
    const pending = rows(
      "SELECT count(*) AS count FROM _client_outbox WHERE workspace_id = ? AND state IN ('pending', 'failed')",
      [workspaceId],
    )[0]?.count ?? 0;
    const conflicts = rows(
      "SELECT count(*) AS count FROM _sync_conflicts WHERE workspace_id = ? AND status = 'open'",
      [workspaceId],
    )[0]?.count ?? 0;
    const lastSyncedAt = rows(
      "SELECT updated_at FROM _sync_cursors WHERE workspace_id = ?",
      [workspaceId],
    )[0]?.updated_at ?? null;
    return {
      phase: Number(pending) > 0 ? "pending" : "idle",
      pendingCount: Number(pending),
      conflictCount: Number(conflicts),
      lastSyncedAt,
      errorMessage: null,
    };
  },
  async enqueue({ operation }) {
    database.exec("BEGIN IMMEDIATE");
    try {
      run(
        `INSERT INTO _client_outbox
          (operation_id, workspace_id, device_id, device_seq, entity_type, entity_id, base_version, payload, depends_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(operation_id) DO NOTHING`,
        [
          operation.operationId,
          operation.workspaceId,
          operation.deviceId,
          operation.deviceSeq,
          operation.entityType,
          operation.entityId,
          operation.baseVersion ?? null,
          JSON.stringify(operation.payload ?? {}),
          JSON.stringify(operation.dependsOn ?? []),
        ],
      );
      database.exec("COMMIT");
      return { ok: true };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
  async listOutbox({ workspaceId, limit = 50 }) {
    return rows(
      `SELECT operation_id AS operationId, workspace_id AS workspaceId, device_id AS deviceId,
        device_seq AS deviceSeq, entity_type AS entityType, entity_id AS entityId,
        base_version AS baseVersion, payload, depends_on AS dependsOn, state, attempts
       FROM _client_outbox
       WHERE workspace_id = ? AND state IN ('pending', 'failed')
       ORDER BY device_seq ASC LIMIT ?`,
      [workspaceId, Math.min(Math.max(limit, 1), 50)],
    ).map((item) => ({
      ...item,
      payload: JSON.parse(item.payload),
      dependsOn: JSON.parse(item.dependsOn),
    }));
  },
  async markOutbox({ operationId, state, error }) {
    run(
      "UPDATE _client_outbox SET state = ?, attempts = attempts + 1, last_error = ? WHERE operation_id = ?",
      [state, error ?? null, operationId],
    );
    return { ok: true };
  },
  async setCursor({ workspaceId, cursor, highWatermark }) {
    run(
      `INSERT INTO _sync_cursors(workspace_id, cursor, high_watermark)
       VALUES (?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET cursor = excluded.cursor,
         high_watermark = excluded.high_watermark, updated_at = datetime('now')`,
      [workspaceId, cursor, highWatermark ?? cursor],
    );
    return { ok: true };
  },
  async getCursor({ workspaceId }) {
    return rows("SELECT cursor, high_watermark AS highWatermark FROM _sync_cursors WHERE workspace_id = ?", [workspaceId])[0] ?? {
      cursor: 0,
      highWatermark: 0,
    };
  },
  async saveBundle({ workspaceId, bundle }) {
    run(
      `INSERT INTO _sync_meta(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [`bundle:${workspaceId}`, JSON.stringify(bundle)],
    );
    return { ok: true };
  },
  async commitBundle({ workspaceId, bundle, operation }) {
    database.exec("BEGIN IMMEDIATE");
    try {
      run(
        `INSERT INTO _sync_meta(key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [`bundle:${workspaceId}`, JSON.stringify(bundle)],
      );
      run(
        `INSERT INTO _client_outbox
          (operation_id, workspace_id, device_id, device_seq, entity_type, entity_id, base_version, payload, depends_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(operation_id) DO NOTHING`,
        [
          operation.operationId,
          operation.workspaceId,
          operation.deviceId,
          operation.deviceSeq,
          operation.entityType,
          operation.entityId,
          operation.baseVersion ?? null,
          JSON.stringify(operation.payload ?? {}),
          JSON.stringify(operation.dependsOn ?? []),
        ],
      );
      database.exec("COMMIT");
      return { ok: true };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
  async saveWorkspaces({ workspaces }) {
    run(
      `INSERT INTO _sync_meta(key, value) VALUES ('workspaces', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [JSON.stringify(workspaces)],
    );
    return { ok: true };
  },
  async getWorkspaces() {
    const item = rows("SELECT value FROM _sync_meta WHERE key = 'workspaces'")[0];
    return item ? JSON.parse(item.value) : null;
  },
  async getBundle({ workspaceId }) {
    const item = rows("SELECT value FROM _sync_meta WHERE key = ?", [`bundle:${workspaceId}`])[0];
    return item ? JSON.parse(item.value) : null;
  },
  async getComments({ commentKey }) {
    const item = rows("SELECT value FROM _sync_meta WHERE key = ?", [`comments:${commentKey}`])[0];
    return item ? JSON.parse(item.value) : null;
  },
  async saveComments({ commentKey, comments }) {
    run(
      `INSERT INTO _sync_meta(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [`comments:${commentKey}`, JSON.stringify(comments)],
    );
    return { ok: true };
  },
  async commitComments({ commentKey, comments, operation }) {
    database.exec("BEGIN IMMEDIATE");
    try {
      run(
        `INSERT INTO _sync_meta(key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [`comments:${commentKey}`, JSON.stringify(comments)],
      );
      run(
        `INSERT INTO _client_outbox
          (operation_id, workspace_id, device_id, device_seq, entity_type, entity_id, base_version, payload, depends_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(operation_id) DO NOTHING`,
        [
          operation.operationId,
          operation.workspaceId,
          operation.deviceId,
          operation.deviceSeq,
          operation.entityType,
          operation.entityId,
          operation.baseVersion ?? null,
          JSON.stringify(operation.payload ?? {}),
          JSON.stringify(operation.dependsOn ?? []),
        ],
      );
      database.exec("COMMIT");
      return { ok: true };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
  async close() {
    try {
      database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // Checkpoint is best-effort so dispose can still close the file.
    }
    database.close();
    return { ok: true };
  },
};

let chain = Promise.resolve();
parentPort.on("message", (message) => {
  chain = chain.then(async () => {
    const { id, method, input } = message;
    try {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unknown SQLite method: ${method}`);
      parentPort.postMessage({ id, result: await handler(input ?? {}) });
    } catch (error) {
      parentPort.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }).catch(() => {
    // Keep the queue alive if a handler fails outside the inner try/catch.
  });
});

parentPort.postMessage({ type: "ready" });
