import * as Dialog from "@radix-ui/react-dialog";
import { Check, FolderOpen, SquareTerminal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AI_CLI_OPTIONS } from "./lib/aiWork";
import type { AiCliTool, AiWorkSettings } from "./types";

export function AiWorkSettingsDialog({
  open,
  title = "设置 AI CLI",
  settings,
  online,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  title?: string;
  settings: AiWorkSettings;
  online: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (settings: AiWorkSettings) => Promise<void>;
}) {
  const [tools, setTools] = useState<AiCliTool[]>(settings.cli_tools);
  const [path, setPath] = useState(settings.default_working_path ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTools(settings.cli_tools);
    setPath(settings.default_working_path ?? "");
    setSaving(false);
    setError("");
  }, [open, settings]);

  function toggleTool(tool: AiCliTool) {
    setTools((current) => current.includes(tool)
      ? current.filter((item) => item !== tool)
      : [...current, tool]);
  }

  async function chooseDirectory() {
    const selected = await window.anttodoDesktop?.aiWork.selectDirectory();
    if (selected) {
      setPath(selected);
      setError("");
    }
  }

  async function save() {
    if (!online || saving) return;
    if (tools.length > 0 && !path.trim()) {
      setError("启用 CLI 工具前请选择默认工作路径");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...settings,
        cli_tools: tools,
        default_working_path: path.trim() || null,
      });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 助理配置保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content ai-work-settings-dialog"
          aria-describedby={undefined}
        >
          <header>
            <Dialog.Title>{title.trim() || "设置 AI CLI"}</Dialog.Title>
            <Dialog.Close aria-label="关闭"><X /></Dialog.Close>
          </header>
          <div className="ai-work-settings-body">
            <section>
              <label>CLI 工具</label>
              <div className="ai-cli-options">
                {AI_CLI_OPTIONS.map((option) => {
                  const selected = tools.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      onClick={() => toggleTool(option.value)}
                    >
                      <SquareTerminal />
                      <span>{option.label}</span>
                      {selected && <Check />}
                    </button>
                  );
                })}
              </div>
            </section>
            <section>
              <label htmlFor="ai-working-path">默认工作路径</label>
              <div className="ai-working-path-control">
                <input
                  id="ai-working-path"
                  value={path}
                  readOnly
                  placeholder="尚未选择目录"
                />
                <button type="button" onClick={() => void chooseDirectory()}>
                  <FolderOpen /> 选择
                </button>
              </div>
            </section>
            {error && <p className="ai-work-settings-error" role="alert">{error}</p>}
          </div>
          <footer>
            <Dialog.Close className="button secondary" disabled={saving}>取消</Dialog.Close>
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
