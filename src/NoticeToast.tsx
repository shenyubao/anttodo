import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Undo2, X } from "lucide-react";
import clsx from "clsx";
import type { NoticeHandler, NoticeOptions, NoticeTone } from "./types";

export function useNotice(initial = "") {
  const [notice, setNoticeState] = useState({ message: initial, tone: "success" as NoticeTone, options: {} as NoticeOptions });
  const currentId = useRef<string | undefined>(undefined);
  const setNotice = useCallback<NoticeHandler>((message, tone = "success", options = {}) => {
    if (options.replaceId && options.replaceId !== currentId.current) return;
    const id = options.id ?? crypto.randomUUID();
    currentId.current = id;
    setNoticeState({ message, tone, options: { ...options, id } });
  }, []);
  return { notice: notice.message, noticeTone: notice.tone, noticeOptions: notice.options, setNotice };
}

export function NoticeToast({ message, tone, options, online, onDismiss, onNotice }: {
  message: string; tone: NoticeTone; options: NoticeOptions; online: boolean;
  onDismiss: () => void; onNotice: NoticeHandler;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(options.durationMs);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    remaining.current = options.durationMs;
    busyRef.current = false;
    setBusy(false);
  }, [options.id, options.durationMs]);
  useEffect(() => {
    if (hovered || focused || busy || remaining.current === undefined) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismissRef.current(), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, (remaining.current ?? 0) - (Date.now() - started));
    };
  }, [options.id, options.durationMs, hovered, focused, busy]);
  async function undo() {
    if (!online || busyRef.current || !options.action) return;
    busyRef.current = true;
    setBusy(true);
    try { await options.action.run(); }
    catch (error) {
      onNotice(error instanceof Error ? error.message : "撤销失败，请重试", "error", { ...options, replaceId: options.id });
    } finally { busyRef.current = false; setBusy(false); }
  }
  return <div
    className={clsx("toast", tone === "error" && "error", options.action && "toast-action")}
    role={tone === "error" ? "alert" : "status"}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
  >
    {!options.action && (tone === "error" ? <CircleAlert size={18} /> : <CheckCircle2 size={18} />)}
    <span>{message}</span>
    {options.action && <button className="toast-undo" aria-label={options.action.label} title={options.action.label}
      disabled={!online || busy} onClick={() => void undo()}><Undo2 size={20} /></button>}
    {!options.action && <button aria-label="关闭提示" onClick={onDismiss}><X size={15} /></button>}
  </div>;
}
