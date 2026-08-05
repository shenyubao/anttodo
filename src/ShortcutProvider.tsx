import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  SHORTCUT_ACTIONS,
  bindingFromKeyboardEvent,
  detectShortcutPlatform,
  findBindingConflict,
  getEffectiveBindings,
  getShortcutAction,
  isEditableKeyboardTarget,
  loadShortcutOverrides,
  matchBinding,
  saveShortcutOverrides,
  type KeyBinding,
  type ShortcutActionId,
  type ShortcutOverrides,
  type ShortcutPlatform,
  type ShortcutScope,
} from "./lib/keyboardShortcuts";

export const FLUSH_PENDING_EDITS_EVENT = "anttodo:flush-pending-edits";

export function requestFlushPendingEdits() {
  window.dispatchEvent(new CustomEvent(FLUSH_PENDING_EDITS_EVENT));
}

type ShortcutHandler = () => void | boolean | Promise<void>;

type SetOverrideResult =
  | { ok: true }
  | { ok: false; conflict: ShortcutActionId; label: string };

type ShortcutContextValue = {
  overrides: ShortcutOverrides;
  platform: ShortcutPlatform;
  activeScope: ShortcutScope;
  setActiveScope: (scope: ShortcutScope) => void;
  suspended: boolean;
  setSuspended: (suspended: boolean) => void;
  registerHandler: (id: ShortcutActionId, handler: ShortcutHandler) => () => void;
  setOverride: (id: ShortcutActionId, binding: KeyBinding) => SetOverrideResult;
  resetOverride: (id: ShortcutActionId) => void;
  getBindings: (id: ShortcutActionId) => KeyBinding[];
};

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

export function ShortcutProvider({
  children,
  initialScope = "tasks",
}: {
  children: ReactNode;
  initialScope?: ShortcutScope;
}) {
  const [overrides, setOverrides] = useState<ShortcutOverrides>(() => loadShortcutOverrides());
  const [activeScope, setActiveScope] = useState<ShortcutScope>(initialScope);
  const [suspended, setSuspended] = useState(false);
  const handlersRef = useRef(new Map<ShortcutActionId, ShortcutHandler>());
  const overridesRef = useRef(overrides);
  const activeScopeRef = useRef(activeScope);
  const suspendedRef = useRef(suspended);
  const platform = useMemo(() => detectShortcutPlatform(), []);

  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);

  useEffect(() => {
    activeScopeRef.current = activeScope;
  }, [activeScope]);

  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);

  const registerHandler = useCallback((id: ShortcutActionId, handler: ShortcutHandler) => {
    handlersRef.current.set(id, handler);
    return () => {
      if (handlersRef.current.get(id) === handler) {
        handlersRef.current.delete(id);
      }
    };
  }, []);

  const setOverride = useCallback((id: ShortcutActionId, binding: KeyBinding): SetOverrideResult => {
    const action = getShortcutAction(id);
    if (!action.remappable) {
      return { ok: false, conflict: id, label: action.label };
    }
    const conflict = findBindingConflict(id, binding, overridesRef.current);
    if (conflict) {
      return { ok: false, conflict, label: getShortcutAction(conflict).label };
    }
    setOverrides((current) => {
      const next = { ...current, [id]: binding };
      saveShortcutOverrides(next);
      return loadShortcutOverrides();
    });
    return { ok: true };
  }, []);

  const resetOverride = useCallback((id: ShortcutActionId) => {
    setOverrides((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      saveShortcutOverrides(next);
      return loadShortcutOverrides();
    });
  }, []);

  const getBindings = useCallback(
    (id: ShortcutActionId) => getEffectiveBindings(id, overrides),
    [overrides],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (suspendedRef.current) return;

      const binding = bindingFromKeyboardEvent(event);
      if (!binding) return;

      const editable = isEditableKeyboardTarget(event.target);
      const scope = activeScopeRef.current;
      const currentOverrides = overridesRef.current;

      for (const action of SHORTCUT_ACTIONS) {
        if (!action.scopes.includes("global") && !action.scopes.includes(scope)) continue;
        if (editable && !action.allowInInput) continue;

        const bindings = getEffectiveBindings(action.id, currentOverrides);
        const matched = bindings.some((candidate) => matchBinding(event, candidate));
        if (!matched) continue;

        const handler = handlersRef.current.get(action.id);
        if (!handler) continue;

        const result = handler();
        if (result === false) continue;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const value = useMemo<ShortcutContextValue>(
    () => ({
      overrides,
      platform,
      activeScope,
      setActiveScope,
      suspended,
      setSuspended,
      registerHandler,
      setOverride,
      resetOverride,
      getBindings,
    }),
    [
      overrides,
      platform,
      activeScope,
      suspended,
      registerHandler,
      setOverride,
      resetOverride,
      getBindings,
    ],
  );

  return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>;
}

export function useShortcuts() {
  const value = useContext(ShortcutContext);
  if (!value) {
    throw new Error("useShortcuts must be used within ShortcutProvider");
  }
  return value;
}

export function useShortcutHandler(id: ShortcutActionId, handler: ShortcutHandler) {
  const { registerHandler } = useShortcuts();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return registerHandler(id, () => handlerRef.current());
  }, [id, registerHandler]);
}
