import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink, RotateCcw, Sparkles, SquareTerminal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AI_FEATURE_OPTIONS,
  type AiFeatureId,
} from "./lib/aiFeatureSettings";
import { AI_PROMPT_OVERRIDE_MAX_LENGTH } from "../supabase/functions/_shared/ai-feature-prompts";
import type { AiFeatureSettings } from "./types";

const CLI_DOCS_URL = "https://docs.anttodo.com/cli/quickstart";

export function AiFeatureSettingsPanel({
  settings,
  online,
  onChange,
}: {
  settings: AiFeatureSettings;
  online: boolean;
  onChange: (settings: AiFeatureSettings) => Promise<void>;
}) {
  const [editingFeature, setEditingFeature] = useState<AiFeatureId | null>(null);
  const [draft, setDraft] = useState("");
  const [usingDefault, setUsingDefault] = useState(true);
  const [savingFeature, setSavingFeature] = useState<AiFeatureId | null>(null);
  const [error, setError] = useState("");

  const feature = useMemo(
    () => AI_FEATURE_OPTIONS.find((item) => item.id === editingFeature) ?? null,
    [editingFeature],
  );

  useEffect(() => {
    if (!feature) return;
    const override = settings[feature.promptKey];
    setDraft(override ?? feature.defaultInstruction);
    setUsingDefault(override === null);
    setError("");
  }, [feature, settings]);

  async function toggleFeature(featureId: AiFeatureId) {
    const option = AI_FEATURE_OPTIONS.find((item) => item.id === featureId);
    if (!option || !online || savingFeature) return;
    setSavingFeature(featureId);
    setError("");
    try {
      await onChange({
        ...settings,
        [option.enabledKey]: !settings[option.enabledKey],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 功能设置保存失败");
    } finally {
      setSavingFeature(null);
    }
  }

  async function savePrompt() {
    if (!feature || !online || savingFeature) return;
    const trimmed = draft.trim();
    if (trimmed.length > AI_PROMPT_OVERRIDE_MAX_LENGTH) {
      setError(`提示词不能超过 ${AI_PROMPT_OVERRIDE_MAX_LENGTH} 个字符`);
      return;
    }
    const override = usingDefault || !trimmed || trimmed === feature.defaultInstruction
      ? null
      : trimmed;
    setSavingFeature(feature.id);
    setError("");
    try {
      await onChange({ ...settings, [feature.promptKey]: override });
      setEditingFeature(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提示词保存失败");
    } finally {
      setSavingFeature(null);
    }
  }

  return (
    <section className="ai-feature-settings" aria-labelledby="ai-feature-settings-title">
      <h1 id="ai-feature-settings-title">AI功能</h1>

      <section className="ai-feature-settings-section" aria-labelledby="ai-feature-links-title">
        <h2 id="ai-feature-links-title">关联</h2>
        <a
          className="ai-feature-link-card"
          href={CLI_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="ai-feature-card-icon"><SquareTerminal aria-hidden="true" /></span>
          <span className="ai-feature-card-copy">
            <strong>蚂蚁清单 CLI</strong>
            <span>在终端、脚本和 CI 中管理任务</span>
          </span>
          <ExternalLink aria-hidden="true" />
        </a>
      </section>

      <section className="ai-feature-settings-section" aria-labelledby="ai-feature-functions-title">
        <h2 id="ai-feature-functions-title">功能</h2>
        <div className="ai-feature-list">
          {AI_FEATURE_OPTIONS.map((option) => {
            const enabled = settings[option.enabledKey];
            const overridden = settings[option.promptKey] !== null;
            return (
              <article className="ai-feature-row" key={option.id}>
                <span className="ai-feature-card-icon"><Sparkles aria-hidden="true" /></span>
                <span className="ai-feature-card-copy">
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                  <button
                    type="button"
                    className="ai-feature-prompt-button"
                    disabled={!online || savingFeature !== null}
                    onClick={() => setEditingFeature(option.id)}
                  >
                    覆盖提示词
                    <em>{overridden ? "已覆盖" : "默认"}</em>
                  </button>
                </span>
                <label className="date-time-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={option.label}
                    checked={enabled}
                    disabled={!online || savingFeature !== null}
                    onChange={() => void toggleFeature(option.id)}
                  />
                  <i aria-hidden="true" />
                </label>
              </article>
            );
          })}
        </div>
      </section>

      {!online && <p className="date-time-offline-note">离线模式下设置为只读</p>}
      {error && !editingFeature && <p className="ai-feature-settings-error" role="alert">{error}</p>}

      <Dialog.Root
        open={editingFeature !== null}
        onOpenChange={(open) => {
          if (!open && !savingFeature) setEditingFeature(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay ai-prompt-overlay" />
          <Dialog.Content
            className="dialog-content ai-prompt-dialog"
            aria-describedby="ai-prompt-description"
          >
            <header>
              <Dialog.Title>覆盖{feature?.label ?? "AI 功能"}提示词</Dialog.Title>
              <Dialog.Close aria-label="关闭提示词编辑器"><X /></Dialog.Close>
            </header>
            <div className="ai-prompt-dialog-body">
              <p id="ai-prompt-description">
                这里只覆盖业务指令；输出格式、任务上下文和必要约束仍由服务端提供。
              </p>
              <textarea
                aria-label={`${feature?.label ?? "AI 功能"}提示词`}
                value={draft}
                disabled={!online || savingFeature !== null}
                maxLength={AI_PROMPT_OVERRIDE_MAX_LENGTH}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setUsingDefault(false);
                  setError("");
                }}
              />
              <div className="ai-prompt-dialog-meta">
                <span>{usingDefault ? "当前使用默认提示词" : "将保存为用户覆盖"}</span>
                <span>{draft.length}/{AI_PROMPT_OVERRIDE_MAX_LENGTH}</span>
              </div>
              {error && <p className="ai-feature-settings-error" role="alert">{error}</p>}
            </div>
            <footer>
              <button
                type="button"
                className="button ai-prompt-reset"
                disabled={!online || savingFeature !== null || usingDefault}
                onClick={() => {
                  if (!feature) return;
                  setDraft(feature.defaultInstruction);
                  setUsingDefault(true);
                  setError("");
                }}
              >
                <RotateCcw aria-hidden="true" />恢复默认
              </button>
              <span className="ai-prompt-dialog-actions">
                <Dialog.Close className="button secondary" disabled={savingFeature !== null}>
                  取消
                </Dialog.Close>
                <button
                  type="button"
                  className="button primary"
                  disabled={!online || savingFeature !== null}
                  onClick={() => void savePrompt()}
                >
                  {savingFeature ? "保存中…" : "保存"}
                </button>
              </span>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
