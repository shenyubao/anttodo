import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, dehydrate } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OkrSet } from "./types";
import type { OkrEntityChange } from "./lib/okrApi";
import { createDemoBundle } from "./lib/demo";
import { createDemoOkrData } from "./lib/demoOkr";
import { OkrWorkspace } from "./OkrWorkspace";

const backend = vi.hoisted(() => ({
  set: null as OkrSet | null,
  rpc: vi.fn(), load: vi.fn(), counts: vi.fn(),
  events: [] as Array<{ table: string; filter?: string; handler: (payload: { eventType: string; new?: { workspace_id?: string } }) => void }>,
}));
vi.mock("./lib/supabase", () => ({ supabase: {
  rpc: backend.rpc,
  channel: () => {
    const channel = {
      on: (_: string, filter: { table: string; filter?: string }, handler: (payload: { eventType: string; new?: { workspace_id?: string } }) => void) => {
        backend.events.push({ ...filter, handler }); return channel;
      },
      subscribe: () => channel,
    };
    return channel;
  },
  removeChannel: vi.fn(),
} }));
vi.mock("./lib/okrApi", async (original) => ({
  ...await original<typeof import("./lib/okrApi")>(),
  loadOkrCycles: async () => createDemoOkrData().cycles,
  loadVisibleOkrOwnerIds: async () => ["demo-user"],
  loadOkrSet: backend.load,
  loadOkrLinkedTaskCounts: backend.counts,
  loadOkrDisplayPreferences: async () => null,
  loadAlignableOkrObjectives: async () => [],
  loadOkrProgressRecordCounts: async () => ({ objectives: {}, keyResults: {} }),
}));

