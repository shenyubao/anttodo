import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FocusSettings } from "./types";

export function FocusSettingsDialog({
  open,
  settings,
  online,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  settings: FocusSettings;
  online: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (settings: FocusSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setSaving(false);
    setError("");
  }, [open, settings]);

  async function save() {
    if (!online || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content focus-settings-dialog" aria-describedby={undefined}>
          <header>
            <Dialog.Title>计时选项</Dialog.Title>
            <Dialog.Close className="dialog-close" aria-label="关闭">
              <X />
            </Dialog.Close>
          </header>
          <div className="focus-settings-body">
            <section>
              <h3>计时选项</h3>
              <label className="focus-settings-field">
                <span>番茄时长</span>
                <div>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={draft.pomodoro_minutes}
                    disabled={!online}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      pomodoro_minutes: clampInt(event.target.value, 1, 180, 25),
                    }))}
                  />
                  <span>分钟</span>
                </div>
              </label>
              <label className="focus-settings-field">
                <span>短休息时长</span>
                <div>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={draft.short_break_minutes}
                    disabled={!online}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      short_break_minutes: clampInt(event.target.value, 1, 60, 5),
                    }))}
                  />
                  <span>分钟</span>
                </div>
              </label>
              <label className="focus-settings-field">
                <span>长休息时长</span>
                <div>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={draft.long_break_minutes}
                    disabled={!online}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      long_break_minutes: clampInt(event.target.value, 1, 120, 15),
                    }))}
                  />
                  <span>分钟</span>
                </div>
              </label>
              <label className="focus-settings-field">
                <span>长休息间隔番茄数</span>
                <div>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={draft.long_break_interval}
                    disabled={!online}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      long_break_interval: clampInt(event.target.value, 1, 12, 4),
                    }))}
                  />
                  <span>个</span>
                </div>
              </label>
            </section>
            <section>
              <h3>自动选项</h3>
              <label className="focus-settings-toggle">
                <span>自动开始下个番茄</span>
                <input
                  type="checkbox"
                  checked={draft.auto_start_pomodoro}
                  disabled={!online}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    auto_start_pomodoro: event.target.checked,
                  }))}
                />
              </label>
              <label className="focus-settings-toggle">
                <span>自动休息</span>
                <input
                  type="checkbox"
                  checked={draft.auto_start_break}
                  disabled={!online}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    auto_start_break: event.target.checked,
                  }))}
                />
              </label>
            </section>
            <section>
              <h3>其他</h3>
              <label className="focus-settings-toggle">
                <span>浏览器标签页计时</span>
                <input
                  type="checkbox"
                  checked={draft.show_tab_title}
                  disabled={!online}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    show_tab_title: event.target.checked,
                  }))}
                />
              </label>
              <label className="focus-settings-toggle">
                <span>番茄提示音</span>
                <input
                  type="checkbox"
                  checked={draft.sound_enabled}
                  disabled={!online}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    sound_enabled: event.target.checked,
                  }))}
                />
              </label>
            </section>
            {error && <p className="focus-settings-error">{error}</p>}
          </div>
          <footer className="dialog-actions">
            <button type="button" className="button secondary" onClick={() => onOpenChange(false)}>
              取消
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!online || saving}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function clampInt(value: string, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
