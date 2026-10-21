import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, ChevronDown, ChevronRight, Link2Off, Target } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { createDemoOkrData } from "./lib/demoOkr";
import {
  loadMyActiveOkrTree,
  loadTaskOkrLinkIds,
  setTaskOkrLink,
  taskOkrLinkKey,
} from "./lib/okrApi";
import { supabase } from "./lib/supabase";
import { runBulkTaskUpdates } from "./lib/taskMultiSelect";
import type { MyActiveOkrTree, OkrKeyResult, OkrLinkedTaskSummary, OkrObjective, Task, TaskOkrLink } from "./types";

const MIXED = "__mixed__";

export function resolveTaskOkrSelection(
  taskIds: readonly string[],
  links: Record<string, string | undefined>,
) {
  const values = taskIds.map((taskId) => links[taskId] ?? null);
  const first = values[0] ?? null;
  return values.every((value) => value === first) ? first : MIXED;
}

export function TaskOkrPicker({
  open,
  tasks,
  skipped = 0,
  workspaceId,
  currentUserId,
  online,
  anchorPoint,
  onOpenChange,
  onNotice,
}: {
  open: boolean;
  tasks: Task[];
  skipped?: number;
  workspaceId: string;
  currentUserId: string;
  online: boolean;
  anchorPoint?: { left: number; top: number };
  onOpenChange: (open: boolean) => void;
  onNotice: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null | typeof MIXED>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const demoMode = new URLSearchParams(window.location.search).get("demo") === "1";
  const backendAvailable = Boolean(supabase) && !demoMode;
  const taskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);
  const treeQuery = useQuery({
    queryKey: ["my-active-okr-tree", workspaceId, currentUserId],
    queryFn: () => loadMyActiveOkrTree(supabase!, workspaceId, currentUserId),
    enabled: backendAvailable && open,
  });
  const linksQuery = useQuery({
    queryKey: ["task-okr-link-ids", ...taskIds],
    queryFn: () => loadTaskOkrLinkIds(supabase!, taskIds),
    enabled: backendAvailable && open && taskIds.length > 0,
  });
  const demoTree = useMemo<MyActiveOkrTree | null>(() => {
    if (!demoMode) return null;
    const data = createDemoOkrData(workspaceId);
    const cycle = data.cycles.find((item) => item.status === "active") ?? null;
    if (!cycle) return null;
    return {
      cycle,
      set: data.sets.find((item) => item.cycle_id === cycle.id && item.owner_id === currentUserId) ?? null,
    };
  }, [currentUserId, demoMode, workspaceId]);
  const tree = backendAvailable ? treeQuery.data ?? null : demoTree;
  const demoLinkIds = useMemo<Record<string, string>>(() => {
    const keyResultId = demoTree?.set?.objectives[0]?.key_results[0]?.id;
    const links: Record<string, string> = {};
    if (keyResultId && taskIds.includes("task-1")) links["task-1"] = keyResultId;
    return links;
  }, [demoTree, taskIds]);
  const linkIds = useMemo(
    () => backendAvailable ? linksQuery.data ?? {} : demoLinkIds,
    [backendAvailable, demoLinkIds, linksQuery.data],
  );

  useEffect(() => {
    if (!open) return;
    setDraft(resolveTaskOkrSelection(taskIds, linkIds));
  }, [linkIds, open, taskIds]);

  useEffect(() => {
    if (!open) return;
    setExpanded(new Set(tree?.set?.objectives.map((objective) => objective.id) ?? []));
  }, [open, tree?.cycle.id, tree?.set?.id]);

  useEffect(() => {
    if (!open) return;
    const width = Math.min(360, window.innerWidth - 24);
    const height = Math.min(480, window.innerHeight - 24);
    const point = anchorPoint ?? { left: (window.innerWidth - width) / 2, top: 72 };
    setPosition({
      width,
      maxHeight: height,
      left: Math.min(Math.max(12, point.left), Math.max(12, window.innerWidth - width - 12)),
      top: Math.min(Math.max(12, point.top), Math.max(12, window.innerHeight - height - 12)),
    });
  }, [anchorPoint, open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      onOpenChange(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", closeOutside);
      document.addEventListener("keydown", closeEscape);
    });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [onOpenChange, open]);

  if (!open) return null;

  async function apply() {
    if (saving || draft === MIXED) return;
    if (!online || !backendAvailable) {
      onNotice(demoMode ? "产品演示中的 OKR 为只读示例" : "离线时无法修改 OKR 关联");
      return;
    }
    const selected = findKeyResult(tree, draft);
    const optimistic = selected ? linkFromSelection(tasks[0]!, currentUserId, tree!, selected.objective, selected.keyResult) : null;
    setSaving(true);
    const result = await runBulkTaskUpdates(tasks, async (task) => {
      const key = taskOkrLinkKey(task.id);
      const previous = queryClient.getQueryData<TaskOkrLink | null>(key);
      const listSnapshots = queryClient.getQueriesData<OkrLinkedTaskSummary[]>({
        queryKey: ["okr-linked-tasks", workspaceId],
      });
      queryClient.setQueryData(key, optimistic ? { ...optimistic, task_id: task.id } : null);
      for (const [listKey, current] of listSnapshots) {
        if (!current) continue;
        const targetKind = listKey[2];
        const targetId = listKey[3];
        const belongsToTarget = selected && (
          (targetKind === "key_result" && targetId === selected.keyResult.id)
          || (targetKind === "objective" && targetId === selected.objective.id)
        );
        const next = current.filter((item) => item.task_id !== task.id);
        if (belongsToTarget) next.push(linkedTaskSummary(task, selected.objective, selected.keyResult));
        queryClient.setQueryData(listKey, sortLinkedTasks(next));
      }
      try {
        const saved = await setTaskOkrLink(supabase!, task.id, draft);
        queryClient.setQueryData(key, saved);
      } catch (cause) {
        queryClient.setQueryData(key, previous);
        for (const [listKey, snapshot] of listSnapshots) queryClient.setQueryData(listKey, snapshot);
        throw cause;
      }
    });
    setSaving(false);
    await queryClient.invalidateQueries({ queryKey: ["okr-linked-task-counts", workspaceId] });
    await queryClient.invalidateQueries({ queryKey: ["okr-linked-tasks", workspaceId] });
    await Promise.all(tasks.map((task) => queryClient.invalidateQueries({ queryKey: taskOkrLinkKey(task.id) })));
    onNotice(formatTaskOkrBulkNotice({
      ...result,
      skipped,
      action: draft ? "关联 KR" : "取消关联",
    }));
    if (result.ok > 0) onOpenChange(false);
  }

  const loading = backendAvailable && (treeQuery.isLoading || linksQuery.isLoading);
  return createPortal(
    <div
      ref={rootRef}
      className="task-okr-picker"
      role="dialog"
      aria-label="选择关联 KR"
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header>
        <span><Target />关联 OKR</span>
        <small>{tree?.cycle.name ?? "当前周期"}</small>
      </header>
      <div className="task-okr-picker-list">
        <button
          type="button"
          className={clsx("task-okr-option clear", draft === null && "selected")}
          onClick={() => setDraft(null)}
        >
          <span className={clsx("task-okr-radio", draft === null && "checked")}>{draft === null && <Check />}</span>
          <Link2Off />
          <span>取消关联</span>
        </button>
        {draft === MIXED && <p className="task-okr-mixed">所选待办当前关联了不同 KR</p>}
        {loading && <p className="task-okr-empty">正在读取我的 OKR…</p>}
        {!loading && tree?.set?.objectives.map((objective, objectiveIndex) => (
          <div className="task-okr-objective" key={objective.id}>
            <button
              type="button"
              className="task-okr-objective-trigger"
              aria-expanded={expanded.has(objective.id)}
              onClick={() => setExpanded((current) => {
                const next = new Set(current);
                if (next.has(objective.id)) next.delete(objective.id);
                else next.add(objective.id);
                return next;
              })}
            >
              {expanded.has(objective.id) ? <ChevronDown /> : <ChevronRight />}
              <strong>O{objectiveIndex + 1}</strong>
              <span>{objective.title}</span>
            </button>
            {expanded.has(objective.id) && objective.key_results.map((keyResult, keyResultIndex) => (
              <button
                type="button"
                className={clsx("task-okr-option", draft === keyResult.id && "selected")}
                key={keyResult.id}
                onClick={() => setDraft(keyResult.id)}
              >
                <span className={clsx("task-okr-radio", draft === keyResult.id && "checked")}>{draft === keyResult.id && <Check />}</span>
                <strong>KR{keyResultIndex + 1}</strong>
                <span>{keyResult.title}</span>
              </button>
            ))}
          </div>
        ))}
        {!loading && (!tree || !tree.set || tree.set.objectives.every((objective) => objective.key_results.length === 0)) && (
          <p className="task-okr-empty">当前进行中周期没有可关联的 KR</p>
        )}
      </div>
      <footer>
        <button type="button" onClick={() => onOpenChange(false)}>取消</button>
        <button type="button" className="primary" disabled={saving || draft === MIXED || !online || !backendAvailable} onClick={() => void apply()}>
          {saving ? "保存中…" : "确定"}
        </button>
      </footer>
    </div>,
    document.body,
  );
}

