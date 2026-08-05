import * as Dialog from "@radix-ui/react-dialog";
import { Download } from "lucide-react";
import { CLIENT_DOWNLOAD_URL } from "./lib/appHost";

export function DownloadClientDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  function openDownloadPage() {
    window.open(CLIENT_DOWNLOAD_URL, "_blank", "noopener,noreferrer");
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content download-client-dialog">
          <div className="download-client-dialog-icon" aria-hidden="true">
            <Download size={28} />
          </div>
          <Dialog.Title>下载桌面客户端</Dialog.Title>
          <Dialog.Description>
            已登录，建议下载桌面客户端以获得更好体验。
          </Dialog.Description>
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => onOpenChange(false)}
            >
              稍后再说
            </button>
            <button
              type="button"
              className="button primary"
              onClick={openDownloadPage}
            >
              前往下载
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
