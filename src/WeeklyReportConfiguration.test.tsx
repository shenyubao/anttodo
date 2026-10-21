import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeeklyReportConfigurationControls } from "./WeeklyReportConfiguration";
import { weeklyReportConfigurationKey } from "./lib/weeklyReportConfigurationApi";
import type { Member, WeeklyReportConfiguration } from "./types";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), groups: vi.fn() }));
vi.mock("./lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("./lib/weeklyReportNotificationsApi", () => ({
  weeklyReportNotificationGroupsKey: (id: string) => ["weekly-report-notification-groups", id],
  loadWeeklyReportNotificationGroups: mocks.groups,
  createWeeklyReportNotificationGroup: vi.fn(),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial: WeeklyReportConfiguration = {
  participant_ids: ["owner", "member"], enabled: false, schedules: [], notification_group_ids: [],
};
const members: Member[] = [
  { workspace_id: "team", user_id: "owner", role: "owner" },
  { workspace_id: "team", user_id: "member", role: "member" },
];
let root: Root | undefined;
let client: QueryClient;
beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ data: initial, error: null });
  mocks.groups.mockReset().mockResolvedValue([{ id: "group", name: "研发群" }]);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear(); root = undefined; document.body.replaceChildren();
});
async function render(userId = "owner", online = true) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(weeklyReportConfigurationKey("team"), structuredClone(initial));
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<QueryClientProvider client={client}>
    <WeeklyReportConfigurationControls workspaceId="team" currentUserId={userId} members={members} online={online} demoMode={false} onNotice={vi.fn()} />
  </QueryClientProvider>));
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label)!;
const click = async (label: string) => act(async () => button(label).click());

describe("weekly report configuration", () => {
  it("replaces the people filter with two configuration actions and discards cancelled changes", async () => {
    await render(); await click("人员配置");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("名单外成员仅可查看");
    await click("清空"); await click("取消"); await click("人员配置");
    expect(document.body.textContent).toContain("已选 2 人");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("saves an empty roster optimistically and disables reminders", async () => {
    await render(); await click("人员配置"); await click("清空");
    mocks.rpc.mockResolvedValue({ data: { ...initial, participant_ids: [] }, error: null });
    await click("保存");
    expect(mocks.rpc).toHaveBeenCalledWith("save_weekly_report_participants", { p_workspace_id: "team", p_user_ids: [] });
    expect(client.getQueryData<WeeklyReportConfiguration>(weeklyReportConfigurationKey("team"))?.participant_ids).toEqual([]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("rolls back failed saves and leaves the draft available for retry", async () => {
    await render(); await click("人员配置"); await click("清空");
    mocks.rpc.mockImplementation(async (name: string) => name === "get_weekly_report_configuration"
      ? { data: initial, error: null } : { data: null, error: { message: "服务器拒绝保存" } });
    await click("保存");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("服务器拒绝保存");
    expect(client.getQueryData(weeklyReportConfigurationKey("team"))).toEqual(initial);
    expect(document.body.textContent).toContain("已选 0 人");
  });
  it.each([["member", true], ["owner", false]] as const)("keeps %s online=%s configuration read-only", async (userId, online) => {
    await render(userId, online); await click("人员配置");
    expect(button("保存").disabled).toBe(true);
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((item) => item.disabled)).toBe(true);
    await click("取消"); await click("提醒配置");
    expect(button("添加时间").disabled).toBe(true);
    expect(button("创建通知群").disabled).toBe(true);
  });
  it("requires people, times and groups before enabling reminders", async () => {
    await render(); await click("提醒配置");
    const toggle = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => toggle.click());
    expect(button("保存").disabled).toBe(true);
    await click("添加时间");
    const group = [...document.querySelectorAll<HTMLLabelElement>("label")].find((label) => label.textContent === "研发群")!;
    await act(async () => group.querySelector<HTMLInputElement>("input")!.click());
    expect(button("保存").disabled).toBe(false);
    await click("添加时间");
    expect(document.querySelectorAll('input[type="time"]').length).toBe(2);
    await click("保存");
    expect(mocks.rpc).toHaveBeenCalledWith("save_weekly_report_reminders", expect.objectContaining({
      p_enabled: true, p_group_ids: ["group"], p_schedules: [{ day: 5, time: "18:00" }, { day: 5, time: "18:00" }],
    }));
  });
});

it("disables an already-open group creation form when connectivity or permission is lost", async () => {
  const { WeeklyReportNotificationGroupDialog } = await import("./WeeklyReportNotificationGroupDialog");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const create = vi.fn();
  await act(async () => root!.render(<WeeklyReportNotificationGroupDialog open disabled onOpenChange={vi.fn()} onCreate={create} />));
  expect([...document.querySelectorAll<HTMLInputElement>('input')].every((input) => input.disabled)).toBe(true);
  await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(create).not.toHaveBeenCalled();
});
