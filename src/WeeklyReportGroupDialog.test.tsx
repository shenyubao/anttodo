import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeeklyReportGroupDialog } from "./WeeklyReportGroupDialog";
import { createDemoWeeklyReportGroups, weeklyReportGroupsKey } from "./lib/weeklyReportGroupsApi";
import type { Member, UserGroup, UserGroupMember, WeeklyReportGroup } from "./types";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("./lib/weeklyReportNotificationsApi", () => ({
  weeklyReportNotificationGroupsKey: (id: string) => ["weekly-report-notification-groups", id],
  loadWeeklyReportNotificationGroups: async () => [{ id: "notification", name: "研发通知群" }],
  createWeeklyReportNotificationGroup: vi.fn(),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const members: Member[] = [{ workspace_id: "team", user_id: "owner", role: "owner" }, { workspace_id: "team", user_id: "member", role: "member" }];
const initial = { ...createDemoWeeklyReportGroups("team", ["owner"])[0], name: "研发周报" };
let root: Root | undefined;
let client: QueryClient;
let onSaved = vi.fn<(group: WeeklyReportGroup) => void>();
afterEach(async () => { await act(async () => root?.unmount()); client?.clear(); root = undefined; document.body.replaceChildren(); });
beforeEach(() => { mocks.rpc.mockReset(); onSaved = vi.fn<(group: WeeklyReportGroup) => void>(); });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
async function render(disabled = false, group: WeeklyReportGroup | null = initial, userGroups: UserGroup[] = [], userGroupMembers: UserGroupMember[] = [], online = true) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(weeklyReportGroupsKey("team"), [initial]);
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<QueryClientProvider client={client}><WeeklyReportGroupDialog workspaceId="team" group={group} members={members} userGroups={userGroups} userGroupMembers={userGroupMembers} online={online}
    disabled={disabled} onClose={vi.fn()} onSaved={onSaved} onNotice={vi.fn()} /></QueryClientProvider>));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
describe("weekly report group configuration", () => {
  it("saves name, roster, audience and reminders atomically", async () => {
    await render();
    await act(async () => [...document.querySelectorAll<HTMLLabelElement>("label")].find((item) => item.textContent === "指定用户和用户组")!.querySelector<HTMLInputElement>("input")!.click());
    await act(async () => document.querySelector<HTMLInputElement>('.weekly-report-group-audience input[type="checkbox"]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLLabelElement>("label")].find((item) => item.textContent === "开启每周提醒")!.querySelector<HTMLInputElement>("input")!.click());
    expect(button("保存").disabled).toBe(true);
    await click("添加时间");
    await act(async () => [...document.querySelectorAll<HTMLLabelElement>("label")].find((item) => item.textContent === "研发通知群")!.querySelector<HTMLInputElement>("input")!.click());
    mocks.rpc.mockResolvedValue({ data: { ...initial, visibility: "selected", enabled: true }, error: null });
    await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("save_weekly_report_group", expect.objectContaining({ p_id: initial.id, p_name: "研发周报", p_participant_ids: ["owner"], p_visibility: "selected", p_viewer_user_ids: ["owner"], p_enabled: true, p_schedules: [{ day: 5, time: "18:00" }], p_notification_group_ids: ["notification"] }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: initial.id }));
  });
  it("rolls back a failed edit and preserves the draft for retry", async () => {
    await render(); await click("清空");
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "保存被拒绝" } });
    await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(client.getQueryData(weeklyReportGroupsKey("team"))).toEqual([initial]);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("保存被拒绝");
    expect(document.body.textContent).toContain("已选 0 人");
    expect(onSaved).not.toHaveBeenCalled();
  });
  it("starts new groups with no participants, workspace visibility and reminders off", async () => {
    await render(false, null);
    expect(button("保存").disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#weekly-report-group-name')?.value).toBe("");
    expect(document.querySelector<HTMLInputElement>('input[name="group-visibility"]')?.checked).toBe(true);
    expect(document.body.textContent).toContain("请选择至少一名应填人员");
  });
  it("disables every write in read-only mode", async () => {
    await render(true);
    expect([...document.querySelectorAll<HTMLInputElement>("input")].every((input) => input.disabled)).toBe(true);
    expect(button("保存").disabled).toBe(true);
    await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

const userGroups: UserGroup[] = ["研发组", "产品组", "空组"].map((name, i) => ({ id: `group-${i}`, workspace_id: "team", name, created_by: "owner", created_at: "", updated_at: "" }));
const memberships: UserGroupMember[] = [
  { group_id: "group-0", workspace_id: "team", user_id: "owner", added_at: "" },
  { group_id: "group-0", workspace_id: "team", user_id: "member", added_at: "" },
  { group_id: "group-1", workspace_id: "team", user_id: "member", added_at: "" },
  { group_id: "group-1", workspace_id: "team", user_id: "outsider", added_at: "" },
];
const choose = (name: string) => act(async () => [...document.querySelectorAll("label")].find((label) => label.textContent === name)!.querySelector<HTMLInputElement>("input")!.click());
const fill = (selector: string, value: string) => act(async () => {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const submit = () => act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

describe("weekly report participant sources", () => {
  it("switches types, resets search, preserves each selection, and counts the union", async () => {
    await render(false, initial, userGroups, memberships);
    await fill('[aria-label="搜索应填人员"]', "not-found");
    expect(document.body.textContent).toContain("无搜索结果");
    await choose("特定用户组");
    expect(document.querySelector<HTMLInputElement>('[aria-label="搜索应填用户组"]')!.value).toBe("");
    await choose("研发组"); await choose("产品组");
    expect(document.body.textContent).toContain("已选 2 个用户组，应填 2 人");
    await fill('[aria-label="搜索应填用户组"]', "空组");
    expect(document.querySelector(".weekly-report-config-members")!.textContent).toBe("空组");
    await choose("特定用户");
    expect(document.body.textContent).toContain("已选 1 人");
    await choose("特定用户组");
    expect(document.body.textContent).toContain("已选 2 个用户组，应填 2 人");
    mocks.rpc.mockResolvedValue({ data: { ...initial, participant_mode: "groups", participant_group_ids: ["group-0", "group-1"], participant_ids: ["member"] }, error: null });
    await submit();
    expect(mocks.rpc).toHaveBeenCalledWith("save_weekly_report_group", expect.objectContaining({ p_participant_mode: "groups", p_participant_group_ids: ["group-0", "group-1"], p_participant_ids: [] }));
    expect(client.getQueryData<WeeklyReportGroup[]>(weeklyReportGroupsKey("team"))![0].participant_ids).toEqual(["member"]);
  });
  it("allows creating a selected empty group while disabling reminders", async () => {
    await render(false, null, userGroups, memberships);
    await fill("#weekly-report-group-name", "空组周报");
    await choose("特定用户组");
    expect(button("保存").disabled).toBe(true);
    await choose("空组");
    expect(button("保存").disabled).toBe(false);
    expect(document.body.textContent).toContain("当前暂无应填人员，成员加入后自动生效");
    expect([...document.querySelectorAll("label")].find((label) => label.textContent === "开启每周提醒")!.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
    mocks.rpc.mockResolvedValue({ data: { ...initial, participant_mode: "groups", participant_group_ids: ["group-2"], participant_ids: [], enabled: false }, error: null });
    await submit();
    expect(mocks.rpc).toHaveBeenCalledWith("save_weekly_report_group", expect.objectContaining({ p_participant_group_ids: ["group-2"], p_enabled: false }));
  });
  it("restores group mode when editing, supports select all and clear, and rolls back", async () => {
    const existing = { ...initial, participant_mode: "groups" as const, participant_group_ids: ["group-1"], participant_ids: ["member"] };
    await render(false, existing, userGroups, memberships);
    expect(document.querySelector<HTMLInputElement>('input[name="participant-mode"]:checked')!.parentElement!.textContent).toBe("特定用户组");
    await click("全选");
    expect(document.body.textContent).toContain("已选 3 个用户组，应填 2 人");
    await click("清空");
    expect(document.body.textContent).toContain("已选 0 个用户组，应填 0 人");
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "拒绝保存" } });
    await submit();
    expect(client.getQueryData(weeklyReportGroupsKey("team"))).toEqual([initial]);
    expect(document.body.textContent).toContain("已选 0 个用户组，应填 0 人");
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("拒绝保存");
  });
  it("submits only users after switching from group mode", async () => {
    await render(false, { ...initial, participant_mode: "groups", participant_group_ids: ["group-0"] }, userGroups, memberships);
    await choose("特定用户"); await click("全选");
    mocks.rpc.mockResolvedValue({ data: initial, error: null });
    await submit();
    expect(mocks.rpc).toHaveBeenCalledWith("save_weekly_report_group", expect.objectContaining({ p_participant_mode: "users", p_participant_group_ids: [], p_participant_ids: ["owner", "member"] }));
  });
  it("shows missing groups and empty search results", async () => {
    await render(); await choose("特定用户组");
    expect(document.body.textContent).toContain("暂无用户组");
  });
  it("disables group edits when offline even if disabled was not set", async () => {
    await render(false, { ...initial, participant_mode: "groups", participant_group_ids: ["group-0"] }, userGroups, memberships, false);
    expect([...document.querySelectorAll<HTMLInputElement>("input")].every((input) => input.disabled)).toBe(true);
    await submit(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reads legacy cached groups as individual users", async () => {
    const legacy = { ...initial };
    delete (legacy as Partial<WeeklyReportGroup>).participant_mode;
    delete (legacy as Partial<WeeklyReportGroup>).participant_group_ids;
    await render(false, legacy);
    expect(document.querySelector<HTMLInputElement>('input[name="participant-mode"]')!.checked).toBe(true);
    expect(document.body.textContent).toContain("已选 1 人");
  });
});
