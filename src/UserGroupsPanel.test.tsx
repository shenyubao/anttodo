import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { dehydrate, hydrate, QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserGroupsPanel } from "./UserGroupsPanel";
import { createDemoBundle } from "./lib/demo";
import { confirmedQueryDehydrateOptions } from "./lib/persistence";
import { clearAsyncSubmissions } from "./lib/useAsyncSubmission";
import { mergeUserGroupSnapshot, UserGroupSubmissionError, type UserGroupAdapter, type UserGroupSnapshot, type UserGroupSubmission } from "./lib/userGroupMutations";
import type { Workspace, WorkspaceBundle } from "./types";

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let online: boolean;
let adapter: UserGroupAdapter;
let finish: (snapshot: UserGroupSnapshot) => void;
let fail: (error: Error) => void;
const workspaceId = "workspace-team";
const key = ["workspace-bundle", workspaceId];
const workspace = { id: workspaceId, role: "owner" } as Workspace;
function Harness({ visible = true, target = workspace }: { visible?: boolean; target?: Workspace }) {
  const bundle = useQuery<WorkspaceBundle>({ queryKey: key, initialData: createDemoBundle(), enabled: false }).data!;
  return visible ? <UserGroupsPanel key={target.id} workspace={target} bundle={bundle} userId="owner" online={online} adapter={adapter} /> : null;
}
async function render(visible = true, target = workspace) {
  await act(async () => root.render(<QueryClientProvider client={client}><Harness visible={visible} target={target} /></QueryClientProvider>));
  await tick();
}
async function tick() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); }); }
function button(text: string, scope: ParentNode = document) {
  const result = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text);
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}
async function click(text: string, scope?: ParentNode) { await act(async () => button(text, scope).click()); await tick(); }
async function draft(name = "待提交组") {
  await click("新建用户组");
  const input = document.querySelector<HTMLInputElement>('.user-group-name-field input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function command() { return vi.mocked(adapter.submit).mock.calls.at(-1)![0]; }
function saved(input = command()): UserGroupSnapshot {
  return { group: { id: input.entityId, workspace_id: input.workspaceId, name: input.name, created_by: input.userId, created_at: "now", updated_at: "now" }, members: [] };
}
beforeEach(() => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(key, createDemoBundle());
  adapter = {
    submit: vi.fn((_input: UserGroupSubmission) => new Promise<UserGroupSnapshot>((resolve, reject) => { finish = resolve; fail = reject; })),
    settle: vi.fn(async (input, snapshot) => {
      if (snapshot) client.setQueryData<WorkspaceBundle>(key, (current) => mergeUserGroupSnapshot(current!, input.entityId, snapshot));
    }), verify: vi.fn(),
  };
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.restoreAllMocks(); });

describe("user group submission UI", () => {
  it("rejects synchronous double submits and preserves the overlay across stale refreshes", async () => {
    await render(); await draft();
    const form = document.querySelector(".user-group-dialog form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await tick();
    expect(adapter.submit).toHaveBeenCalledOnce();
    await act(async () => { client.setQueryData(key, createDemoBundle()); }); await tick();
    expect(container.textContent).toContain("待提交组");
    expect(container.textContent).toContain("提交中…");
    await act(async () => finish(saved())); await tick();
  });

  it("closes immediately, renders pending without caching the draft, and survives remount", async () => {
    await render(); await draft(); await click("保存");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("提交中…");
    expect(client.getQueryData<WorkspaceBundle>(key)!.userGroups.some((group) => group.name === "待提交组")).toBe(false);
    const serialized = JSON.stringify(dehydrate(client, confirmedQueryDehydrateOptions));
    expect(serialized).not.toContain("待提交组");
    expect(JSON.parse(serialized).mutations).toEqual([]);
    await render(false); await render();
    expect(container.textContent).toContain("提交中…");
    await act(async () => finish(saved())); await tick();
    expect(container.textContent).toContain("待提交组");
    expect(container.textContent).not.toContain("提交中…");
    expect(button("编辑", container.querySelector(`[data-group-id="${command().entityId}"]`)! ).disabled).toBe(false);
  });

  it("retains partial drafts and retries with the same operation and group id", async () => {
    await render(); await draft(); await click("保存");
    const original = command();
    await act(async () => fail(new UserGroupSubmissionError("成员保存失败", "partial", saved()))); await tick();
    expect(container.textContent).toContain("部分已保存");
    expect(container.textContent).toContain("仍有未保存内容");
    await click("重试");
    expect(command()).toEqual(original);
    expect(container.textContent).not.toContain("部分已保存");
    await act(async () => finish(saved())); await tick();
    expect(container.querySelectorAll(`[data-group-id="${original.entityId}"]`)).toHaveLength(1);
    expect(container.textContent).not.toContain("提交失败");
  });

  it("edits a failed draft and discards only the local draft", async () => {
    await render(); await draft(); await click("保存");
    await act(async () => fail(new UserGroupSubmissionError("duplicate", "failed"))); await tick();
    const row = container.querySelector(`[data-group-id="${command().entityId}"]`)!;
    await click("编辑", row);
    expect(document.querySelector<HTMLInputElement>('.user-group-name-field input')!.value).toBe("待提交组");
    await click("取消"); await click("放弃", row);
    expect(container.textContent).not.toContain("待提交组");
    expect(client.getQueryData<WorkspaceBundle>(key)!.userGroups).toEqual(createDemoBundle().userGroups);
  });

  it("allows other groups to submit concurrently and isolates another workspace", async () => {
    const pending: Array<(snapshot: UserGroupSnapshot) => void> = [];
    vi.mocked(adapter.submit).mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }));
    await render(); await draft("第一组"); await click("保存");
    const first = command();
    expect(button("编辑", container.querySelector(`[data-group-id="${first.entityId}"]`)!).disabled).toBe(true);
    await draft("第二组"); await click("保存");
    expect(adapter.submit).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(2);
    await render(true, { ...workspace, id: "other-workspace" });
    expect(container.textContent).not.toContain("第一组");
    await act(async () => pending[0](saved(first))); await tick();
    await render();
    expect(container.textContent).toContain("第一组");
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
    await act(async () => pending[1](saved(command()))); await tick();
  });

  it("shows a deletion placeholder and restores the group after a failure", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await render();
    const group = createDemoBundle().userGroups[0];
    const row = container.querySelector(`[data-group-id="${group.id}"]`)!;
    await click("删除", row);
    expect(row.textContent).toContain("删除中…");
    await act(async () => fail(new UserGroupSubmissionError("forbidden", "failed"))); await tick();
    expect(row.textContent).toContain("删除失败");
    await click("重试", row);
    await act(async () => finish({ group: null, members: [] })); await tick();
    expect(container.querySelector(`[data-group-id="${group.id}"]`)).toBeNull();
  });

  it("does not queue on an offline race or reconnect, and restores confirmed data only", async () => {
    await render(); await draft();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await click("保存");
    expect(adapter.submit).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    window.dispatchEvent(new Event("online")); await tick();
    expect(adapter.submit).not.toHaveBeenCalled();
    await click("保存");
    await act(async () => fail(new UserGroupSubmissionError("unknown", "unknown"))); await tick();
    const next = new QueryClient();
    hydrate(next, dehydrate(client, confirmedQueryDehydrateOptions));
    expect(next.getMutationCache().getAll()).toHaveLength(0);
    expect(next.getQueryData<WorkspaceBundle>(key)!.userGroups.some((group) => group.name === "待提交组")).toBe(false);
    clearAsyncSubmissions(client, "owner"); await tick();
    expect(container.textContent).not.toContain("待提交组");
    next.clear();
  });
});
