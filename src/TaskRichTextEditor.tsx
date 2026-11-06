import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ButtonWithTooltip,
  CodeToggle,
  CreateLink,
  HighlightToggle,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  StrikeThroughSupSubToggles,
  applyBlockType$,
  activeEditor$,
  headingsPlugin,
  imagePlugin,
  insertMarkdown$,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  usePublisher,
  useCellValue,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { format } from "date-fns";
import { $createRangeSelection, $setSelection, type LexicalEditor } from "lexical";
import {
  Clock3,
  Ellipsis,
  Maximize2,
  Minimize2,
  Paperclip,
  Quote,
  Type,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { MemberAvatar } from "./MemberAvatar";
import {
  attachmentMarkdown,
  isSafeEditorUrl,
  type AttachmentContext,
  type AttachmentService,
  type UploadedAttachment,
} from "./lib/attachments";
import {
  caretClientRect,
  detectMentionQuery,
  filterMentionCandidates,
  getPlainTextBeforeCaret,
  memberDisplayName,
  visibleMentionIds,
  type MentionQuery,
} from "./lib/mentions";
import { SerialSaveQueue, type SaveQueueState } from "./lib/serialSave";
import type { Member } from "./types";

const ATTACHMENT_ACCEPT = [
  ".csv",
  ".doc",
  ".docx",
  ".gif",
  ".jpeg",
  ".jpg",
  ".json",
  ".md",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".txt",
  ".webp",
  ".xls",
  ".xlsx",
  ".zip",
].join(",");

export type TaskRichTextEditorHandle = {
  flush: () => Promise<void>;
  focus: () => void;
  getMarkdown: () => string;
  retry: () => Promise<void>;
};

type TaskRichTextEditorProps = {
  attachmentContext?: AttachmentContext;
  attachmentService?: AttachmentService;
  currentUserId?: string;
  immersive: boolean;
  initialMarkdown: string;
  initialMentionUserIds?: string[];
  members?: Member[];
  online: boolean;
  onImmersiveChange: (immersive: boolean) => void;
  onLoadMentionCandidates?: () => Promise<string[]>;
  onSendMentionNotification?: (recipientId: string, requestId: string) => Promise<void>;
  onSave: (markdown: string, mentionedUserIds?: string[]) => Promise<void>;
  toolbarHost: HTMLElement | null;
  toolbarOpen: boolean;
  placeholder?: string;
  attachmentsEnabled?: boolean;
  immersiveEnabled?: boolean;
};

type EditorToolbarProps = {
  attachmentService?: AttachmentService;
  disabled: boolean;
  immersive: boolean;
  onImmersiveChange: (immersive: boolean) => void;
  uploadAttachment: (file: File) => Promise<UploadedAttachment>;
  attachmentsEnabled?: boolean;
  immersiveEnabled?: boolean;
};

function MentionEditorBridge({ onEditor }: { onEditor: (editor: LexicalEditor | null) => void }) {
  const editor = useCellValue(activeEditor$);
  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);
  return null;
}

function ImmersiveButton({
  immersive,
  onImmersiveChange,
}: Pick<EditorToolbarProps, "immersive" | "onImmersiveChange">) {
  return (
    <ButtonWithTooltip
      title={immersive ? "退出沉浸写作" : "沉浸写作"}
      aria-pressed={immersive}
      onClick={() => onImmersiveChange(!immersive)}
    >
      {immersive ? <Minimize2 /> : <Maximize2 />}
    </ButtonWithTooltip>
  );
}

function TimeButton() {
  const insertMarkdown = usePublisher(insertMarkdown$);
  return (
    <ButtonWithTooltip
      title="插入当前时间"
      onClick={() => insertMarkdown(format(new Date(), "yyyy-MM-dd HH:mm"))}
    >
      <Clock3 />
    </ButtonWithTooltip>
  );
}

function QuoteButton() {
  const applyBlockType = usePublisher(applyBlockType$);
  return (
    <ButtonWithTooltip title="引用" onClick={() => applyBlockType("quote")}>
      <Quote />
    </ButtonWithTooltip>
  );
}

