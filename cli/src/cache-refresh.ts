import {
  getTask,
  listTasks,
  listWorkspaces,
} from "./api.js";
import { authenticatedContext } from "./client.js";
import {
  taskCacheKey,
  taskListCacheKey,
  writeCacheEntry,
  workspaceCacheKey,
  type CacheRefreshRequest,
} from "./cache.js";

export async function runCacheRefresh(request: CacheRefreshRequest) {
  const context = await authenticatedContext();
  if (context.user.id !== request.userId) return;

  if (request.type === "workspaces") {
    const data = await listWorkspaces(context);
    await writeCacheEntry(workspaceCacheKey(request.userId), data);
    return;
  }

  if (request.type === "task-list") {
    const data = await listTasks(
      context.client,
      request.workspaceId,
      request.taskKind,
      request.options,
    );
    await writeCacheEntry(
      taskListCacheKey(request.userId, request.workspaceId, request.taskKind, request.options),
      data,
    );
    return;
  }

  const data = await getTask(
    context.client,
    request.workspaceId,
    request.taskId,
    request.taskKind,
  );
  await writeCacheEntry(
    taskCacheKey(request.userId, request.workspaceId, request.taskKind, request.taskId),
    data,
  );
}
