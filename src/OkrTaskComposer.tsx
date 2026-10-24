import { Plus } from "lucide-react";
import { useRef, useState, type ComponentProps } from "react";
import { QuickAddForm, type QuickAddSubmitPayload } from "./QuickAddForm";
import type { TaskCreationOkrTarget, TaskCreationResult } from "./lib/taskCreation";
import type { OkrKeyResult } from "./types";

export type OkrTaskCreation = {
  formProps: Pick<ComponentProps<typeof QuickAddForm>,
    "now" | "dateTimePreferences" | "members" | "labels" | "labelPermissionLevels"
    | "userLabelOrder" | "currentUserId">;
  onCreateTask: (payload: QuickAddSubmitPayload, target: TaskCreationOkrTarget) => Promise<TaskCreationResult>;
  onRetryLink: (taskId: string, target: TaskCreationOkrTarget) => Promise<void>;
};

export function OkrTaskComposer({ workspaceId, target, keyResults = [], creation, online, editable, onNotice, onOpenTask }: {
  workspaceId: string;
  target: { kind: "objective" | "key_result"; id: string; label: string };
  keyResults?: OkrKeyResult[];
  creation: OkrTaskCreation;
  online: boolean;
  editable: boolean;
  onNotice: (message: string, tone?: "success" | "error") => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(keyResults[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [unlinkedTask, setUnlinkedTask] = useState<{ taskId: string; target: TaskCreationOkrTarget } | null>(null);
  const keyResultId = target.kind === "key_result" ? target.id
    : keyResults.some((result) => result.id === selectedId) ? selectedId : keyResults[0]?.id ?? "";
  const keyResult = keyResults.find((result) => result.id === keyResultId);
  const canCreate = editable && Boolean(keyResult) && !unlinkedTask;

  async function linkTask(taskId: string, linkTarget: TaskCreationOkrTarget) {
    try {
      await creation.onRetryLink(taskId, linkTarget);
      setUnlinkedTask(null);
    } catch (cause) {
      onNotice(`待办已创建，关联 KR 失败：${cause instanceof Error ? cause.message : "请重试"}`, "error");
    }
  }

  async function submit(payload: QuickAddSubmitPayload) {
    if (!online || !canCreate || !keyResult || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const linkTarget: TaskCreationOkrTarget = {
        keyResultId, objectiveId: keyResult.objective_id, title: keyResult.title, position: keyResult.position,
      };
      const created = await creation.onCreateTask(payload, linkTarget);
      if (created.okrLinkError) {
        setUnlinkedTask({ taskId: created.id, target: linkTarget });
        onNotice(`待办已创建，关联 KR 失败：${created.okrLinkError}`, "error");
      }
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : "创建待办失败，请重试", "error");
      throw cause;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return <div className="okr-task-composer">
    {target.kind === "objective" && keyResults.length > 0 && <label className="okr-task-composer-target">
      <span>关联 KR</span>
      <select aria-label="新待办关联的 KR" value={keyResultId} disabled={!online || !editable || busy || Boolean(unlinkedTask)} onChange={(event) => setSelectedId(event.target.value)}>
        {keyResults.map((result, index) => <option key={result.id} value={result.id}>KR{index + 1} · {result.title}</option>)}
      </select>
    </label>}
    <QuickAddForm
      {...creation.formProps}
      online={online}
      canManage={Boolean(canCreate) && !busy}
      busy={busy}
      kind="todo"
      placeholder={!online ? "离线状态下不可新增任务" : !editable ? "当前 OKR 为只读" : !keyResultId ? "请先添加 KR" : `添加待办至“${target.label}”`}
      leadingIcon={<Plus />}
      settings={null}
      onSubmit={submit}
    />
    {unlinkedTask && <div className="okr-task-composer-retry" role="status">
      <span>待办已创建，尚未关联 KR</span>
      <button type="button" disabled={!online || !editable || busy} onClick={async () => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        try { await linkTask(unlinkedTask.taskId, unlinkedTask.target); }
        finally { busyRef.current = false; setBusy(false); }
      }}>重试关联</button>
      <button type="button" onClick={() => onOpenTask(unlinkedTask.taskId)}>查看待办</button>
    </div>}
  </div>;
}
