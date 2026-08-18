import type { AiCliTool, AiWorkSettings, AssigneeTarget, Task } from "../types";
import { untrackAiTerminalSession } from "./aiTerminalSessions";

export const AI_CLI_OPTIONS: Array<{ value: AiCliTool; label: string }> = [
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude" },
];

export const OPEN_AI_WORK_SETTINGS_EVENT = "anttodo:open-ai-work-settings";

export function requestAiWorkSettings(options?: { title?: string }) {
  window.dispatchEvent(new CustomEvent(OPEN_AI_WORK_SETTINGS_EVENT, {
    detail: { title: options?.title },
  }));
}

export function aiWorkSettingsTitleFromEvent(event: Event, fallback = "设置 AI CLI") {
  const title = event instanceof CustomEvent
    ? event.detail?.title
    : undefined;
  return typeof title === "string" && title.trim() ? title.trim() : fallback;
}

export function isAiWorkConfigured(settings: Pick<AiWorkSettings, "cli_tools" | "default_working_path">) {
  return settings.cli_tools.length > 0 && Boolean(settings.default_working_path?.trim());
}

export function aiCliLabel(tool: AiCliTool) {
  return AI_CLI_OPTIONS.find((option) => option.value === tool)?.label ?? tool;
}

export function taskAssigneeTarget(task: Pick<Task, "assignee_id" | "cli_assignee">): AssigneeTarget {
  if (task.cli_assignee) return { kind: "cli", tool: task.cli_assignee };
  if (task.assignee_id) return { kind: "user", userId: task.assignee_id };
  return { kind: "none" };
}

export function sameAssignee(left: AssigneeTarget, right: AssigneeTarget) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "user" && right.kind === "user") return left.userId === right.userId;
  if (left.kind === "cli" && right.kind === "cli") return left.tool === right.tool;
  return left.kind === "none" && right.kind === "none";
}

export function taskTerminalSessionKey(taskId: string) {
  return `task:${taskId}`;
}

export function stopCliTerminalsForTask(
  taskId: string,
  targetTaskIds: Iterable<string> = [],
) {
  const bridge = window.anttodoDesktop?.aiWork?.terminal;
  const sessionIds = [
    taskTerminalSessionKey(taskId),
    ...[...targetTaskIds].map((targetTaskId) => taskTerminalSessionKey(targetTaskId)),
  ];
  for (const sessionId of sessionIds) {
    if (bridge) void bridge.stop(sessionId);
    untrackAiTerminalSession(sessionId);
  }
}

export function buildTaskCliPrompt(task: Pick<Task, "title" | "description">) {
  const lines = [
    "请处理如下待办。",
    "",
    `标题：${task.title.trim() || "（无标题）"}`,
  ];
  const description = task.description.trim();
  if (description) {
    lines.push("描述：", description);
  }
  return lines.join("\n");
}

export function buildChildTaskCliPrompt(
  task: Pick<Task, "title" | "description">,
  childTask: Pick<Task, "title">,
) {
  const lines = [
    "请只处理下面指定的 AntTodo 子级任务，并使用父任务信息作为上下文。",
    "",
    `父任务标题：${task.title.trim() || "（无标题）"}`,
  ];
  const description = task.description.trim();
  if (description) {
    lines.push("父任务描述：", description);
  }
  lines.push("", `当前子级任务：${childTask.title.trim() || "（无标题）"}`);
  return lines.join("\n");
}
