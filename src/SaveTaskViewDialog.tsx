import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

export function SaveTaskViewDialog({
  open,
  onOpenChange,
  onSave,
  title = "另存为视图",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => Promise<void>;
  title?: string;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setBusy(false);
    setError("");
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized) {
      setError("请输入视图名称");
      return;
    }
    if (normalized.length > 80) {
      setError("视图名称不能超过 80 个字符");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(normalized);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存视图失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content save-task-view-dialog"
          aria-describedby={undefined}
        >
          <form onSubmit={submit}>
            <header>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className="dialog-close-button" aria-label="关闭">
                  <X />
                </button>
              </Dialog.Close>
            </header>
            <div className="save-task-view-body">
              <input
                autoFocus
                aria-label="视图名称"
                value={name}
                maxLength={80}
                placeholder="例如：本月重要任务"
                onChange={(event) => setName(event.target.value)}
              />
              {error && <p className="save-task-view-error" role="alert">{error}</p>}
            </div>
            <footer className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="button secondary" disabled={busy}>取消</button>
              </Dialog.Close>
              <button type="submit" className="button primary" disabled={busy || !name.trim()}>
                {busy ? "保存中…" : "保存"}
              </button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
