import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeeklyReportGroupDialog } from "./WeeklyReportGroupDialog";
import { createDemoWeeklyReportGroups, weeklyReportGroupsKey } from "./lib/weeklyReportGroupsApi";
import type { Member, WeeklyReportGroup } from "./types";

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
async function render(disabled = false, group: WeeklyReportGroup | null = initial) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(weeklyReportGroupsKey("team"), [initial]);
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<QueryClientProvider client={client}><WeeklyReportGroupDialog workspaceId="team" group={group} members={members} userGroups={[]}
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
