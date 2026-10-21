import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetailDialog, TaskDetailPanel, type TaskDetailProps } from "./TaskDetail";
import { ShortcutProvider } from "./ShortcutProvider";
import { createDemoBundle } from "./lib/demo";
import { createDemoAttachmentService } from "./lib/attachments";
import { DEFAULT_DATE_TIME_PREFERENCES } from "./lib/dateTimePreferences";

vi.mock("./lib/supabase", () => ({ supabase: null }));
vi.mock("./TaskRichTextEditor", () => ({
  TaskRichTextEditor: ({ online }: { online: boolean }) => <div data-editor-writable={String(online)} />,
}));
vi.mock("./TaskCliTerminal", () => ({
  TaskCliTerminal: ({ tool }: { tool: string }) => <div data-terminal={tool} />,
}));

let root: Root | undefined;
let client: QueryClient | undefined;
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function fixture() {
  const bundle = createDemoBundle();
  const task = bundle.tasks.find((item) => item.id === "task-1")!;
  Object.assign(task, { connector_id: bundle.connectors[0].id, connector_platform: "yunxiao", assignee_id: null, cli_assignee: null });
  Object.assign(bundle.connectors[0], {
    workspace_id: task.workspace_id, type: "yunxiao", enabled: false,
    public_config: { kind: "quick_create", organizationId: "org" },
  });
  bundle.labelPermissionLevels.product = 2;
  bundle.labelPermissionLevels.urgent = 2;
  const noop = vi.fn(async () => {});
  const props: TaskDetailProps = {
    task, bundle, currentUserId: "demo-user", online: true, editable: false,
    attachmentService: createDemoAttachmentService(), now: new Date(),
    dateTimePreferences: DEFAULT_DATE_TIME_PREFERENCES, pomodoroMinutes: 25,
    aiFeatureSettings: { user_id: "demo-user", smart_format_enabled: false, smart_format_prompt_override: null },
    aiWorkSettings: { user_id: "demo-user", workspace_id: task.workspace_id, cli_tools: ["codex"], default_working_path: "/tmp/anttodo" },
    onClose: vi.fn(), onUpdate: noop, onSaveSchedule: noop, onSaveChildTaskSchedule: noop,
    onAssign: vi.fn(async () => {}), onAssignChildTask: noop, onToggleLabel: noop,
    onToggleParticipant: noop, onCreateChildTask: noop, onToggleChildTask: noop,
    onUpdateChildTask: noop, onDeleteChildTask: noop, onAddDependencies: noop,
    onRemoveDependency: noop, onOpenDependency: vi.fn(), commentsRevision: 0, activityRevision: 0,
    onLoadActivity: vi.fn(async () => ({ items: [], nextCursor: null })),
    onLoadComments: vi.fn(async () => []), onLoadCommentCandidates: vi.fn(async () => []),
    onCreateComment: noop, onUpdateComment: noop, onDeleteComment: noop,
  };
  return props;
}

async function render(props: TaskDetailProps, dialog = false) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root!.render(
    <QueryClientProvider client={client!}><ShortcutProvider>
      {dialog ? <TaskDetailDialog {...props} open /> : <TaskDetailPanel {...props} />}
    </ShortcutProvider></QueryClientProvider>,
  ));
}
const assigneeButton = () => document.querySelector<HTMLButtonElement>(".detail-toolbar .task-assignee-trigger")!;
async function choose(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    .find((item) => item.textContent?.includes(text));
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}

describe("quick-create local assignment in task details", () => {
  it.each([false, true])("allows assignment while keeping content read-only (dialog=%s)", async (dialog) => {
    const props = fixture();
    await render(props, dialog);
    expect(assigneeButton().disabled).toBe(false);
    expect(document.querySelector<HTMLTextAreaElement>(".detail-title")!.disabled).toBe(true);
    expect(document.querySelector('[data-editor-writable="false"]')).toBeTruthy();
    expect(document.querySelector(".task-source-badge")?.getAttribute("title")).toContain("不会回写云效");
    await act(async () => assigneeButton().click());
    await choose("我");
    expect(props.onAssign).toHaveBeenCalledWith({ kind: "user", userId: "demo-user" });
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it.each(["offline", "viewer", "scheduled", "missing"])("disables assignment for %s", async (scenario) => {
    const props = fixture();
    if (scenario === "offline") props.online = false;
    if (scenario === "viewer") props.bundle.labelPermissionLevels.urgent = 1;
    if (scenario === "scheduled") props.bundle.connectors[0].public_config = { organizationId: "org" };
    if (scenario === "missing") props.bundle.connectors = [];
    await render(props);
    expect(assigneeButton().disabled).toBe(true);
  });

  it("keeps the menu open and shows a failed save", async () => {
    const props = fixture();
    props.onAssign = vi.fn().mockRejectedValue(new Error("负责人保存失败"));
    await render(props);
    await act(async () => assigneeButton().click());
    await choose("我");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("负责人保存失败");
    expect(assigneeButton().getAttribute("aria-label")).toBe("负责人：未指派");
  });

  it("supports configured AI CLI assignment and opens its terminal", async () => {
    vi.stubGlobal("anttodoDesktop", { aiWork: {} });
    const props = fixture();
    await render(props);
    await act(async () => assigneeButton().click());
    await choose("Codex");
    expect(props.onAssign).toHaveBeenCalledWith({ kind: "cli", tool: "codex" });
    expect(document.querySelector('[data-terminal="codex"]')).toBeTruthy();
  });
});
