import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OkrWorkspace } from "./OkrWorkspace";
import { createDemoBundle } from "./lib/demo";
import { createDemoOkrData } from "./lib/demoOkr";
import type { OkrCycle, OkrSet } from "./types";
import { DEFAULT_DATE_TIME_PREFERENCES } from "./lib/dateTimePreferences";

const backend = vi.hoisted(() => ({ set: null as OkrSet | null, cycles: [] as OkrCycle[], progress: vi.fn() }));
vi.mock("./lib/supabase", () => ({ supabase: {
  channel: () => { const c = { on: () => c, subscribe: () => c }; return c; }, removeChannel: vi.fn(),
} }));
vi.mock("./lib/okrApi", async (original) => ({
  ...await original<typeof import("./lib/okrApi")>(),
  loadOkrCycles: async () => backend.cycles,
  loadOkrSet: async () => structuredClone(backend.set),
  loadVisibleOkrOwnerIds: async () => [backend.set!.owner_id],
  loadOkrDisplayPreferences: async () => null,
  loadAlignableOkrObjectives: async () => [],
  loadOkrLinkedTaskCounts: async () => ({}),
  loadOkrProgressRecordCounts: async () => ({ objectives: {}, keyResults: {} }),
  loadOkrProgressRecords: async () => [], loadOkrLinkedTasks: async () => [],
  updateOkrProgress: backend.progress,
}));
let root: Root;
let client: QueryClient;
let container: HTMLDivElement;
let online = true;
const notice = vi.fn();
const creation = {
  formProps: { now: new Date(), dateTimePreferences: DEFAULT_DATE_TIME_PREFERENCES, members: [], labels: [], labelPermissionLevels: {}, userLabelOrder: [], currentUserId: "demo-member" },
  onCreateTask: vi.fn(), onRetryLink: vi.fn(),
};
async function render() {
  const set = backend.set!;
  await act(async () => root.render(<QueryClientProvider client={client}>
    <OkrWorkspace workspaceId="workspace-team" currentUserId="demo-member" currentRole="member"
      initialOwnerId={set.owner_id} initialCycleId={set.cycle_id}
      initialTarget={{ kind: "key_result", id: set.objectives[0].key_results[0].id }}
      members={createDemoBundle().members} userGroups={[]} online={online} taskCreation={creation}
      onNavigate={vi.fn()} onMenu={vi.fn()} onNotice={notice} />
  </QueryClientProvider>));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await tab("进展记录");
}
async function tab(name: string) {
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((n) => n.textContent === name)!.click());
}
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  const demo = createDemoOkrData();
  backend.cycles = demo.cycles;
  backend.set = demo.sets.find((s) => s.owner_id === "demo-user" && demo.cycles.find((c) => c.id === s.cycle_id)?.status === "active")!;
  backend.set.objectives[0].key_results[0].responsible_ids = ["demo-member"];
  backend.progress.mockReset().mockResolvedValue(undefined);
  notice.mockReset(); online = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); document.body.replaceChildren(); });

describe("KR responsible contribution permissions", () => {
  it("enables progress and new todos for responsible while keeping structural edits and notes read-only", async () => {
    await render();
    expect(document.querySelector('[aria-label="记录进展"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="编辑 Objective"]')).toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>(".okr-progress-composer .button.primary")!.click());
    expect(backend.progress).toHaveBeenCalledOnce();
    await tab("待办清单");
    expect(document.querySelector<HTMLInputElement>(".okr-task-composer input[placeholder]")?.disabled).toBe(false);
    await tab("备注");
    expect(document.querySelector(".okr-note-markdown")).toBeTruthy();
    expect(document.querySelector(".mdxeditor")).toBeNull();
  });
  it.each(["unassigned", "closed", "draft", "offline"])("keeps %s access read-only", async (mode) => {
    if (mode === "unassigned") backend.set!.objectives[0].key_results[0].responsible_ids = [];
    if (mode === "closed" || mode === "draft") backend.cycles.find((c) => c.id === backend.set!.cycle_id)!.status = mode;
    if (mode === "offline") online = false;
    await render();
    expect(document.querySelector('[aria-label="记录进展"]')).toBeNull();
    await tab("待办清单");
    expect(document.querySelector<HTMLInputElement>(".okr-task-composer input[placeholder]")?.disabled).toBe(true);
    expect(backend.progress).not.toHaveBeenCalled();
  });
  it("rolls back a rejected progress update and reports failure", async () => {
    backend.progress.mockRejectedValue(new Error("Responsibility revoked"));
    await render();
    const previous = client.getQueryData(["okr-set", "workspace-team", backend.set!.cycle_id, backend.set!.owner_id]);
    const value = document.querySelector<HTMLInputElement>(".okr-composer-value input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(value, "99");
      value.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => document.querySelector<HTMLButtonElement>(".okr-progress-composer .button.primary")!.click());
    expect(notice).toHaveBeenCalledWith("Responsibility revoked", "error");
    expect(client.getQueryData(["okr-set", "workspace-team", backend.set!.cycle_id, backend.set!.owner_id])).toEqual(previous);
    expect(document.querySelector('[aria-label="记录进展"]')).toBeTruthy();
  });
  it("removes contribution controls when responsibility is revoked in the refreshed cache", async () => {
    await render();
    const next = structuredClone(backend.set!); next.objectives[0].key_results[0].responsible_ids = [];
    await act(async () => client.setQueryData(["okr-set", "workspace-team", next.cycle_id, next.owner_id], next));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(document.querySelector('[aria-label="记录进展"]')).toBeNull();
    await tab("待办清单");
    expect(document.querySelector<HTMLInputElement>(".okr-task-composer input[placeholder]")?.disabled).toBe(true);
  });
});
