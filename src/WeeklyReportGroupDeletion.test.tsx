import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeeklyReportsWorkspace } from "./WeeklyReportsWorkspace";
import { createDemoBundle } from "./lib/demo";
import { createDemoWeeklyReportGroups, weeklyReportGroupsKey } from "./lib/weeklyReportGroupsApi";
import { weeklyReportDetailKey, weeklyReportsKey } from "./lib/weeklyReportsApi";
import { requestPermissionRefresh } from "./lib/permissionRefresh";
import { weeklyReportWeekStart } from "./lib/weeklyReports";
import type { WeeklyReport, WorkspaceRole } from "./types";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./lib/supabase", () => ({ supabase: {
  rpc: mocks.rpc,
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: vi.fn(),
} }));
vi.mock("./WeeklyReportOkrSection", () => ({ WeeklyReportOkrSection: () => null }));
vi.mock("./lib/weeklyReportsApi", async (original) => ({
  ...await original<typeof import("./lib/weeklyReportsApi")>(), loadWeeklyReports: () => new Promise(() => {}),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const workspaceId = "workspace-team";
const initial = createDemoWeeklyReportGroups(workspaceId, ["demo-user"])[0];
const target = { ...initial, id: "delete-group", name: "待删除研发组", is_default: false };
const navigate = vi.fn();
let root: Root | undefined;
let client: QueryClient;
let container: HTMLDivElement;
beforeEach(() => { mocks.rpc.mockReset(); navigate.mockReset(); });
afterEach(async () => { await act(async () => root?.unmount()); client?.clear(); document.body.replaceChildren(); root = undefined; });
async function render({ role = "owner", online = true, demoMode = false, onlyGroup = false, defaultGroup = false, creatorId = null, memberPresent = true }: {
  role?: WorkspaceRole; online?: boolean; demoMode?: boolean; onlyGroup?: boolean; defaultGroup?: boolean; creatorId?: string | null; memberPresent?: boolean;
} = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const selected = { ...(defaultGroup ? initial : target), created_by: creatorId };
  client.setQueryData(weeklyReportGroupsKey(workspaceId), onlyGroup ? [selected] : [initial, selected]);
  // Background invalidations must not replace confirmed data with a fixture.
  mocks.rpc.mockImplementation(() => new Promise(() => {}));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const bundle = createDemoBundle();
  await act(async () => root!.render(<QueryClientProvider client={client}><WeeklyReportsWorkspace
    workspaceId={workspaceId} currentUserId="demo-user" members={bundle.members.filter((member) => memberPresent || member.user_id !== "demo-user").map((member) => member.user_id === "demo-user" ? { ...member, role } : member)}
    userGroups={bundle.userGroups} labels={bundle.labels} tasks={bundle.tasks} online={online} demoMode={demoMode}
    route={{ workspaceId, kind: "weekly_reports", groupId: selected.id }} onNavigate={navigate} onMenu={vi.fn()} onNotice={vi.fn()} />
  </QueryClientProvider>));
}
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text);
const click = async (text: string) => { await act(async () => button(text)!.click()); };
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
describe("weekly report group deletion", () => {
  it.each(["owner", "admin"] as const)("shows delete beside configuration for %s", async (role) => {
    await render({ role });
    expect(button("删除周报组")?.disabled).toBe(false);
    expect(container.querySelector(".weekly-report-group-actions")!.textContent).toBe("周报组配置删除周报组");
  });
  it("hides deletion from ordinary participants", async () => {
    await render({ role: "member" });
    expect(button("删除周报组")).toBeUndefined();
    expect(button("周报组配置")).toBeDefined();
  });
  it("allows selecting the default group for deletion too", async () => {
    await render({ defaultGroup: true });
    await click("删除周报组");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("默认周报组");
  });
  it("confirms the permanent group and report deletion, with cancel sending no RPC", async () => {
    await render(); await click("删除周报组");
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("待删除研发组");
    expect(dialog.textContent).toContain("所有周报（包括草稿）");
    expect(dialog.textContent).toContain("无法撤销");
    await click("取消");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalledWith("delete_weekly_report_group", expect.anything());
  });
  it("waits for confirmation from the server, removes deleted caches and selects a surviving group", async () => {
    await render();
    const report = { id: "report", weekly_report_group_id: target.id, workspace_id: workspaceId } as WeeklyReport;
    client.setQueryData(weeklyReportDetailKey(workspaceId, report.id), report);
    const inactiveFeed = weeklyReportsKey(workspaceId, "2026-10-19", target.id);
    client.setQueryData(inactiveFeed, [report]);
    const siblingKey = weeklyReportsKey(workspaceId, weeklyReportWeekStart(), initial.id);
    client.setQueryData(siblingKey, []);
    let finish!: (result: unknown) => void;
    mocks.rpc.mockImplementation((name) => name === "delete_weekly_report_group" ? new Promise((resolve) => { finish = resolve; }) : new Promise(() => {}));
    await click("删除周报组"); await click("永久删除");
    expect(button("删除中…")?.disabled).toBe(true);
    expect(button("取消")?.disabled).toBe(true);
    expect(client.getQueryData(weeklyReportGroupsKey(workspaceId))).toEqual([initial, target]);
    await act(async () => finish({ data: target.id, error: null })); await flush();
    expect(mocks.rpc).toHaveBeenCalledWith("delete_weekly_report_group", { p_workspace_id: workspaceId, p_id: target.id });
    expect(client.getQueryData(weeklyReportGroupsKey(workspaceId))).toEqual([initial]);
    expect(client.getQueryData(inactiveFeed)).toBeUndefined();
    expect(client.getQueryData(weeklyReportDetailKey(workspaceId, report.id))).toBeUndefined();
    expect(client.getQueryData(siblingKey)).toEqual([]);
    expect(navigate).toHaveBeenCalledWith({ workspaceId, kind: "weekly_reports", groupId: initial.id }, true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("preserves the group and dialog on rejection for retry", async () => {
    await render();
    mocks.rpc.mockImplementation((name) => name === "delete_weekly_report_group" ? Promise.resolve({ data: null, error: { message: "权限已撤销" } }) : new Promise(() => {}));
    await click("删除周报组"); await click("永久删除");
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("权限已撤销");
    expect(client.getQueryData(weeklyReportGroupsKey(workspaceId))).toEqual([initial, target]);
    expect(navigate).not.toHaveBeenCalled();
    expect(button("永久删除")?.disabled).toBe(false);
  });
  it("deleting the last group navigates to the empty group route", async () => {
    await render({ onlyGroup: true });
    mocks.rpc.mockImplementation((name) => name === "delete_weekly_report_group" ? Promise.resolve({ data: target.id, error: null }) : new Promise(() => {}));
    await click("删除周报组"); await click("永久删除"); await flush();
    expect(client.getQueryData(weeklyReportGroupsKey(workspaceId))).toEqual([]);
    expect(navigate).toHaveBeenCalledWith({ workspaceId, kind: "weekly_reports" }, true);
  });
  it("disables deletion offline", async () => {
    await render({ online: false });
    expect(button("删除周报组")?.disabled).toBe(true);
    await click("删除周报组");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("weekly report group creator permissions", () => {
  it("opens both creation entries for ordinary members", async () => {
    await render({ role: "member" });
    const create = [...container.querySelectorAll<HTMLButtonElement>("button")].filter((item) => item.getAttribute("aria-label") === "新建周报组" || item.textContent === "新建周报组");
    expect(create).toHaveLength(2);
    expect(create.every((item) => !item.disabled)).toBe(true);
    await act(async () => create[0].click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("新建周报组");
    expect(document.querySelector<HTMLInputElement>("#weekly-report-group-name")?.disabled).toBe(false);
  });
  it("allows the member creator to edit and delete their selected group", async () => {
    await render({ role: "member", creatorId: "demo-user" });
    expect(button("删除周报组")?.disabled).toBe(false);
    await click("周报组配置");
    expect(document.querySelector<HTMLInputElement>("#weekly-report-group-name")?.disabled).toBe(false);
    expect(button("保存")?.disabled).toBe(false);
  });
  it("keeps another creator's group configuration read-only", async () => {
    await render({ role: "member", creatorId: "someone-else" });
    expect(button("删除周报组")).toBeUndefined();
    await click("周报组配置");
    expect(document.querySelector<HTMLInputElement>("#weekly-report-group-name")?.disabled).toBe(true);
    expect(button("保存")?.disabled).toBe(true);
  });
  it("requires current membership even for the creator", async () => {
    await render({ role: "member", creatorId: "demo-user", memberPresent: false });
    expect(button("删除周报组")).toBeUndefined();
    expect(container.querySelector('[aria-label="新建周报组"]')).toBeNull();
    await click("周报组配置");
    expect(button("保存")?.disabled).toBe(true);
  });
  it.each([{ online: false }, { demoMode: true }])("disables creation while read-only: %j", async (options) => {
    await render({ role: "member", ...options });
    expect(container.querySelector<HTMLButtonElement>('[aria-label="新建周报组"]')?.disabled).toBe(true);
  });
  it("confirms a creator deletion through the same RPC and cache cleanup", async () => {
    await render({ role: "member", creatorId: "demo-user" });
    mocks.rpc.mockImplementation((name) => name === "delete_weekly_report_group" ? Promise.resolve({ data: target.id, error: null }) : new Promise(() => {}));
    await click("删除周报组"); await click("永久删除"); await flush();
    expect(client.getQueryData(weeklyReportGroupsKey(workspaceId))).toEqual([initial]);
    expect(navigate).toHaveBeenCalledWith({ workspaceId, kind: "weekly_reports", groupId: initial.id }, true);
  });
});

it("disables creator writes while Realtime permissions are being rechecked", async () => {
  await render({ role: "member", creatorId: "demo-user" });
  await act(async () => { requestPermissionRefresh(client, workspaceId, "weekly"); });
  expect(button("删除周报组")?.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('[aria-label="新建周报组"]')?.disabled).toBe(true);
  await click("周报组配置");
  expect(button("保存")?.disabled).toBe(true);
});