let root: Root;
let client: QueryClient;
let container: HTMLDivElement;
const notice = vi.fn();
function apply(changes: { objectives: OkrEntityChange[] }, publish = false) {
  const result = structuredClone(backend.set!);
  for (const change of changes.objectives) {
    const objective = result.objectives.find((item) => item.id === change.id)!;
    Object.assign(objective, change.fields);
    for (const key of ["responsible_ids", "user_acl_ids", "group_acl_ids", "alignment_target_id"] as const) {
      if (key in change) Object.assign(objective, { [key]: change[key] });
    }
    for (const kr of change.key_results ?? []) {
      Object.assign(objective.key_results.find((item) => item.id === kr.id)!, kr.fields);
    }
  }
  if (publish) result.published_version += 1;
  backend.set = result;
  return { data: result, error: null };
}
async function render(online = true) {
  const bundle = createDemoBundle();
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <OkrWorkspace workspaceId="workspace-team" currentUserId="demo-user" currentRole="owner"
        initialCycleId={backend.set!.cycle_id} members={bundle.members} userGroups={bundle.userGroups}
        online={online} onNavigate={vi.fn()} onOpenTask={vi.fn()} onMenu={vi.fn()} onNotice={notice} />
    </QueryClientProvider>,
  ));
  await advance(0);
}
async function edit() {
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="编辑 Objective"]')!.click());
}
async function input(label: string, value: string) {
  const node = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function button(text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === text)!;
  await act(async () => button.click());
}
async function advance(ms = 800) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  window.history.replaceState(null, "", "/");
  backend.set = createDemoOkrData().sets.find((set) => set.owner_id === "demo-user" && set.objectives.length === 2)!;
  backend.events = [];
  backend.counts.mockReset().mockResolvedValue({});
  backend.load.mockReset().mockImplementation(async () => structuredClone(backend.set));
  backend.rpc.mockReset().mockImplementation(async (_: string, args: { p_changes: { objectives: OkrEntityChange[] }; p_publish: boolean }) => apply(args.p_changes, args.p_publish));
  notice.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("OKR save coordination", () => {
  it("debounces objective and multiple KR changes into one write and caches the returned set", async () => {
    await render(); await edit();
    await input("Objective 标题", "Updated objective");
    await input("KR1 标题", "Updated KR1");
    await input("KR2 标题", "Updated KR2");
    await advance(799);
    expect(backend.rpc).not.toHaveBeenCalled();
    await advance(1);
    expect(backend.rpc).toHaveBeenCalledTimes(1);
    expect(backend.rpc.mock.calls[0][0]).toBe("save_okr_changes");
    expect(backend.rpc.mock.calls[0][1].p_changes.objectives[0].key_results).toHaveLength(2);
    expect(container.textContent).toContain("已自动保存");
    expect(backend.load).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(dehydrate(client))).toContain("Updated objective");
    await button("保存草稿");
    expect(backend.rpc).toHaveBeenCalledTimes(1);
  });

  it("serializes a manual publication behind an in-flight autosave and skips the superseded queued save", async () => {
    await render(); await edit();
    let finish!: (value: ReturnType<typeof apply>) => void;
    backend.rpc.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await input("Objective 标题", "First version"); await advance();
    await input("Objective 标题", "Latest version"); await advance();
    await button("发布");
    expect(backend.rpc).toHaveBeenCalledTimes(1);
    await act(async () => finish(apply(backend.rpc.mock.calls[0][1].p_changes)));
    expect(backend.rpc).toHaveBeenCalledTimes(2);
    expect(backend.rpc.mock.calls[1][1]).toMatchObject({
      p_publish: true, p_changes: { objectives: [{ fields: { title: "Latest version" } }] },
    });
    expect(backend.set!.objectives[0].title).toBe("Latest version");
    expect(container.querySelector('[aria-label="Objective 标题"]')).toBeNull();
  });

  it("does not mark newer edits as saved when an older request finishes", async () => {
    await render(); await edit();
    let finish!: (value: ReturnType<typeof apply>) => void;
    backend.rpc.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await input("Objective 标题", "Older"); await advance();
    await input("Objective 标题", "Newer");
    await act(async () => finish(apply(backend.rpc.mock.calls[0][1].p_changes)));
    expect(container.textContent).toContain("自动保存中");
    await advance();
    expect(backend.set!.objectives[0].title).toBe("Newer");
    expect(backend.rpc).toHaveBeenCalledTimes(2);
  });

  it("keeps failed drafts out of the successful cache and retries on explicit save", async () => {
    await render(); await edit();
    backend.rpc.mockResolvedValueOnce({ data: null, error: { message: "Failed transaction" } });
    await input("Objective 标题", "Retained draft"); await advance();
    expect(notice).toHaveBeenCalledWith("Failed transaction", "error");
    expect(JSON.stringify(dehydrate(client))).not.toContain("Retained draft");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Objective 标题"]')!.value).toBe("Retained draft");
    await button("保存草稿");
    expect(backend.rpc).toHaveBeenCalledTimes(2);
    expect(backend.set!.objectives[0].title).toBe("Retained draft");
  });

  it("batches Realtime invalidations until an active save finishes", async () => {
    await render(); await edit();
    let finish!: (value: ReturnType<typeof apply>) => void;
    backend.rpc.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await input("Objective 标题", "New title"); await advance();
    await act(async () => {
      for (const table of ["okr_objectives", "okr_objective_responsibles", "okr_key_results", "okr_key_result_user_acl"]) {
        backend.events.find((event) => event.table === table)!.handler({ eventType: "UPDATE" });
      }
    });
    await advance(240);
    expect(backend.load).toHaveBeenCalledTimes(1);
    await act(async () => finish(apply(backend.rpc.mock.calls[0][1].p_changes)));
    await advance(120);
    expect(backend.load).toHaveBeenCalledTimes(2);
  });

  it("reuses the member menu without fetching and places Add KR before the note", async () => {
    backend.set!.objectives[0].responsible_ids = [];
    await render(); await edit();
    const add = container.querySelector(".okr-add-kr")!;
    const note = container.querySelector(".okr-objective-card.editing .okr-objective-note")!;
    expect(add.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const trigger = container.querySelector<HTMLButtonElement>(".okr-member-control .task-assignee-trigger")!;
    await act(async () => trigger.click());
    expect(document.querySelector('[aria-label="搜索负责人"]')).toBeTruthy();
    const me = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((node) => node.querySelector("span:not(.member-avatar-image)")?.textContent === "我")!;
    await act(async () => me.click());
    expect(backend.rpc).not.toHaveBeenCalled();
    await advance();
    expect(backend.rpc.mock.calls[0][1].p_changes.objectives[0].responsible_ids).toEqual(["demo-user"]);
  });

  it("refreshes task counts once per Realtime batch without reloading OKR content", async () => {
    await render();
    expect(backend.counts).toHaveBeenCalledTimes(1);
    expect(backend.events.find((event) => event.table === "task_okr_links")!.filter).toBeUndefined();
    expect(backend.events.find((event) => event.table === "task_labels")!.filter).toBeUndefined();
    expect(backend.events.find((event) => event.table === "tasks")!.filter).toBe("workspace_id=eq.workspace-team");
    await act(async () => backend.events.find((event) => event.table === "task_okr_links")!.handler({ eventType: "UPDATE", new: { workspace_id: "other" } }));
    await advance(121);
    expect(backend.counts).toHaveBeenCalledTimes(1);
    const kr = backend.set!.objectives[0].key_results[0];
    backend.counts.mockResolvedValue({ [kr.id]: 2 });
    await act(async () => {
      for (const table of ["task_okr_links", "task_okr_links", "tasks", "task_labels"]) {
        backend.events.find((event) => event.table === table)!.handler({ eventType: "UPDATE" });
      }
    });
    await advance(120); await advance(1);
    expect(backend.counts).toHaveBeenCalledTimes(2);
    expect(backend.load).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".okr-objective-row .okr-task-count")!.textContent).toBe("2");
    expect(container.querySelector(".okr-kr-row .okr-task-count")!.textContent).toBe("2");
    await act(async () => backend.events.find((event) => event.table === "okr_objectives")!.handler({ eventType: "UPDATE" }));
    await advance(121);
    expect(backend.counts).toHaveBeenCalledTimes(2);
    await render(false); await advance(800);
    expect(container.querySelector(".okr-objective-row .okr-task-count")!.textContent).toBe("2");
    expect(backend.counts).toHaveBeenCalledTimes(2);
  });

  it("discards unsent queued work when going offline instead of replaying it on reconnect", async () => {
    await render(); await edit();
    let finish!: (value: ReturnType<typeof apply>) => void;
    backend.rpc.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await input("Objective 标题", "Already sent"); await advance();
    await input("Objective 标题", "Must not replay"); await advance();
    await render(false);
    await act(async () => finish(apply(backend.rpc.mock.calls[0][1].p_changes)));
    await render(true); await advance(1600);
    expect(backend.rpc).toHaveBeenCalledTimes(1);
    expect(backend.set!.objectives[0].title).toBe("Already sent");
    expect(container.querySelector('[aria-label="Objective 标题"]')).toBeNull();
  });

  it("keeps cached OKRs readable offline without sending writes", async () => {
    await render();
    await render(false);
    expect(container.querySelector('[aria-label="编辑 Objective"]')).toBeNull();
    expect(container.textContent).toContain(backend.set!.objectives[0].title);
    await advance(1600);
    expect(backend.rpc).not.toHaveBeenCalled();
  });
});
