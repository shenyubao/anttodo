import { CalendarDays, Target, Workflow } from "lucide-react";
import type { FeatureModulePreferences } from "./lib/featureModulePreferences";

const MODULE_OPTIONS: Array<{
  key: keyof FeatureModulePreferences;
  label: string;
  icon: typeof CalendarDays;
}> = [
  {
    key: "calendarEnabled",
    label: "日历",
    icon: CalendarDays,
  },
  {
    key: "focusEnabled",
    label: "番茄专注",
    icon: Target,
  },
  {
    key: "mindMapEnabled",
    label: "思维导图",
    icon: Workflow,
  },
];

export function FeatureModulesSettingsPanel({
  preferences,
  onChange,
}: {
  preferences: FeatureModulePreferences;
  onChange: (preferences: FeatureModulePreferences) => void;
}) {
  return (
    <section className="feature-module-settings" aria-labelledby="feature-module-settings-title">
      <h1 id="feature-module-settings-title">功能模块</h1>
      <p className="feature-module-settings-description">
        选择要在主导航中显示的功能模块。隐藏后仍可通过快捷键或直达链接打开。
      </p>

      <div className="feature-module-settings-list">
        {MODULE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const enabled = preferences[option.key];
          return (
            <label className="feature-module-settings-row" key={option.key}>
              <span className="feature-module-settings-icon">
                <Icon aria-hidden="true" />
              </span>
              <span className="feature-module-settings-copy">
                <strong>{option.label}</strong>
              </span>
              <span className="date-time-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`在主导航中显示${option.label}`}
                  checked={enabled}
                  onChange={(event) => onChange({
                    ...preferences,
                    [option.key]: event.target.checked,
                  })}
                />
                <i aria-hidden="true" />
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
