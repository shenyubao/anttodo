export type ShortcutScope = "global" | "tasks" | "calendar" | "mindmap";

export type ShortcutGroup = "general" | "tasks" | "calendar" | "mindmap";

export type ShortcutActionId =
  | "general.flushSave"
  | "general.search"
  | "general.settings"
  | "general.shortcutsHelp"
  | "general.goTasks"
  | "general.goCalendar"
  | "general.goMindmap"
  | "task.focusQuickAdd"
  | "task.addSubtask"
  | "task.complete"
  | "task.delete"
  | "calendar.viewDay"
  | "calendar.viewWeek"
  | "calendar.viewMonth"
  | "calendar.viewYear"
  | "calendar.viewAgenda"
  | "calendar.today"
  | "calendar.prev"
  | "calendar.next"
  | "mindmap.newTask"
  | "mindmap.fitView";

export type KeyBinding = {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export type ShortcutActionDefinition = {
  id: ShortcutActionId;
  group: ShortcutGroup;
  label: string;
  defaultBinding: KeyBinding;
  remappable: boolean;
  allowInInput: boolean;
  scopes: ShortcutScope[];
};

export type ShortcutOverrides = Partial<Record<ShortcutActionId, KeyBinding>>;

export const SHORTCUT_STORAGE_KEY = "anttodo:keyboard-shortcuts";

export const SHORTCUT_GROUP_LABELS: Record<ShortcutGroup, string> = {
  general: "通用",
  tasks: "任务",
  calendar: "日历",
  mindmap: "思维导图",
};

export const SHORTCUT_ACTIONS: ShortcutActionDefinition[] = [
  {
    id: "general.flushSave",
    group: "general",
    label: "保存",
    defaultBinding: { key: "s", mod: true },
    remappable: true,
    allowInInput: true,
    scopes: ["global"],
  },
  {
    id: "general.search",
    group: "general",
    label: "打开搜索",
    defaultBinding: { key: "k", mod: true },
    remappable: true,
    allowInInput: false,
    scopes: ["global"],
  },
  {
    id: "general.settings",
    group: "general",
    label: "打开设置",
    defaultBinding: { key: ",", mod: true },
    remappable: true,
    allowInInput: false,
    scopes: ["global"],
  },
  {
    id: "general.shortcutsHelp",
    group: "general",
    label: "快捷键",
    defaultBinding: { key: "?" },
    remappable: true,
    allowInInput: false,
    scopes: ["global"],
  },
  {
    id: "general.goTasks",
    group: "general",
    label: "切换到任务",
    defaultBinding: { key: "1", mod: true },
    remappable: true,
    allowInInput: false,
    scopes: ["global"],
  },
  {
    id: "general.goCalendar",
    group: "general",
    label: "切换到日历",
    defaultBinding: { key: "2", mod: true },
    remappable: true,
    allowInInput: false,
    scopes: ["global"],
  },
  {
    id: "general.goMindmap",
    group: "general",
    label: "切换到思维导图",
    defaultBinding: { key: "3", mod: true },
    remappable: true,
    allowInInput: false,
    scopes: ["global"],
  },
  {
    id: "task.focusQuickAdd",
    group: "tasks",
    label: "添加任务",
    defaultBinding: { key: "n" },
    remappable: true,
    allowInInput: false,
    scopes: ["tasks"],
  },
  {
    id: "task.addSubtask",
    group: "tasks",
    label: "添加子任务",
    defaultBinding: { key: "Enter", shift: true },
    remappable: true,
    allowInInput: false,
    scopes: ["tasks"],
  },
  {
    id: "task.complete",
    group: "tasks",
    label: "完成/重开任务",
    defaultBinding: { key: "Enter", mod: true },
    remappable: true,
    allowInInput: false,
    scopes: ["tasks"],
  },
  {
    id: "task.delete",
    group: "tasks",
    label: "删除任务",
    defaultBinding: { key: "Backspace", mod: true },
    remappable: true,
    allowInInput: false,
    scopes: ["tasks"],
  },
  {
    id: "calendar.viewDay",
    group: "calendar",
    label: "日视图",
    defaultBinding: { key: "d" },
    remappable: true,
    allowInInput: false,
    scopes: ["calendar"],
  },
  {
    id: "calendar.viewWeek",
    group: "calendar",
    label: "周视图",
    defaultBinding: { key: "w" },
    remappable: true,
    allowInInput: false,
    scopes: ["calendar"],
  },
  {
    id: "calendar.viewMonth",
    group: "calendar",
    label: "月视图",
    defaultBinding: { key: "m" },
    remappable: true,
    allowInInput: false,
    scopes: ["calendar"],
  },
  {
    id: "calendar.viewYear",
    group: "calendar",
    label: "年视图",
    defaultBinding: { key: "y" },
    remappable: true,
    allowInInput: false,
    scopes: ["calendar"],
  },
  {
    id: "calendar.viewAgenda",
    group: "calendar",
    label: "日程视图",
    defaultBinding: { key: "a" },
    remappable: true,
    allowInInput: false,
    scopes: ["calendar"],
  },
  {
    id: "calendar.today",
    group: "calendar",
    label: "今天",
    defaultBinding: { key: "t" },
    remappable: true,
    allowInInput: false,
    scopes: ["calendar"],
  },
  {
    id: "calendar.prev",
    group: "calendar",
    label: "上一段",
    defaultBinding: { key: "ArrowLeft" },
    remappable: true,
    allowInInput: false,
    scopes: ["calendar"],
  },
  {
    id: "calendar.next",
    group: "calendar",
    label: "下一段",
    defaultBinding: { key: "ArrowRight" },
    remappable: true,
    allowInInput: false,
    scopes: ["calendar"],
  },
  {
    id: "mindmap.newTask",
    group: "mindmap",
    label: "新建任务",
    defaultBinding: { key: "Enter" },
    remappable: true,
    allowInInput: false,
    scopes: ["mindmap"],
  },
  {
    id: "mindmap.fitView",
    group: "mindmap",
    label: "适应画布",
    defaultBinding: { key: "0", mod: true },
    remappable: true,
    allowInInput: false,
    scopes: ["mindmap"],
  },
];

/** Secondary defaults that also match (e.g. digit aliases for calendar views). */
export const SHORTCUT_ALIAS_BINDINGS: Partial<Record<ShortcutActionId, KeyBinding[]>> = {
  "calendar.viewDay": [{ key: "1" }],
  "calendar.viewWeek": [{ key: "2" }],
  "calendar.viewMonth": [{ key: "3" }],
  "calendar.viewYear": [{ key: "4" }],
  "calendar.viewAgenda": [{ key: "5" }],
};

const ACTION_BY_ID = new Map(SHORTCUT_ACTIONS.map((action) => [action.id, action]));

export function getShortcutAction(id: ShortcutActionId): ShortcutActionDefinition {
  const action = ACTION_BY_ID.get(id);
  if (!action) {
    throw new Error(`Unknown shortcut action: ${id}`);
  }
  return action;
}

export function normalizeKey(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toLowerCase();
  return key;
}

export function isKeyBinding(value: unknown): value is KeyBinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KeyBinding>;
  if (typeof candidate.key !== "string" || !candidate.key.trim()) return false;
  if (candidate.mod !== undefined && typeof candidate.mod !== "boolean") return false;
  if (candidate.shift !== undefined && typeof candidate.shift !== "boolean") return false;
  if (candidate.alt !== undefined && typeof candidate.alt !== "boolean") return false;
  return true;
}

