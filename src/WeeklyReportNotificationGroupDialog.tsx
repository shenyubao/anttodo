import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

export function WeeklyReportNotificationGroupDialog({ open, disabled = false, onOpenChange, onCreate }: {
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; webhook: string; signingSecret: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [webhook, setWebhook] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setWebhook("");
    setSigningSecret("");
    setBusy(false);
    setError("");
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || busy) return;
    if (!name.trim() || !webhook.trim() || !signingSecret.trim()) {
      setError("请填写全部通知群信息");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onCreate({
        name: name.trim(),
        webhook: webhook.trim(),
        signingSecret: signingSecret.trim(),
      });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建通知群失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content weekly-report-notification-dialog">
          <form onSubmit={submit}>
            <header>
              <Dialog.Title>创建通知群</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className="dialog-close-button" aria-label="关闭"><X /></button>
              </Dialog.Close>
            </header>
            <Dialog.Description className="sr-only">配置当前团队共用的钉钉群通知</Dialog.Description>
            <div className="weekly-report-notification-dialog-body">
              <label>群类型<select aria-label="群类型" value="dingtalk" disabled><option value="dingtalk">钉钉群</option></select></label>
              <label>群名称<input disabled={disabled || busy} autoFocus aria-label="群名称" value={name} maxLength={100} placeholder="例如：研发周报群" onChange={(event) => setName(event.target.value)} /></label>
              <label>群 WebHook<input disabled={disabled || busy} aria-label="群 WebHook" value={webhook} inputMode="url" placeholder="https://oapi.dingtalk.com/robot/send?access_token=…" onChange={(event) => setWebhook(event.target.value)} /></label>
              <label>安全加签<input disabled={disabled || busy} aria-label="安全加签" type="password" value={signingSecret} autoComplete="new-password" placeholder="SEC…" onChange={(event) => setSigningSecret(event.target.value)} /></label>
              {error && <p role="alert">{error}</p>}
            </div>
            <footer className="dialog-actions">
              <Dialog.Close asChild><button type="button" className="button secondary" disabled={busy}>取消</button></Dialog.Close>
              <button type="submit" className="button primary" disabled={disabled || busy || !name.trim() || !webhook.trim() || !signingSecret.trim()}>{busy ? "创建中…" : "创建"}</button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

