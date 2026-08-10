import { formatDistance } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Check, ImagePlus, LoaderCircle, Pencil, Send, Trash2, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { MemberAvatar } from "./MemberAvatar";
import type { AttachmentService, UploadedAttachment } from "./lib/attachments";
import {
  detectMentionQuery,
  filterMentionCandidates,
  memberDisplayName,
  visibleMentionIds,
  type MentionQuery,
} from "./lib/mentions";
import type { Member, Task, TaskComment } from "./types";

export type CreateCommentInput = {
  body: string;
  imageUris: string[];
  mentionedUserIds: string[];
};

export { visibleMentionIds } from "./lib/mentions";

type MentionState = MentionQuery | null;

export function commentRelativeTime(value: string, now = new Date()) {
  return formatDistance(new Date(value), now, { addSuffix: true, locale: zhCN });
}

function renderMentionedBody(comment: TaskComment): ReactNode[] {
  const names = [...new Set(comment.mentions.map((mention) => mention.display_name_snapshot))]
    .sort((left, right) => right.length - left.length);
  if (names.length === 0) return [comment.body];
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(@(?:${escaped.join("|")}))`, "g");
  return comment.body.split(pattern).map((part, index) =>
    names.some((name) => part === `@${name}`)
      ? <strong className="comment-mention" key={`${part}-${index}`}>{part}</strong>
      : part,
  );
}

function CommentImage({
  uri,
  service,
  onOpen,
}: {
  uri: string;
  service: AttachmentService;
  onOpen: () => void;
}) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSrc("");
    setFailed(false);
    void service.resolveImage(uri)
      .then((value) => {
        if (!cancelled) setSrc(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [service, uri]);
  if (failed) return <span className="comment-image-error">图片加载失败</span>;
  if (!src) return <span className="comment-image-loading"><LoaderCircle /></span>;
  return (
    <button type="button" className="comment-image" onClick={onOpen} aria-label="查看评论图片">
      <img src={src} alt="评论图片" />
    </button>
  );
}

export function TaskComments({
  task,
  comments,
  members,
  currentUserId,
  online,
  attachmentService,
  showComposer,
  onLoadCandidates,
  onCreate,
  onUpdate,
  onDelete,
}: {
  task: Task;
  comments: TaskComment[];
  members: Member[];
  currentUserId: string;
  online: boolean;
  attachmentService: AttachmentService;
  showComposer: boolean;
  onLoadCandidates: () => Promise<string[]>;
  onCreate: (input: CreateCommentInput) => Promise<void>;
  onUpdate: (comment: TaskComment, input: CreateCommentInput) => Promise<void>;
  onDelete: (comment: TaskComment) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [images, setImages] = useState<UploadedAttachment[]>([]);
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([]);
  const [candidateIds, setCandidateIds] = useState<string[] | null>(null);
  const [mention, setMention] = useState<MentionState>(null);
  const [activeCandidate, setActiveCandidate] = useState(0);
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editMention, setEditMention] = useState<MentionState>(null);
  const [editMentionIds, setEditMentionIds] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBody("");
    setImages([]);
    setSelectedMentionIds([]);
    setCandidateIds(null);
    setMention(null);
    setEditingId(null);
    setEditMention(null);
    setError("");
  }, [task.id]);

  useEffect(() => {
    if (showComposer) window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [showComposer]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const rows = [...list.querySelectorAll<HTMLElement>(":scope > .comment-row")];
    const updateHeight = () => {
      list.style.removeProperty("--comments-list-height");
      const firstFiveHeight = rows.slice(0, 5).reduce(
        (height, row) => height + row.offsetHeight,
        8,
      );
      list.style.setProperty("--comments-list-height", `${Math.ceil(firstFiveHeight)}px`);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    rows.slice(0, 5).forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [comments, editingId]);

  const candidates = useMemo(
    () => filterMentionCandidates({
      members,
      candidateIds,
      currentUserId,
      query: mention?.query ?? "",
    }),
    [candidateIds, currentUserId, members, mention?.query],
  );

  const editCandidates = useMemo(
    () => filterMentionCandidates({
      members,
      candidateIds,
      currentUserId,
      query: editMention?.query ?? "",
    }),
    [candidateIds, currentUserId, editMention?.query, members],
  );

  useEffect(() => setActiveCandidate(0), [mention?.query]);

  function detectMention(value: string, caret: number) {
    const next = detectMentionQuery(value, caret);
    setMention(next);
    if (next && candidateIds === null) {
      void onLoadCandidates()
        .then(setCandidateIds)
        .catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取可引用成员"));
    }
  }

  function changeBody(event: ChangeEvent<HTMLTextAreaElement>) {
    setBody(event.target.value);
    detectMention(event.target.value, event.target.selectionStart);
  }

  function selectMention(member: Member) {
    if (!mention) return;
    const caret = textareaRef.current?.selectionStart ?? body.length;
    const insertion = `@${memberDisplayName(member)} `;
    const next = `${body.slice(0, mention.start)}${insertion}${body.slice(caret)}`;
    const nextCaret = mention.start + insertion.length;
    setBody(next);
    setSelectedMentionIds((current) => [...new Set([...current, member.user_id])]);
    setMention(null);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function beginEdit(comment: TaskComment) {
    setEditingId(comment.id);
    setEditBody(comment.body);
    setEditMentionIds(comment.mentions.map((item) => item.user_id));
    setEditMention(null);
    setError("");
    if (candidateIds === null) {
      void onLoadCandidates()
        .then(setCandidateIds)
        .catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取可引用成员"));
    }
    window.requestAnimationFrame(() => editRef.current?.focus());
  }

  function cancelEdit() {
    setEditingId(null);
    setEditMention(null);
    setEditBody("");
    setEditMentionIds([]);
  }

  function changeEditBody(event: ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value;
    setEditBody(next);
    setEditMention(detectMentionQuery(next, event.target.selectionStart));
  }

  function selectEditMention(member: Member) {
    if (!editMention) return;
    const caret = editRef.current?.selectionStart ?? editBody.length;
    const insertion = `@${memberDisplayName(member)} `;
    const next = `${editBody.slice(0, editMention.start)}${insertion}${editBody.slice(caret)}`;
    const nextCaret = editMention.start + insertion.length;
    setEditBody(next);
    setEditMentionIds((current) => [...new Set([...current, member.user_id])]);
    setEditMention(null);
    window.requestAnimationFrame(() => {
      editRef.current?.focus();
      editRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  async function saveEdit(comment: TaskComment) {
    if (!online || savingEdit || (!editBody.trim() && comment.image_uris.length === 0)) return;
    setSavingEdit(true);
    setError("");
    try {
      await onUpdate(comment, {
        body: editBody.trim(),
        imageUris: comment.image_uris,
        mentionedUserIds: visibleMentionIds(editBody, editMentionIds, members),
      });
      cancelEdit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "评论修改失败，请重试");
    } finally {
      setSavingEdit(false);
    }
  }

  async function submit() {
    if (!online || posting || uploading || (!body.trim() && images.length === 0)) return;
    setPosting(true);
    setError("");
    try {
      await onCreate({
        body: body.trim(),
        imageUris: images.map((image) => image.uri),
        mentionedUserIds: visibleMentionIds(body, selectedMentionIds, members),
      });
      setBody("");
      setImages([]);
      setSelectedMentionIds([]);
      setMention(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "评论发布失败，请重试");
    } finally {
      setPosting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && candidates.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveCandidate((current) =>
          (current + (event.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        selectMention(candidates[activeCandidate]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !online || images.length >= 8) return;
    setUploading(true);
    setError("");
    try {
      const uploaded = await attachmentService.uploadCommentImage({
        workspaceId: task.workspace_id,
        taskId: task.id,
        uploaderId: currentUserId,
      }, file);
      setImages((current) => [...current, uploaded]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片上传失败，请重试");
    } finally {
      setUploading(false);
    }
  }

  async function removePendingImage(image: UploadedAttachment) {
    setImages((current) => current.filter((item) => item.uri !== image.uri));
    await attachmentService.remove(image.uri).catch(() => undefined);
  }

  return (
    <section className={`task-comments${comments.length === 0 ? " comments-composer-only" : ""}`}
      aria-label="评论">
      {comments.length > 0 && <>
        <div className="comments-heading">
          <span>评论</span><em>{comments.length}</em>
        </div>
        <div ref={listRef} className="comments-list" aria-live="polite">
        {comments.map((comment) => {
          const author: Member = {
            workspace_id: comment.workspace_id,
            user_id: comment.author_id,
            role: "member",
            profile: comment.author,
          };
          return (
            <article className="comment-row" key={comment.id}>
              <MemberAvatar member={author} className="comment-avatar" />
              <div className="comment-content">
                <div className="comment-meta">
                  <strong>{comment.author?.display_name || "团队成员"}</strong>
                  <time dateTime={comment.created_at}>{commentRelativeTime(comment.created_at)}</time>
                  {comment.updated_at !== comment.created_at && <span>已编辑</span>}
                  {comment.author_id === currentUserId && (
                    <span className="comment-actions">
                      <button type="button" aria-label="修改评论"
                        disabled={!online || savingEdit || deletingId === comment.id}
                        onClick={() => beginEdit(comment)}><Pencil /></button>
                      <button type="button" aria-label="删除评论"
                        disabled={!online || deletingId === comment.id}
                        onClick={async () => {
                          setDeletingId(comment.id);
                          setError("");
                          try { await onDelete(comment); }
                          catch (cause) {
                            setError(cause instanceof Error ? cause.message : "评论删除失败，请重试");
                          } finally { setDeletingId(null); }
                        }}><Trash2 /></button>
                    </span>
                  )}
                </div>
                {editingId === comment.id ? (
                  <div className="comment-edit">
                    <textarea ref={editRef} rows={2} maxLength={10000} value={editBody}
                      aria-label="编辑评论" disabled={!online || savingEdit}
                      onChange={changeEditBody}
                      onKeyDown={(event) => {
                        if (editMention && editCandidates.length > 0 && event.key === "Enter") {
                          event.preventDefault();
                          selectEditMention(editCandidates[0]);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          editMention ? setEditMention(null) : cancelEdit();
                        } else if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void saveEdit(comment);
                        }
                      }} />
                    {editMention && (
                      <div className="comment-mention-menu comment-edit-mention-menu"
                        role="listbox" aria-label="编辑时可引用成员">
                        {editCandidates.map((member) => (
                          <button key={member.user_id} type="button" role="option"
                            aria-selected="false" onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectEditMention(member)}>
                            <MemberAvatar member={member} className="comment-candidate-avatar" />
                            <span>{memberDisplayName(member)}</span>
                          </button>
                        ))}
                        {candidateIds !== null && editCandidates.length === 0 && <p>没有匹配的成员</p>}
                      </div>
                    )}
                    <div className="comment-edit-actions">
                      <button type="button" onClick={cancelEdit} disabled={savingEdit}>取消</button>
                      <button type="button" className="primary" aria-label="保存评论修改"
                        disabled={savingEdit || (!editBody.trim() && comment.image_uris.length === 0)}
                        onClick={() => void saveEdit(comment)}><Check />保存</button>
                    </div>
                  </div>
                ) : comment.body ? <p className="comment-body">{renderMentionedBody(comment)}</p> : null}
                {comment.image_uris.length > 0 && (
                  <div className="comment-images">
                    {comment.image_uris.map((uri) => (
                      <CommentImage key={uri} uri={uri} service={attachmentService}
                        onOpen={() => void attachmentService.open(uri)} />
                    ))}
                  </div>
                )}
              </div>
            </article>
          );
        })}
        </div>
      </>}
      {showComposer && <div className="comment-composer">
        {images.length > 0 && (
          <div className="comment-pending-images">
            {images.map((image) => (
              <span key={image.uri}>
                <CommentImage uri={image.uri} service={attachmentService}
                  onOpen={() => void attachmentService.open(image.uri)} />
                <button type="button" aria-label="移除待发布图片"
                  onClick={() => void removePendingImage(image)}><X /></button>
              </span>
            ))}
          </div>
        )}
        {mention && (
          <div className="comment-mention-menu" role="listbox" aria-label="可引用成员">
            {candidates.map((member, index) => (
              <button key={member.user_id} type="button" role="option"
                aria-selected={index === activeCandidate} onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectMention(member)}>
                <MemberAvatar member={member} className="comment-candidate-avatar" />
                <span>{memberDisplayName(member)}</span>
              </button>
            ))}
            {candidateIds !== null && candidates.length === 0 && <p>没有匹配的成员</p>}
          </div>
        )}
        <div className="comment-input-shell">
          <textarea ref={textareaRef} value={body} rows={1} maxLength={10000}
            placeholder={online ? "添加评论" : "离线模式下不可评论"}
            aria-label="添加评论" disabled={!online || posting}
            onChange={changeBody} onKeyDown={handleKeyDown} />
          <button type="button" aria-label="上传评论图片" disabled={!online || uploading || images.length >= 8}
            onClick={() => fileRef.current?.click()}>
            {uploading ? <LoaderCircle className="spin" /> : <ImagePlus />}
          </button>
          <button type="button" className="comment-send" aria-label="发布评论"
            disabled={!online || posting || uploading || (!body.trim() && images.length === 0)}
            onClick={() => void submit()}><Send /></button>
          <input ref={fileRef} className="comment-file-input" type="file" accept="image/*"
            onChange={(event) => void chooseImage(event)} />
        </div>
        {error && <p className="comment-error" role="alert">{error}</p>}
      </div>}
    </section>
  );
}
