import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";

function waitForWorkerReady(worker, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("SQLite worker startup timed out"));
    }, timeoutMs);
    function onMessage(message) {
      if (message?.type === "ready") {
        cleanup();
        resolve();
      }
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    function cleanup() {
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("error", onError);
    }
    worker.on("message", onMessage);
    worker.on("error", onError);
  });
}

export async function createLocalStore({ userDataPath }) {
  const root = path.join(userDataPath, "local-first");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const databasePath = path.join(root, "anttodo.sqlite");
  const worker = new Worker(new URL("./sqlite-worker.mjs", import.meta.url), {
    workerData: { path: databasePath },
    execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type")),
  });
  try {
    await waitForWorkerReady(worker);
  } catch (error) {
    await worker.terminate();
    throw error;
  }
  let sequence = 0;
  const pending = new Map();
  let closed = false;
  worker.on("message", (message) => {
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error));
    else callback.resolve(message.result);
  });
  worker.on("error", (error) => {
    for (const callback of pending.values()) callback.reject(error);
    pending.clear();
  });
  worker.on("exit", (code) => {
    if (closed) return;
    const error = new Error(`SQLite worker exited with code ${code}`);
    for (const callback of pending.values()) callback.reject(error);
    pending.clear();
  });

  const call = (method, input) => new Promise((resolve, reject) => {
    if (closed) {
      reject(new Error("Local store is closed"));
      return;
    }
    const id = `${Date.now()}-${sequence++}`;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, input });
  });

  return {
    databasePath,
    getStatus: (input) => call("getStatus", input),
    enqueue: (input) => call("enqueue", input),
    listOutbox: (input) => call("listOutbox", input),
    markOutbox: (input) => call("markOutbox", input),
    setCursor: (input) => call("setCursor", input),
    getCursor: (input) => call("getCursor", input),
    saveBundle: (input) => call("saveBundle", input),
    getBundle: (input) => call("getBundle", input),
    getComments: (commentKey) => call("getComments", { commentKey }),
    saveComments: (input) => call("saveComments", input),
    commitComments: (input) => call("commitComments", input),
    commitBundle: (input) => call("commitBundle", input),
    saveWorkspaces: (input) => call("saveWorkspaces", input),
    getWorkspaces: () => call("getWorkspaces"),
    async dispose() {
      if (closed) return;
      try {
        await Promise.race([
          call("close"),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("SQLite close timed out")), 2000);
          }),
        ]);
      } catch {
        // Terminate below even if checkpoint/close did not finish.
      }
      closed = true;
      for (const callback of pending.values()) {
        callback.reject(new Error("Local store is closed"));
      }
      pending.clear();
      await worker.terminate();
    },
    createOperationId: randomUUID,
  };
}
