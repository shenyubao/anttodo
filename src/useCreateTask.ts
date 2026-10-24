import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTask, loadWorkspaceTask } from "./lib/api";
import { setTaskOkrLink } from "./lib/okrApi";
import {
  retryTaskCreationLink, submitTaskCreation,
  type TaskCreationInput, type TaskCreationOkrTarget,
} from "./lib/taskCreation";
import { importYunxiaoWorkitemFromText, isYunxiaoQuickCreateInput } from "./lib/yunxiaoQuickCreate";
import type { WorkspaceBundle } from "./types";
import { appendTaskToBundle } from "./lib/taskCache";

export function useCreateTask({ client, workspaceId, userId, online, rememberLocalChange }: {
  client: SupabaseClient;
  workspaceId: string | null;
  userId: string;
  online: boolean;
  rememberLocalChange: (table: string, ids: Iterable<string>) => void;
}) {
  const queryClient = useQueryClient();
  const dependencies = () => {
    if (!workspaceId) throw new Error("请先选择团队空间");
    return {
      queryClient, workspaceId, userId,
      isOnline: () => online && navigator.onLine,
      create: (input: Parameters<typeof createTask>[1]) => createTask(client, input),
      link: (taskId: string, keyResultId: string) => setTaskOkrLink(client, taskId, keyResultId),
      rememberLocalChange,
    };
  };
  const creation = useMutation({
    mutationKey: ["create-task", workspaceId],
    // Reject offline immediately; never leave a paused write to replay on reconnect.
    networkMode: "always",
    retry: false,
    gcTime: 0,
    mutationFn: async (input: TaskCreationInput) => {
      const deps = dependencies();
      if (!deps.isOnline()) throw new Error("离线时无法创建任务");
      if (!input.parentTaskId && isYunxiaoQuickCreateInput(input.title)) {
        const imported = await importYunxiaoWorkitemFromText(deps.workspaceId, input.title);
        if (imported) {
          const task = await loadWorkspaceTask(client, deps.workspaceId, imported.taskId);
          if (!task) throw new Error("待办已导入，暂时无法读取，请刷新查看");
          queryClient.setQueryData<WorkspaceBundle>(["workspace-bundle", deps.workspaceId], (current) =>
            current ? appendTaskToBundle(current, task) : current);
          if (input.okrTarget) {
            try { await retryTaskCreationLink(deps, task.id, input.okrTarget); }
            catch (error) { return { ...task, okrLinkError: error instanceof Error ? error.message : "关联失败，请重试" }; }
          }
          return task;
        }
      }
      return submitTaskCreation(deps, input);
    },
  });
  const linking = useMutation({
    mutationKey: ["retry-created-task-okr-link", workspaceId],
    networkMode: "always",
    retry: false,
    gcTime: 0,
    mutationFn: ({ taskId, target }: { taskId: string; target: TaskCreationOkrTarget }) =>
      retryTaskCreationLink(dependencies(), taskId, target),
  });
  return { create: creation.mutateAsync, retryLink: linking.mutateAsync };
}
