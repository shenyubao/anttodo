import type { Task } from "../types";

export function normalizeTaskQuery(query: string) {
  return query.trim().toLocaleLowerCase();
}

export function searchTasks(tasks: Task[], query: string) {
  const normalizedQuery = normalizeTaskQuery(query);
  if (!normalizedQuery) return [];

  return tasks.filter((task) => {
    if (task.deleted_at) return false;
    return [task.title, task.description].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    );
  });
}
