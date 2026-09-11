import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { RotateCcw, SquareX } from "lucide-react";
import type { NoticeHandler, Task } from "./types";
import { canChangeTaskStatus, TaskStatusConflict, type TaskStatusRecord, type TaskStatusWriter } from "./lib/taskStatus";

type StatusActions = {
  canChange: (task: Task, status: "open" | "cancelled") => boolean;
  change: (ids: readonly string[], status: "open" | "cancelled") => Promise<void>;
};
const StatusContext = createContext<StatusActions>({ canChange: () => false, change: async () => undefined });
export const useTaskStatusActions = () => useContext(StatusContext);

export function TaskStatusActionsProvider({ tasks, online, canEdit, write, onNotice, children }: {
  tasks: Task[]; online: boolean; canEdit: (task: Task) => boolean;
  write: TaskStatusWriter; onNotice: NoticeHandler; children: ReactNode;
}) {
  const latest = useRef({ tasks, online, canEdit, write });
  latest.current = { tasks, online, canEdit, write };
  const pending = useRef(new Set<string>());
  const [, render] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function eligible(task: Task, status: "open" | "cancelled") {
    return latest.current.online && canChangeTaskStatus(task, status) && latest.current.canEdit(task) && !pending.current.has(task.id);
  }
  async function undo(records: TaskStatusRecord[], noticeId: string) {
    if (!latest.current.online || !alive.current) return;
    let ok = 0;
    let failed = 0;
    const retry: TaskStatusRecord[] = [];
    for (const record of records) {
      if (!alive.current) return;
      if (pending.current.has(record.id)) continue;
      pending.current.add(record.id);
      render((value) => value + 1);
      try {
        if (!latest.current.online) throw new Error("离线时无法撤销");
        await latest.current.write(record, "open");
        ok++;
      } catch (error) {
        failed++;
        if (!(error instanceof TaskStatusConflict)) retry.push(record);
      } finally { pending.current.delete(record.id); render((value) => value + 1); }
    }
    if (!alive.current) return;
    const id = crypto.randomUUID();
    onNotice(failed ? `已撤销 ${ok} 项，${failed} 项失败（任务可能已变更）` : "已撤销放弃", failed ? "error" : "success", {
      id, replaceId: noticeId, durationMs: 8000,
      ...(retry.length ? { action: { label: "撤销放弃", run: () => undo(retry, id) } } : {}),
    });
  }
  async function change(ids: readonly string[], status: "open" | "cancelled") {
    if (!latest.current.online || !alive.current) return;
    const records: TaskStatusRecord[] = [];
    let failed = 0;
    let skipped = 0;
    for (const id of new Set(ids)) {
      if (!alive.current) return;
      const task = latest.current.tasks.find((item) => item.id === id);
      if (!task || !eligible(task, status)) { skipped++; continue; }
      pending.current.add(id);
      render((value) => value + 1);
      try {
        if (!latest.current.online) throw new Error("离线时无法修改任务");
        records.push(await latest.current.write(task, status));
      } catch { failed++; }
      finally { pending.current.delete(id); render((value) => value + 1); }
    }
    if (!alive.current) return;
    const verb = status === "cancelled" ? "放弃" : "重新开始";
    let message = records.length === 1 && ids.length === 1 ? `任务已${verb}` : `已${verb} ${records.length} 项任务`;
    if (failed) message += `，${failed} 项失败`;
    if (skipped) message += `，${skipped} 项跳过`;
    if (!records.length && !failed) message = `没有可${verb}的任务`;
    const noticeId = crypto.randomUUID();
    onNotice(message, failed ? "error" : "success", {
      id: noticeId, durationMs: 8000,
      ...(status === "cancelled" && records.length ? {
        action: { label: "撤销放弃", run: () => undo(records, noticeId) },
      } : {}),
    });
  }
  return <StatusContext.Provider value={{ canChange: eligible, change }}>{children}</StatusContext.Provider>;
}

export function TaskStatusMenuItems({ tasks, onClose, role = "menuitem", className }: {
  tasks: readonly Task[]; onClose?: () => void; role?: "menuitem" | "button"; className?: string;
}) {
  const actions = useTaskStatusActions();
  return <>{(["cancelled", "open"] as const).map((status) => {
    if (!tasks.some((task) => canChangeTaskStatus(task, status))) return null;
    return <button key={status} type="button" role={role} className={className}
      disabled={!tasks.some((task) => actions.canChange(task, status))}
      onClick={() => { void actions.change(tasks.map((task) => task.id), status); onClose?.(); }}>
      {status === "cancelled" ? <SquareX /> : <RotateCcw />}
      <span>{status === "cancelled" ? "放弃" : "重新开始"}</span>
    </button>;
  })}</>;
}
