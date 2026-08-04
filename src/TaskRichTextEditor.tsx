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
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { format } from "date-fns";
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
import {
  attachmentMarkdown,
  isSafeEditorUrl,
  type AttachmentContext,
  type AttachmentService,
  type UploadedAttachment,
} from "./lib/attachments";
import { SerialSaveQueue, type SaveQueueState } from "./lib/serialSave";

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
  getMarkdown: () => string;
  retry: () => Promise<void>;
};

type TaskRichTextEditorProps = {
  attachmentContext: AttachmentContext;
  attachmentService: AttachmentService;
  immersive: boolean;
  initialMarkdown: string;
  online: boolean;
  onImmersiveChange: (immersive: boolean) => void;
  onSave: (markdown: string) => Promise<void>;
  toolbarHost: HTMLElement | null;
  toolbarOpen: boolean;
};

type EditorToolbarProps = {
  attachmentService: AttachmentService;
  disabled: boolean;
  immersive: boolean;
  onImmersiveChange: (immersive: boolean) => void;
  uploadAttachment: (file: File) => Promise<UploadedAttachment>;
};

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
      await attachmentService.remove(attachment.uri).catch(() => undefined);
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
      <div className="rich-toolbar-immersive-out">
        <ImmersiveButton {...props} />
      </div>
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
        <AttachmentButton {...props} />
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
    immersive,
    initialMarkdown,
    online,
    onImmersiveChange,
    onSave,
    toolbarHost,
    toolbarOpen,
  },
  forwardedRef,
) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const mountedRef = useRef(true);
  const onlineRef = useRef(online);
  const saveRef = useRef(onSave);
  const [saveState, setSaveState] = useState<SaveQueueState>({ status: "idle" });
  const [uploadState, setUploadState] = useState<
    { status: "idle" | "uploading" } | { status: "error"; error: Error }
  >({ status: "idle" });
  const queueRef = useRef<SerialSaveQueue<string> | null>(null);

  saveRef.current = onSave;
  onlineRef.current = online;

  if (!queueRef.current) {
    queueRef.current = new SerialSaveQueue(
      initialMarkdown,
      (markdown) => saveRef.current(markdown),
      (state) => {
        if (mountedRef.current) setSaveState(state);
      },
    );
  }

  useImperativeHandle(
    forwardedRef,
    () => ({
      flush: () => queueRef.current?.flush() ?? Promise.resolve(),
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
      setUploadState({ status: "uploading" });
      try {
        const attachment = await attachmentService.upload(attachmentContext, file);
        if (!mountedRef.current) {
          await attachmentService.remove(attachment.uri).catch(() => undefined);
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
    [attachmentContext, attachmentService],
  );

  const plugins = useMemo(
    () => [
      headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }),
      listsPlugin(),
      quotePlugin(),
      linkPlugin({ validateUrl: isSafeEditorUrl }),
      linkDialogPlugin({
        onClickLinkCallback: (url) => {
          void attachmentService.open(url).catch((error) => {
            if (mountedRef.current) setUploadState({ status: "error", error });
          });
        },
        onReadOnlyClickLinkCallback: (event, _node, url) => {
          event.preventDefault();
          void attachmentService.open(url).catch((error) => {
            if (mountedRef.current) setUploadState({ status: "error", error });
          });
        },
      }),
      imagePlugin({
        allowSetImageDimensions: false,
        disableImageResize: true,
        disableImageSettingsButton: true,
        imagePreviewHandler: (uri) => attachmentService.resolveImage(uri),
        imageUploadHandler: async (file) => {
          const attachment = await uploadAttachment(file);
          if (!attachment.image) {
            await attachmentService.remove(attachment.uri).catch(() => undefined);
            throw new Error("粘贴区域只接受图片");
          }
          return attachment.uri;
        },
      }),
      thematicBreakPlugin(),
      markdownShortcutPlugin(),
      toolbarPlugin({
        toolbarContents: () =>
          toolbarHost && toolbarOpen
            ? createPortal(
                <EditorToolbar
                  attachmentService={attachmentService}
                  disabled={!online || uploadState.status === "uploading"}
                  immersive={immersive}
                  onImmersiveChange={onImmersiveChange}
                  uploadAttachment={uploadAttachment}
                />,
                toolbarHost,
              )
            : null,
      }),
    ],
    [
      attachmentService,
      immersive,
      onImmersiveChange,
      online,
      toolbarHost,
      toolbarOpen,
      uploadAttachment,
      uploadState.status,
    ],
  );

  const error =
    uploadState.status === "error"
      ? uploadState.error
      : saveState.status === "error"
        ? saveState.error
        : null;

  return (
    <div className="task-rich-editor">
      <MDXEditor
        ref={editorRef}
        className="task-rich-editor-root"
        contentEditableClassName="detail-description rich-editor-content"
        markdown={initialMarkdown}
        placeholder="添加描述、会议结论或验收标准…"
        plugins={plugins}
        readOnly={!online}
        trim={false}
        onBlur={() => {
          if (online) void queueRef.current?.flush().catch(() => undefined);
        }}
        onChange={(markdown, initialMarkdownNormalize) => {
          if (!initialMarkdownNormalize) queueRef.current?.schedule(markdown);
        }}
        onError={({ error }) => {
          setSaveState({ status: "error", error: new Error(error) });
        }}
      />
      <div
        className={`rich-editor-status${error ? " error" : ""}`}
        role="status"
        aria-live="polite"
      >
        {uploadState.status === "uploading" && "正在上传附件…"}
        {!error && uploadState.status !== "uploading" && saveState.status === "saving" &&
          "正在保存…"}
        {!error && uploadState.status !== "uploading" && saveState.status === "saved" &&
          "已保存"}
        {error && (
          <>
            <span>{error.message}</span>
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
