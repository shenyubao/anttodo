import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskRichTextEditor } from "./TaskRichTextEditor";
import type { Member } from "./types";

const mocks = vi.hoisted(() => ({
  insertText: (_text: string) => {},
  editor: { update: (callback: () => void) => callback() },
}));

vi.mock("lexical", () => ({
  $createRangeSelection: () => ({ applyDOMRange: vi.fn(), modify: vi.fn(), insertText: (text: string) => mocks.insertText(text) }),
  $setSelection: vi.fn(),
}));
vi.mock("./lib/mentions", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/mentions")>(),
  caretClientRect: () => ({ top: 100, bottom: 120, left: 100 }),
}));
vi.mock("@mdxeditor/editor", async () => {
  const React = await import("react");
  const empty = () => null;
  const components = Object.fromEntries([
    "BlockTypeSelect", "BoldItalicUnderlineToggles", "ButtonWithTooltip", "CodeToggle", "CreateLink",
    "HighlightToggle", "InsertThematicBreak", "ListsToggle", "StrikeThroughSupSubToggles",
  ].map((name) => [name, empty]));
  const plugins = Object.fromEntries([
    "headingsPlugin", "imagePlugin", "linkDialogPlugin", "linkPlugin", "listsPlugin", "markdownShortcutPlugin",
    "quotePlugin", "thematicBreakPlugin",
  ].map((name) => [name, () => ({})]));
  return {
    ...components, ...plugins,
    activeEditor$: {}, applyBlockType$: {}, insertMarkdown$: {},
    useCellValue: () => mocks.editor,
    usePublisher: () => vi.fn(),
    toolbarPlugin: (options: object) => options,
    MDXEditor: React.forwardRef(function Editor(props: {
      markdown: string;
      onChange: (value: string, normalize: boolean) => void;
      plugins: { toolbarContents?: () => React.ReactNode }[];
    }, ref) {
      const value = React.useRef(props.markdown);
      const content = React.useRef<HTMLDivElement>(null);
      React.useImperativeHandle(ref, () => ({
        getMarkdown: () => value.current,
        setMarkdown: (text: string) => { value.current = text; },
      }));
      mocks.insertText = (text) => {
        value.current = text;
        content.current!.textContent = text;
        props.onChange(text, false);
      };
      return <>
        <div ref={content} className="rich-editor-content" contentEditable tabIndex={0} suppressContentEditableWarning
          onInput={(event) => { value.current = event.currentTarget.textContent ?? ""; props.onChange(value.current, false); }} />
        {props.plugins.map((plugin, index) => plugin.toolbarContents ? <React.Fragment key={index}>{plugin.toolbarContents()}</React.Fragment> : null)}
      </>;
    }),
  };
});

const members: Member[] = [{ workspace_id: "team", user_id: "recipient", role: "member", profile: { id: "recipient", display_name: "成员", avatar_url: null } }];
let root: Root;
let save = vi.fn<(markdown: string, ids?: string[]) => Promise<void>>();
let send = vi.fn<(recipient: string, request: string) => Promise<void>>();

beforeEach(() => {
  save = vi.fn().mockResolvedValue(undefined);
  send = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function renderAndSelect() {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  root = createRoot(dialog);
  await act(async () => root.render(<TaskRichTextEditor currentUserId="sender" immersive={false} initialMarkdown=""
    members={members} online onImmersiveChange={vi.fn()} onLoadMentionCandidates={async () => ["recipient"]}
    onSendMentionNotification={send} onSave={save} toolbarHost={null} toolbarOpen={false} />));
  const content = document.querySelector<HTMLElement>(".rich-editor-content")!;
  await act(async () => {
    content.focus();
    content.textContent = "@";
    const range = document.createRange();
    range.selectNodeContents(content);
    range.collapse(false);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    content.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => document.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  expect(dialog.querySelector(".rich-editor-mention-notify")).not.toBeNull();
}

async function clickSend() {
  await act(async () => document.querySelector<HTMLButtonElement>(".rich-editor-mention-notify button")!.click());
}

describe("description mention confirmation", () => {
  it("flushes the mention and its IDs before sending, without duplicate clicks", async () => {
    await renderAndSelect();
    expect(send).not.toHaveBeenCalled();
    let finishSave!: () => void;
    save.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    await clickSend();
    expect(save).toHaveBeenCalledWith("@成员 ", ["recipient"]);
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLButtonElement>(".rich-editor-mention-notify button")!.disabled).toBe(true);
    await clickSend();
    await act(async () => finishSave());
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("recipient", expect.any(String));
    expect(document.body.textContent).toContain("已提交发送");
  });

  it("never notifies when saving fails and can retry the save", async () => {
    await renderAndSelect();
    save.mockRejectedValueOnce(new Error("保存失败"));
    await clickSend();
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("保存失败");
    await clickSend();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reuses the same request ID after a notification request fails", async () => {
    await renderAndSelect();
    send.mockRejectedValueOnce(new Error("网络错误"));
    await clickSend();
    const requestId = send.mock.calls[0][1];
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("网络错误");
    await clickSend();
    expect(send).toHaveBeenLastCalledWith("recipient", requestId);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("cancels a send waiting for save when the prompt is dismissed", async () => {
    await renderAndSelect();
    let finishSave!: () => void;
    save.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    await clickSend();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => finishSave());
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelector(".rich-editor-mention-notify")).toBeNull();
  });
});