function AttachmentButton({
  disabled,
  attachmentService,
  uploadAttachment,
}: Pick<
  EditorToolbarProps,
  "attachmentService" | "disabled" | "uploadAttachment"
>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const insertMarkdown = usePublisher(insertMarkdown$);

  async function attach(file: File) {
    const attachment = await uploadAttachment(file);
    try {
      insertMarkdown(attachmentMarkdown(attachment));
    } catch (error) {
      await attachmentService?.remove(attachment.uri).catch(() => undefined);
      throw error;
    }
  }

  return (
    <>
      <ButtonWithTooltip
        title="添加附件"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip />
      </ButtonWithTooltip>
      <input
        ref={inputRef}
        className="rich-editor-file-input"
        type="file"
        accept={ATTACHMENT_ACCEPT}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void attach(file);
        }}
      />
    </>
  );
}

function SecondaryTools() {
  return (
    <>
      <StrikeThroughSupSubToggles options={["Strikethrough"]} />
      <InsertThematicBreak />
      <TimeButton />
      <QuoteButton />
    </>
  );
}

function MoreFormattingMenu() {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <details
      ref={detailsRef}
      className="rich-toolbar-more"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        role="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="更多文本样式"
        title="更多文本样式"
      >
        <Ellipsis />
      </summary>
      <div
        className="rich-toolbar-more-menu"
        role="menu"
        onClickCapture={() => {
          window.setTimeout(() => detailsRef.current?.removeAttribute("open"));
        }}
      >
        <SecondaryTools />
      </div>
    </details>
  );
}

function EditorToolbar(props: EditorToolbarProps) {
  return (
    <div
      className={`rich-editor-toolbar-row${props.disabled ? " is-disabled" : ""}`}
    >
      {props.immersiveEnabled !== false && <div className="rich-toolbar-immersive-out">
        <ImmersiveButton {...props} />
      </div>}
      <div
        className={`rich-editor-toolbar${props.disabled ? " is-disabled" : ""}`}
        aria-label="文本样式"
      >
        <span className="rich-toolbar-block-type">
          <Type className="rich-toolbar-block-type-icon" aria-hidden="true" />
          <BlockTypeSelect />
        </span>
        <BoldItalicUnderlineToggles options={["Bold"]} />
        <BoldItalicUnderlineToggles options={["Italic"]} />
        <BoldItalicUnderlineToggles options={["Underline"]} />
        <HighlightToggle />
        <ListsToggle options={["check", "bullet", "number"]} />
        <span className="rich-toolbar-secondary">
          <StrikeThroughSupSubToggles options={["Strikethrough"]} />
          <InsertThematicBreak />
          <TimeButton />
        </span>
        <CreateLink />
        <CodeToggle />
        <span className="rich-toolbar-secondary">
          <QuoteButton />
        </span>
        {props.attachmentsEnabled !== false && <AttachmentButton {...props} />}
        <MoreFormattingMenu />
      </div>
    </div>
  );
}

export const TaskRichTextEditor = forwardRef<
  TaskRichTextEditorHandle,
  TaskRichTextEditorProps
