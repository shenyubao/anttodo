import { forwardRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TaskRichTextEditor, type TaskRichTextEditorHandle } from "./TaskRichTextEditor";
import type { CommentMention, Member } from "./types";
import { isSafeEditorUrl } from "./lib/attachments";

export function OkrNoteContent({ value }: { value: string }) {
  return <div className="okr-note-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}
    components={{ a: ({ href, children }) => isSafeEditorUrl(href ?? "")
      ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span> }}
  >{value}</ReactMarkdown></div>;
}

export const OkrNoteEditor = forwardRef<TaskRichTextEditorHandle, {
  value: string;
  mentions?: CommentMention[];
  members: Member[];
  currentUserId: string;
  editable: boolean;
  loadCandidates: () => Promise<string[]>;
  onSave: (markdown: string, ids?: string[]) => Promise<void>;
}>(function OkrNoteEditor({ value, mentions, members, currentUserId, editable, loadCandidates, onSave }, ref) {
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  return <div className="okr-note-editor" aria-label="备注">
    {editable ? <>
      <div className="okr-note-toolbar" ref={setToolbarHost} />
      <TaskRichTextEditor ref={ref} initialMarkdown={value} initialMentionUserIds={mentions?.map((item) => item.user_id)}
        currentUserId={currentUserId} members={members} online={editable}
        onLoadMentionCandidates={loadCandidates} onSave={onSave}
        immersive={false} onImmersiveChange={() => {}} immersiveEnabled={false} attachmentsEnabled={false}
        toolbarHost={toolbarHost} toolbarOpen placeholder="填写备注，让大家更了解你的 OKR" />
    </> : value.trim() ? <OkrNoteContent value={value} /> : <p className="okr-note-empty">暂无备注</p>}
  </div>;
});
