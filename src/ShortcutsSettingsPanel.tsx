import { useEffect, useState } from "react";
import { useShortcuts } from "./ShortcutProvider";
import {
  actionsByGroup,
  bindingFromKeyboardEvent,
  formatBinding,
  getEffectiveBindings,
  type KeyBinding,
  type ShortcutActionId,
} from "./lib/keyboardShortcuts";

export function ShortcutsSettingsPanel({
  onNotice,
}: {
  onNotice?: (message: string) => void;
}) {
  const {
    overrides,
    platform,
    setOverride,
    resetOverride,
  } = useShortcuts();
  const [capturingId, setCapturingId] = useState<ShortcutActionId | null>(null);

  useEffect(() => {
    if (!capturingId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setCapturingId(null);
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        resetOverride(capturingId);
        setCapturingId(null);
        onNotice?.("已恢复默认快捷键");
        return;
      }

      const binding = bindingFromKeyboardEvent(event);
      if (!binding) return;

      const result = setOverride(capturingId, binding);
      if (!result.ok) {
        onNotice?.(`快捷键与「${result.label}」冲突`);
        return;
      }
      setCapturingId(null);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturingId, onNotice, resetOverride, setOverride]);

  function bindingLabel(id: ShortcutActionId, remappable: boolean, defaultBinding: KeyBinding) {
    const bindings = getEffectiveBindings(id, overrides);
    if (!remappable) {
      return formatBinding(defaultBinding, platform);
    }
    const primary = bindings[0] ?? defaultBinding;
    const aliasText = bindings.length > 1
      ? ` / ${bindings.slice(1).map((item) => formatBinding(item, platform)).join(" / ")}`
      : "";
    return `${formatBinding(primary, platform)}${aliasText}`;
  }

  return (
    <section className="shortcuts-settings" aria-labelledby="shortcuts-settings-title">
      <h1 id="shortcuts-settings-title">快捷键</h1>

      {actionsByGroup().map((group) => (
        <div className="shortcuts-settings-group" key={group.group}>
          <h2 className="shortcuts-settings-group-title">{group.label}</h2>
          <div className="shortcuts-settings-card">
            {group.actions.map((action) => {
              const capturing = capturingId === action.id;
              const label = bindingLabel(action.id, action.remappable, action.defaultBinding);
              return (
                <div className="shortcuts-settings-row" key={action.id}>
                  <span className="shortcuts-settings-label">{action.label}</span>
                  {action.remappable ? (
                    <button
                      type="button"
                      className={
                        capturing
                          ? "shortcuts-settings-binding capturing"
                          : "shortcuts-settings-binding"
                      }
                      aria-label={`设置「${action.label}」快捷键，当前 ${label}`}
                      onClick={() => setCapturingId(action.id)}
                    >
                      {capturing ? "按下新的快捷键…" : label}
                    </button>
                  ) : (
                    <span className="shortcuts-settings-binding fixed">{label}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