export function normalizeBinding(binding: KeyBinding): KeyBinding {
  return {
    key: normalizeKey(binding.key),
    ...(binding.mod ? { mod: true } : {}),
    ...(binding.shift ? { shift: true } : {}),
    ...(binding.alt ? { alt: true } : {}),
  };
}

export function bindingsEqual(a: KeyBinding, b: KeyBinding): boolean {
  const left = normalizeBinding(a);
  const right = normalizeBinding(b);
  return (
    left.key === right.key
    && Boolean(left.mod) === Boolean(right.mod)
    && Boolean(left.shift) === Boolean(right.shift)
    && Boolean(left.alt) === Boolean(right.alt)
  );
}

export function bindingFromKeyboardEvent(event: Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>): KeyBinding | null {
  const key = event.key;
  if (
    key === "Meta"
    || key === "Control"
    || key === "Shift"
    || key === "Alt"
    || key === "OS"
  ) {
    return null;
  }
  return normalizeBinding({
    key,
    mod: event.metaKey || event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  });
}

export function matchBinding(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  binding: KeyBinding,
): boolean {
  const expected = normalizeBinding(binding);
  const actualKey = normalizeKey(event.key);
  if (actualKey !== expected.key) return false;
  const modPressed = event.metaKey || event.ctrlKey;
  if (Boolean(expected.mod) !== modPressed) return false;
  if (Boolean(expected.alt) !== event.altKey) return false;
  // Punctuation keys often require Shift; the resulting `key` already encodes that.
  const shiftMatters = expected.key.length > 1 || /^[a-z0-9]$/i.test(expected.key);
  if (shiftMatters && Boolean(expected.shift) !== event.shiftKey) return false;
  if (!shiftMatters && expected.shift && !event.shiftKey) return false;
  return true;
}

export type ShortcutPlatform = "mac" | "other";

