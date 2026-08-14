import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import {
  saveDisplayPreference,
  useShowContactNames,
} from "./lib/displayPreference";
import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
  type ThemeId,
  type ThemePreference,
} from "./lib/themePreference";

const THEME_OPTIONS: Array<{ id: ThemeId; label: string }> = [
  { id: "default", label: "默认" },
  { id: "dark", label: "暗夜" },
];

export function AppearanceSettingsPanel() {
  const [preference, setPreference] = useState<ThemePreference>(() => loadThemePreference());
  const showContactNames = useShowContactNames();

  useEffect(() => {
    applyThemePreference(preference);
    saveThemePreference(preference);
  }, [preference]);

  function setFollowSystem(followSystem: boolean) {
    setPreference((current) => ({ ...current, followSystem }));
  }

  function selectTheme(theme: ThemeId) {
    setPreference({ followSystem: false, theme });
  }

  return (
    <section className="appearance-settings" aria-labelledby="appearance-settings-title">
      <h1 id="appearance-settings-title">外观</h1>

      <div className="appearance-settings-card">
        <label className="date-time-setting-row">
          <span>跟随系统</span>
          <span className="date-time-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="跟随系统"
              checked={preference.followSystem}
              onChange={(event) => setFollowSystem(event.target.checked)}
            />
            <i aria-hidden="true" />
          </span>
        </label>
        <p className="appearance-settings-hint">开启后，界面明暗随系统外观自动切换。</p>
      </div>

      <div className="appearance-theme-section">
        <h2 className="appearance-theme-section-title">主题</h2>
        <div className="appearance-theme-grid" role="listbox" aria-label="主题">
          {THEME_OPTIONS.map((option) => {
            const selected = !preference.followSystem && preference.theme === option.id;
            return (
              <button
                type="button"
                key={option.id}
                role="option"
                aria-selected={selected}
                className={selected ? "appearance-theme-card selected" : "appearance-theme-card"}
                onClick={() => selectTheme(option.id)}
              >
                <span className={`appearance-theme-preview theme-${option.id}`} aria-hidden="true">
                  <span className="appearance-theme-preview-rail" />
                  <span className="appearance-theme-preview-sidebar" />
                  <span className="appearance-theme-preview-main">
                    <span />
                    <span />
                    <span />
                  </span>
                  {selected && (
                    <span className="appearance-theme-check">
                      <Check aria-hidden="true" />
                    </span>
                  )}
                </span>
                <span className="appearance-theme-label">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="appearance-theme-section">
        <h2 className="appearance-theme-section-title">显示</h2>
        <div className="appearance-settings-card">
          <label className="date-time-setting-row">
            <span>展示联系人名称</span>
            <span className="date-time-switch">
              <input
                type="checkbox"
                role="switch"
                aria-label="展示联系人名称"
                checked={showContactNames}
                onChange={(event) => {
                  saveDisplayPreference({
                    showContactNames: event.target.checked,
                  });
                }}
              />
              <i aria-hidden="true" />
            </span>
          </label>
          <p className="appearance-settings-hint">
            开启后，任务列表与详情中的负责人头像后会显示联系人名称。
          </p>
        </div>
      </div>
    </section>
  );
}
