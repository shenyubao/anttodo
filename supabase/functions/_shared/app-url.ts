const DEFAULT_PUBLIC_APP_URL = "https://app.anttodo.com";

export function publicAppUrl(configuredAppUrl?: string | null) {
  return (configuredAppUrl?.trim() || DEFAULT_PUBLIC_APP_URL).replace(/\/+$/, "");
}

export function buildTaskOpenUrl(
  workspaceId: string,
  taskId: string,
  taskKind?: string | null,
  configuredAppUrl?: string | null,
) {
  const segment = taskKind === "note" ? "notes" : "tasks";
  return `${publicAppUrl(configuredAppUrl)}/workspaces/${encodeURIComponent(workspaceId)}/${segment}/${encodeURIComponent(taskId)}`;
}