export function detectShortcutPlatform(
  platform: string | null | undefined =
    typeof window !== "undefined"
      ? (window.anttodoDesktop?.platform ?? window.navigator.platform)
      : null,
): ShortcutPlatform {
  if (!platform) return "other";
  const value = platform.toLowerCase();
  if (value === "darwin" || value.includes("mac")) return "mac";
  return "other";
}

const DISPLAY_KEYS: Record<string, string> = {
  escape: "Esc",
  enter: "Return",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  backspace: "Backspace",
  delete: "Delete",
  space: "Space",
  tab: "Tab",
};

function displayKey(key: string): string {
  const normalized = normalizeKey(key);
  return DISPLAY_KEYS[normalized.toLowerCase()] ?? (normalized.length === 1 ? normalized.toUpperCase() : normalized);
}

export function formatBinding(
  binding: KeyBinding,
  platform: ShortcutPlatform = detectShortcutPlatform(),
): string {
  const parts: string[] = [];
  if (binding.mod) parts.push(platform === "mac" ? "⌘" : "Ctrl");
  if (binding.shift) parts.push("⇧");
  if (binding.alt) parts.push(platform === "mac" ? "⌥" : "Alt");
  parts.push(displayKey(binding.key));
  return parts.join("+");
}

export function parseShortcutOverrides(raw: string | null | undefined): ShortcutOverrides {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const overrides: ShortcutOverrides = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!ACTION_BY_ID.has(id as ShortcutActionId)) continue;
      if (!isKeyBinding(value)) continue;
      const action = getShortcutAction(id as ShortcutActionId);
      if (!action.remappable) continue;
      overrides[id as ShortcutActionId] = normalizeBinding(value);
    }
    return overrides;
  } catch {
    return {};
  }
}

export function loadShortcutOverrides(
  storage: Pick<Storage, "getItem"> | null | undefined = globalThis.localStorage,
): ShortcutOverrides {
  if (!storage) return {};
  try {
    return parseShortcutOverrides(storage.getItem(SHORTCUT_STORAGE_KEY));
  } catch {
    return {};
  }
}

export function saveShortcutOverrides(
  overrides: ShortcutOverrides,
  storage: Pick<Storage, "setItem"> | null | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  const cleaned: ShortcutOverrides = {};
  for (const [id, binding] of Object.entries(overrides) as Array<[ShortcutActionId, KeyBinding]>) {
    const action = ACTION_BY_ID.get(id);
    if (!action?.remappable) continue;
    if (!isKeyBinding(binding)) continue;
    if (bindingsEqual(binding, action.defaultBinding)) continue;
    cleaned[id] = normalizeBinding(binding);
  }
  storage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(cleaned));
}

export function resolveBindings(
  overrides: ShortcutOverrides = {},
): Record<ShortcutActionId, KeyBinding> {
  const resolved = {} as Record<ShortcutActionId, KeyBinding>;
  for (const action of SHORTCUT_ACTIONS) {
    const override = overrides[action.id];
    resolved[action.id] = override && action.remappable
      ? normalizeBinding(override)
      : normalizeBinding(action.defaultBinding);
  }
  return resolved;
}

export function getEffectiveBindings(
  actionId: ShortcutActionId,
  overrides: ShortcutOverrides = {},
): KeyBinding[] {
  const action = getShortcutAction(actionId);
  const primary = overrides[actionId] && action.remappable
    ? normalizeBinding(overrides[actionId]!)
    : normalizeBinding(action.defaultBinding);
  const aliases = SHORTCUT_ALIAS_BINDINGS[actionId] ?? [];
  // Aliases only apply when using the default primary binding.
  if (overrides[actionId] && action.remappable) {
    return [primary];
  }
  return [primary, ...aliases.map(normalizeBinding)];
}

export function findBindingConflict(
  actionId: ShortcutActionId,
  binding: KeyBinding,
  overrides: ShortcutOverrides = {},
): ShortcutActionId | null {
  const candidate = normalizeBinding(binding);
  const target = getShortcutAction(actionId);
  const targetScopes = new Set(target.scopes);

  for (const action of SHORTCUT_ACTIONS) {
    if (action.id === actionId) continue;
    const scopesOverlap = action.scopes.some((scope) => targetScopes.has(scope));
    if (!scopesOverlap) continue;
    for (const existing of getEffectiveBindings(action.id, overrides)) {
      if (bindingsEqual(existing, candidate)) {
        return action.id;
      }
    }
  }
  return null;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function actionsByGroup(): Array<{
  group: ShortcutGroup;
  label: string;
  actions: ShortcutActionDefinition[];
}> {
  const groups: ShortcutGroup[] = ["general", "tasks", "calendar", "mindmap"];
  return groups.map((group) => ({
    group,
    label: SHORTCUT_GROUP_LABELS[group],
    actions: SHORTCUT_ACTIONS.filter((action) => action.group === group),
  }));
}