export function formatTaskOkrBulkNotice(input: {
  ok: number;
  failed: number;
  skipped: number;
  action: string;
}) {
  return `${input.action}：${input.ok} 项成功，${input.failed} 项失败，${input.skipped} 项跳过`;
}

function linkedTaskSummary(
  task: Task,
  objective: OkrObjective,
  keyResult: OkrKeyResult,
): OkrLinkedTaskSummary {
  return {
    task_id: task.id,
    workspace_id: task.workspace_id,
    parent_task_id: task.parent_task_id,
    title: task.title,
    kind: task.kind,
    status: task.status,
    due_at: task.due_at,
    assignee_id: task.assignee_id,
    updated_at: new Date().toISOString(),
    key_result_id: keyResult.id,
    key_result_title: keyResult.title,
    key_result_position: objective.key_results.findIndex((item) => item.id === keyResult.id),
  };
}

function sortLinkedTasks(tasks: OkrLinkedTaskSummary[]) {
  const statusRank = { open: 0, completed: 1, cancelled: 2 } as const;
  return [...tasks].sort((left, right) =>
    left.key_result_position - right.key_result_position
    || statusRank[left.status] - statusRank[right.status]
    || right.updated_at.localeCompare(left.updated_at));
}

function findKeyResult(tree: MyActiveOkrTree | null, keyResultId: string | null | typeof MIXED) {
  if (!tree?.set || !keyResultId || keyResultId === MIXED) return null;
  for (const objective of tree.set.objectives) {
    const keyResult = objective.key_results.find((item) => item.id === keyResultId);
    if (keyResult) return { objective, keyResult };
  }
  return null;
}

function linkFromSelection(
  task: Task,
  userId: string,
  tree: MyActiveOkrTree,
  objective: OkrObjective,
  keyResult: OkrKeyResult,
): TaskOkrLink {
  const now = new Date().toISOString();
  return {
    task_id: task.id,
    key_result_id: keyResult.id,
    workspace_id: task.workspace_id,
    created_by: userId,
    created_at: now,
    updated_at: now,
    owner_id: userId,
    cycle_id: tree.cycle.id,
    cycle_name: tree.cycle.name,
    objective_id: objective.id,
    objective_title: objective.title,
    key_result_title: keyResult.title,
  };
}