>(function TaskRichTextEditor(
  {
    attachmentContext,
    attachmentService,
    currentUserId = "",
    immersive,
    initialMarkdown,
    initialMentionUserIds = [],
    members = [],
    online,
    onImmersiveChange,
    onLoadMentionCandidates,
    onSendMentionNotification,
    onSave,
    toolbarHost,
    toolbarOpen,
    placeholder = "添加描述、会议结论或验收标准…",
    attachmentsEnabled = true,
    immersiveEnabled = true,
  },
  forwardedRef,
) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const onlineRef = useRef(online);
  const saveRef = useRef(onSave);
  const membersRef = useRef(members);
  const selectedMentionIdsRef = useRef<string[]>(initialMentionUserIds);
  const mentionUiRef = useRef({
    mention: null as MentionQuery | null,
    candidates: [] as Member[],
    activeCandidate: 0,
  });
  const [saveState, setSaveState] = useState<SaveQueueState>({ status: "idle" });
  const [uploadState, setUploadState] = useState<
    { status: "idle" | "uploading" } | { status: "error"; error: Error }
  >({ status: "idle" });
  const [candidateIds, setCandidateIds] = useState<string[] | null>(null);
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [activeCandidate, setActiveCandidate] = useState(0);
  const [mentionMenuPos, setMentionMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>(initialMentionUserIds);
  const [mentionError, setMentionError] = useState("");
  const mentionRangeRef = useRef<Range | null>(null);
  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  const setLexicalEditor = useCallback((editor: LexicalEditor | null) => {
    lexicalEditorRef.current = editor;
  }, []);
  const notificationRef = useRef<{ recipientId: string; requestId: string } | null>(null);
  const sendingNotificationRef = useRef(false);
  const [notification, setNotification] = useState<{
    recipientId: string;
    requestId: string;
    position: { top: number; left: number };
  } | null>(null);
  const [sendingNotification, setSendingNotification] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [notificationStatus, setNotificationStatus] = useState("");
  const queueRef = useRef<SerialSaveQueue<string> | null>(null);
  const trackMentionsRef = useRef(Boolean(onLoadMentionCandidates && currentUserId));

  saveRef.current = onSave;
  onlineRef.current = online;
  membersRef.current = members;
  selectedMentionIdsRef.current = selectedMentionIds;
  trackMentionsRef.current = Boolean(onLoadMentionCandidates && currentUserId);

  const mentionsEnabled = trackMentionsRef.current;

  if (!queueRef.current) {
    queueRef.current = new SerialSaveQueue(
      initialMarkdown,
      (markdown) => {
        if (!trackMentionsRef.current) return saveRef.current(markdown);
        return saveRef.current(
          markdown,
          visibleMentionIds(markdown, selectedMentionIdsRef.current, membersRef.current),
        );
      },
      (state) => {
        if (mountedRef.current) setSaveState(state);
      },
    );
  }

  const initialMentionSignature = JSON.stringify(initialMentionUserIds);
  useEffect(() => {
    if (queueRef.current?.acceptExternal(initialMarkdown)) {
      setSelectedMentionIds(initialMentionUserIds);
      if (editorRef.current?.getMarkdown() !== initialMarkdown) editorRef.current?.setMarkdown(initialMarkdown);
      const pending = notificationRef.current;
      if (pending && !visibleMentionIds(initialMarkdown, initialMentionUserIds, membersRef.current).includes(pending.recipientId)) {
        notificationRef.current = null;
        setNotification(null);
        setNotificationError("");
      }
    }
  }, [initialMarkdown, initialMentionSignature]);

  const candidates = useMemo(
    () => filterMentionCandidates({
      members,
      candidateIds,
      currentUserId,
      query: mention?.query ?? "",
    }),
    [candidateIds, currentUserId, members, mention?.query],
  );

  mentionUiRef.current = { mention, candidates, activeCandidate };

  useEffect(() => setActiveCandidate(0), [mention?.query]);

  const ensureCandidates = useCallback(() => {
    if (!onLoadMentionCandidates || candidateIds !== null) return;
    void onLoadMentionCandidates()
      .then(setCandidateIds)
      .catch((cause) => {
        setMentionError(cause instanceof Error ? cause.message : "无法读取可引用成员");
      });
  }, [candidateIds, onLoadMentionCandidates]);

  const syncMentionFromCaret = useCallback(() => {
    if (!trackMentionsRef.current || !onlineRef.current) {
      setMention(null);
      setMentionMenuPos(null);
      return;
    }
    const content = rootRef.current?.querySelector<HTMLElement>(".rich-editor-content");
    if (!content) {
      setMention(null);
      setMentionMenuPos(null);
      return;
    }
    const text = getPlainTextBeforeCaret(content);
    if (text == null) {
      setMention(null);
      setMentionMenuPos(null);
      return;
    }
    const next = detectMentionQuery(text, text.length);
    setMention(next);
    if (!next) {
      setMentionMenuPos(null);
      return;
    }
    ensureCandidates();
    const selection = window.getSelection();
    if (selection?.rangeCount) mentionRangeRef.current = selection.getRangeAt(0).cloneRange();
    const rect = caretClientRect();
    if (rect) {
      setMentionMenuPos({ top: rect.bottom + 6, left: rect.left });
    } else {
      const host = rootRef.current?.getBoundingClientRect();
      setMentionMenuPos(host
        ? { top: host.top + 48, left: host.left + 16 }
        : null);
    }
  }, [ensureCandidates]);

  const selectMention = useCallback((member: Member) => {
    const active = mentionUiRef.current.mention;
    if (!active || !onlineRef.current) return;
    const range = mentionRangeRef.current;
    const content = rootRef.current?.querySelector<HTMLElement>(".rich-editor-content");
    const editor = lexicalEditorRef.current;
    if (!range || !editor || !content?.contains(range.startContainer)) return;
    content.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range.cloneRange());
    const anchor = caretClientRect();
    const insertion = `@${memberDisplayName(member)} `;
    const nextIds = [...new Set([...selectedMentionIdsRef.current, member.user_id])];
    selectedMentionIdsRef.current = nextIds;
    setSelectedMentionIds(nextIds);
    editor.update(() => {
      const lexicalSelection = $createRangeSelection();
      lexicalSelection.applyDOMRange(range);
      $setSelection(lexicalSelection);
      for (let i = 0; i < Array.from(active.query).length + 1; i += 1) {
        lexicalSelection.modify("extend", true, "character");
      }
      lexicalSelection.insertText(insertion);
    }, { discrete: true });
    setMention(null);
    setMentionMenuPos(null);
    setNotificationError("");
    setNotificationStatus("");
    if (onSendMentionNotification && anchor) {
      const next = {
        recipientId: member.user_id,
        requestId: crypto.randomUUID(),
        position: { top: anchor.top - 42, left: anchor.left },
      };
      notificationRef.current = next;
      setNotification(next);
    }
  }, [onSendMentionNotification]);

  const dismissNotification = useCallback(() => {
    notificationRef.current = null;
    setNotification(null);
    setNotificationError("");
  }, []);

  useEffect(() => {
    if (!online) {
      dismissNotification();
      setMention(null);
      setMentionMenuPos(null);
    }
  }, [online, dismissNotification]);

  useEffect(() => {
    if (!notification) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".rich-editor-mention-notify")) return;
      dismissNotification();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismissNotification();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onEscape, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onEscape, true);
    };
  }, [notification, dismissNotification]);

  async function sendMentionNotification() {
    const pending = notificationRef.current;
    if (!pending || !onSendMentionNotification || !onlineRef.current || sendingNotificationRef.current) return;
    sendingNotificationRef.current = true;
    setSendingNotification(true);
    setNotificationError("");
    try {
      // Lexical publishes Markdown after the insertion event has completed.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const markdown = editorRef.current?.getMarkdown() ?? "";
      if (!visibleMentionIds(markdown, selectedMentionIdsRef.current, membersRef.current).includes(pending.recipientId)) {
        throw new Error("正文中已没有此提及");
      }
      queueRef.current?.schedule(markdown);
      await queueRef.current?.flush();
      if (!mountedRef.current || !onlineRef.current || notificationRef.current?.requestId !== pending.requestId) return;
      await onSendMentionNotification(pending.recipientId, pending.requestId);
      if (mountedRef.current && notificationRef.current?.requestId === pending.requestId) {
        dismissNotification();
        setNotificationStatus("已提交发送");
      }
    } catch (cause) {
      if (mountedRef.current && notificationRef.current?.requestId === pending.requestId) {
        setNotificationError(cause instanceof Error ? cause.message : "通知发送失败，请重试");
      }
    } finally {
      sendingNotificationRef.current = false;
      if (mountedRef.current) setSendingNotification(false);
    }
  }

  useEffect(() => {
    if (!mentionsEnabled) return;
    const root = rootRef.current;
    if (!root) return;

    const onInput = () => {
      dismissNotification();
      setNotificationStatus("");
      syncMentionFromCaret();
    };
    const onBeforeInput = () => {
      dismissNotification();
      setNotificationStatus("");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const ui = mentionUiRef.current;
      if (!ui.mention) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMention(null);
        setMentionMenuPos(null);
        return;
      }
      if (ui.candidates.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setActiveCandidate((current) =>
          (current + (event.key === "ArrowDown" ? 1 : -1) + ui.candidates.length)
            % ui.candidates.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        selectMention(ui.candidates[ui.activeCandidate] ?? ui.candidates[0]);
      }
    };
    const onKeyUp = () => syncMentionFromCaret();
    const onSelectionChange = () => {
      if (!root.contains(document.activeElement)) return;
      syncMentionFromCaret();
    };

    root.addEventListener("input", onInput);
    root.addEventListener("beforeinput", onBeforeInput, true);
    root.addEventListener("keyup", onKeyUp);
    root.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      root.removeEventListener("input", onInput);
      root.removeEventListener("beforeinput", onBeforeInput, true);
      root.removeEventListener("keyup", onKeyUp);
      root.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [mentionsEnabled, selectMention, syncMentionFromCaret, dismissNotification]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      flush: () => queueRef.current?.flush() ?? Promise.resolve(),
      focus: () => {
        editorRef.current?.focus(undefined, { defaultSelection: "rootEnd" });
      },
      getMarkdown: () => editorRef.current?.getMarkdown() ?? initialMarkdown,
      retry: () => queueRef.current?.retry() ?? Promise.resolve(),
    }),
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueRef.current?.stop({ flush: onlineRef.current });
    };
  }, []);

  useEffect(() => {
    if (online) void queueRef.current?.flush().catch(() => undefined);
  }, [online]);

  const uploadAttachment = useCallback(
    async (file: File) => {
      if (!onlineRef.current) throw new Error("离线时不能上传附件");
      if (!attachmentsEnabled || !attachmentService || !attachmentContext) throw new Error("此编辑器不支持附件");
      setUploadState({ status: "uploading" });
      try {
        const attachment = await attachmentService.upload(attachmentContext, file);
        if (!mountedRef.current) {
          await attachmentService?.remove(attachment.uri).catch(() => undefined);
          throw new Error("编辑器已关闭");
        }
        setUploadState({ status: "idle" });
        return attachment;
      } catch (reason) {
        const error = reason instanceof Error ? reason : new Error("附件上传失败");
        if (mountedRef.current) setUploadState({ status: "error", error });
        throw error;
      }
    },
    [attachmentContext, attachmentService, attachmentsEnabled],
  );

  const plugins = useMemo(
    () => [
      headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }),
      listsPlugin(),
      quotePlugin(),
      linkPlugin({ validateUrl: isSafeEditorUrl }),
      linkDialogPlugin({
        onClickLinkCallback: (url) => {
          void (attachmentService ? attachmentService.open(url) : Promise.resolve(window.open(url, "_blank", "noopener,noreferrer"))).catch((error) => {
            if (mountedRef.current) setUploadState({ status: "error", error });
          });
        },
        onReadOnlyClickLinkCallback: (event, _node, url) => {
          event.preventDefault();
          void (attachmentService ? attachmentService.open(url) : Promise.resolve(window.open(url, "_blank", "noopener,noreferrer"))).catch((error) => {
            if (mountedRef.current) setUploadState({ status: "error", error });
          });
        },
      }),
      imagePlugin({
        allowSetImageDimensions: false,
        disableImageResize: true,
        disableImageSettingsButton: true,
        imagePreviewHandler: (uri) => attachmentService ? attachmentService.resolveImage(uri) : Promise.resolve(uri),
        imageUploadHandler: async (file) => {
          const attachment = await uploadAttachment(file);
          if (!attachment.image) {
            await attachmentService?.remove(attachment.uri).catch(() => undefined);
            throw new Error("粘贴区域只接受图片");
          }
          return attachment.uri;
        },
      }),
      thematicBreakPlugin(),
      markdownShortcutPlugin(),
      toolbarPlugin({
        toolbarContents: () => <>
          <MentionEditorBridge onEditor={setLexicalEditor} />
          {toolbarHost && toolbarOpen
            ? createPortal(
                <EditorToolbar
                  attachmentService={attachmentService}
                  disabled={!online || uploadState.status === "uploading"}
                  immersive={immersive}
                  onImmersiveChange={onImmersiveChange}
                  uploadAttachment={uploadAttachment}
                  attachmentsEnabled={attachmentsEnabled}
                  immersiveEnabled={immersiveEnabled}
                />,
                toolbarHost,
              )
            : null}
          </>,
      }),
    ],
    [
      attachmentService,
      attachmentsEnabled,
      immersiveEnabled,
      immersive,
      onImmersiveChange,
      online,
      toolbarHost,
      toolbarOpen,
      uploadAttachment,
      uploadState.status,
      setLexicalEditor,
    ],
  );

  const error =
    uploadState.status === "error"
      ? uploadState.error
      : saveState.status === "error"
        ? saveState.error
        : null;

  // Keep floating controls inside Radix's focus/pointer boundary. Dialogs may
  // transform their content, so convert viewport coordinates to that host.
  const mentionPortalHost = rootRef.current?.closest<HTMLElement>(".rich-editor-immersive, [role='dialog']") ?? document.body;
  function floatingStyle(position: { top: number; left: number }, width: number, height: number) {
    const left = Math.max(12, Math.min(position.left, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(position.top, window.innerHeight - height - 12));
    const bounds = mentionPortalHost === document.body ? null : mentionPortalHost.getBoundingClientRect();
    return {
      position: bounds ? "absolute" as const : "fixed" as const,
      left: left - (bounds?.left ?? 0) + (bounds ? mentionPortalHost.scrollLeft : 0),
      top: top - (bounds?.top ?? 0) + (bounds ? mentionPortalHost.scrollTop : 0),
    };
  }

  return (
    <div className="task-rich-editor" ref={rootRef}>
      <MDXEditor
        ref={editorRef}
        className="task-rich-editor-root"
        contentEditableClassName="detail-description rich-editor-content"
        markdown={initialMarkdown}
        placeholder={placeholder}
        plugins={plugins}
        readOnly={!online}
        trim={false}
        onBlur={() => {
          if (online) void queueRef.current?.flush().catch(() => undefined);
          window.setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) {
              setMention(null);
              setMentionMenuPos(null);
            }
          }, 0);
        }}
        onChange={(markdown, initialMarkdownNormalize) => {
          if (onlineRef.current && !initialMarkdownNormalize) queueRef.current?.schedule(markdown);
        }}
        onError={({ error }) => {
          setSaveState({ status: "error", error: new Error(error) });
        }}
      />
      {mention && mentionMenuPos && createPortal(
        <div
          className="comment-mention-menu rich-editor-mention-menu"
          role="listbox"
          aria-label="可引用成员"
          style={floatingStyle(mentionMenuPos, Math.min(280, window.innerWidth - 24), 190)}
        >
          {candidates.map((member, index) => (
            <button
              key={member.user_id}
              type="button"
              role="option"
              aria-selected={index === activeCandidate}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => selectMention(member)}
            >
              <MemberAvatar member={member} className="comment-candidate-avatar" />
              <span>{memberDisplayName(member)}</span>
            </button>
          ))}
          {candidateIds !== null && candidates.length === 0 && <p>没有匹配的成员</p>}
        </div>,
        mentionPortalHost,
      )}
      {notification && createPortal(
        <div
          className="rich-editor-mention-notify"
          role="group"
          aria-label="发送提及通知"
          style={floatingStyle(notification.position, 160, 36)}
        >
          <span>发送通知</span>
          <button
            type="button"
            disabled={!online || sendingNotification}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void sendMentionNotification()}
          >{sendingNotification ? "发送中…" : notificationError ? "重试" : "发送"}</button>
          {notificationError && <span className="mention-notify-error" role="alert">{notificationError}</span>}
        </div>,
        mentionPortalHost,
      )}
      <div
        className={`rich-editor-status${error || mentionError ? " error" : ""}`}
        role="status"
        aria-live="polite"
      >
        {notificationStatus && <span>{notificationStatus}</span>}
        {uploadState.status === "uploading" && "正在上传附件…"}
        {!error && !mentionError && uploadState.status !== "uploading" && saveState.status === "saving" &&
          "正在保存…"}
        {!notificationStatus && !error && !mentionError && uploadState.status !== "uploading" && saveState.status === "saved" &&
          "已保存"}
        {(error || mentionError) && (
          <>
            <span>{error?.message ?? mentionError}</span>
            {saveState.status === "error" && (
              <button
                type="button"
                onClick={() => void queueRef.current?.retry().catch(() => undefined)}
              >
                重试
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
});
