export const DEEP_LINK_SCHEME = "anttodo";
export const DEEP_LINK_PREFIX = `${DEEP_LINK_SCHEME}://`;

const SYSTEM_VIEWS = new Set([
  "all",
  "today",
  "week",
  "assigned",
  "watching",
  "inbox",
  "trash",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeIdentifier(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 200
    && !/[\u0000-\u001f\u007f/?#]/.test(value)
    ? value
    : null;
}

function readQuery(url, allowedKeys) {
  const values = {};
  for (const key of url.searchParams.keys()) {
    if (!allowedKeys.has(key) || values[key] !== undefined) return null;
    const value = url.searchParams.get(key);
    if (value === null) return null;
    values[key] = value;
  }
  return values;
}

function workspaceIdFrom(values) {
  return values.workspace === undefined ? null : safeIdentifier(values.workspace);
}

function parseView(values) {
  const view = safeIdentifier(values.view);
  if (!view) return null;
  if (SYSTEM_VIEWS.has(view)) return view;
  if (view.startsWith("custom:") && UUID_PATTERN.test(view.slice("custom:".length))) {
    return view;
  }
  return null;
}

/**
 * Parse an application deep link into a renderer-safe command.
 * Unknown fields and malformed commands are rejected before crossing IPC.
 */
export function parseDesktopDeepLink(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    url.protocol !== `${DEEP_LINK_SCHEME}:`
    || url.username
    || url.password
    || url.port
    || url.hash
  ) return null;

  if (url.hostname === "open") {
    const target = url.pathname.slice(1);
    if (url.pathname.split("/").filter(Boolean).length !== 1) return null;

    if (target === "view") {
      const values = readQuery(url, new Set(["workspace", "view"]));
      if (!values || values.view === undefined) return null;
      const workspaceId = workspaceIdFrom(values);
      const view = parseView(values);
      return view === null || (values.workspace !== undefined && workspaceId === null)
        ? null
        : { type: "navigate", target: "view", workspaceId, view };
    }

    if (target === "task") {
      const values = readQuery(url, new Set(["workspace", "task"]));
      if (!values || values.task === undefined) return null;
      const workspaceId = workspaceIdFrom(values);
      const taskId = safeIdentifier(values.task);
      return taskId === null || (values.workspace !== undefined && workspaceId === null)
        ? null
        : { type: "navigate", target: "task", workspaceId, taskId };
    }

    if (target === "calendar" || target === "focus") {
      const values = readQuery(url, new Set(["workspace"]));
      if (!values) return null;
      const workspaceId = workspaceIdFrom(values);
      return values.workspace !== undefined && workspaceId === null
        ? null
        : { type: "navigate", target, workspaceId };
    }
    return null;
  }

  if (url.hostname === "focus") {
    const path = url.pathname.split("/").filter(Boolean);
    if (path.length === 1 && path[0] === "switch") {
      const values = readQuery(url, new Set(["workspace", "task"]));
      if (!values || values.task === undefined) return null;
      const workspaceId = workspaceIdFrom(values);
      const taskId = safeIdentifier(values.task);
      return taskId === null || (values.workspace !== undefined && workspaceId === null)
        ? null
        : { type: "focus", action: "switch", workspaceId, taskId };
    }

    if (path.length !== 2 || !["pomodoro", "stopwatch"].includes(path[0])) return null;
    if (!["start", "pause", "stop"].includes(path[1])) return null;
    const allowedKeys = path[1] === "start"
      ? new Set(["workspace", "task"])
      : new Set(["workspace"]);
    const values = readQuery(url, allowedKeys);
    if (!values) return null;
    const workspaceId = workspaceIdFrom(values);
    const taskId = values.task === undefined ? null : safeIdentifier(values.task);
    if (
      (values.workspace !== undefined && workspaceId === null)
      || (values.task !== undefined && taskId === null)
    ) return null;
    return {
      type: "focus",
      action: path[1],
      mode: path[0],
      workspaceId,
      ...(taskId ? { taskId } : {}),
    };
  }

  return null;
}

export function createDeepLinkQueue(maxSize = 20) {
  const commands = [];
  return {
    enqueue(command) {
      if (!command) return false;
      commands.push(command);
      if (commands.length > maxSize) commands.shift();
      return true;
    },
    take() {
      return commands.shift() ?? null;
    },
    hasPending() {
      return commands.length > 0;
    },
  };
}
