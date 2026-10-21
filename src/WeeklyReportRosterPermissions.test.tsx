import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeeklyReportsWorkspace } from "./WeeklyReportsWorkspace";
import { weeklyReportGroupsKey, createDemoWeeklyReportGroups } from "./lib/weeklyReportGroupsApi";
import { weeklyReportsKey } from "./lib/weeklyReportsApi";
import type { AppRoute } from "./lib/appRoute";
import type { WeeklyReport } from "./types";
import { shiftWeeklyReportWeek, weeklyReportWeekStart } from "./lib/weeklyReports";
import { createDemoBundle } from "./lib/demo";

const mocks = vi.hoisted(() => ({ load: vi.fn(async () => []) }));
vi.mock("./lib/supabase", () => ({ supabase: {
  rpc: () => new Promise(() => {}),
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: vi.fn(),
} }));
vi.mock("./WeeklyReportOkrSection", () => ({ WeeklyReportOkrSection: () => null }));
vi.mock("./lib/weeklyReportsApi", async (original) => ({
  ...await original<typeof import("./lib/weeklyReportsApi")>(),
  loadWeeklyReports: mocks.load,
}));
vi.mock("./lib/weeklyReportNotificationsApi", async (original) => ({
  ...await original<typeof import("./lib/weeklyReportNotificationsApi")>(),
  loadWeeklyReportNotificationGroups: async () => [],
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let client: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear(); root = undefined; document.body.replaceChildren();
});
async function render(editor: boolean, listed: boolean | null, options: {
  route?: Extract<AppRoute, { kind: "weekly_reports" }>; online?: boolean; reports?: WeeklyReport[];
} = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (listed !== null) client.setQueryData(weeklyReportGroupsKey("workspace-team"), createDemoWeeklyReportGroups("workspace-team", listed ? ["demo-user"] : []));
  if (options.reports) client.setQueryData(weeklyReportsKey("workspace-team", weeklyReportWeekStart(), "demo-weekly-group-workspace-team"), options.reports);
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const bundle = createDemoBundle();
  await act(async () => root!.render(<QueryClientProvider client={client}>
    <WeeklyReportsWorkspace workspaceId="workspace-team" currentUserId="demo-user" members={bundle.members}
      userGroups={bundle.userGroups} labels={bundle.labels} tasks={bundle.tasks} online={options.online ?? true} demoMode={false}
      route={options.route ?? (editor ? { workspaceId: "workspace-team", kind: "weekly_reports", page: "new", weekStart: weeklyReportWeekStart() } : { workspaceId: "workspace-team", kind: "weekly_reports" })}
      onNavigate={vi.fn()} onMenu={vi.fn()} onNotice={vi.fn()} />
  </QueryClientProvider>));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return container;
}
describe("weekly report roster permissions", () => {
  it("fails closed when restored cache has no configuration", async () => {
    const container = await render(false, null);
    expect(container.querySelector(".weekly-report-create")).toBeNull();
    expect(container.textContent).toContain("正在读取周报组");
  });
  it("reacts to a roster refresh while the editor is already open", async () => {
    const container = await render(true, true);
    const textareas = () => [...container.querySelectorAll<HTMLTextAreaElement>("textarea")];
    expect(textareas().length).toBeGreaterThan(0);
    expect(textareas().every((input) => !input.readOnly)).toBe(true);
    await act(async () => client.setQueryData(weeklyReportGroupsKey("workspace-team"), createDemoWeeklyReportGroups("workspace-team", [])));
    // Query notifications are batched by React Query.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(textareas().every((input) => input.readOnly)).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>(".weekly-report-editor-footer button")].filter((button) => button.textContent !== "取消").every((button) => button.disabled)).toBe(true);
  });
});


it("never refetches a disabled duplicate-check query with a null week", async () => {
  mocks.load.mockClear();
  await render(false, true);
  await act(async () => client.invalidateQueries({ queryKey: ["weekly-reports", "workspace-team"] }));
  expect(mocks.load).toHaveBeenCalled();
  for (const args of mocks.load.mock.calls as unknown as unknown[][]) {
    expect(args[2]).toBe(weeklyReportWeekStart());
    expect(args[3]).toBe("demo-weekly-group-workspace-team");
  }
});

function cachedReport(authorId = "demo-user"): WeeklyReport {
  return {
    id: "report-cached", workspace_id: "workspace-team", weekly_report_group_id: "demo-weekly-group-workspace-team",
    author_id: authorId, week_start: weeklyReportWeekStart(), completed_text: "离线已缓存的周报内容", next_plan_text: "",
    reflection_text: "", okr_progress_text: "", status: "published", visibility: "workspace", user_acl_ids: [], group_acl_ids: [],
    notification_group_ids: [], notification_revision: 0, notification_summary: null, published_at: new Date().toISOString(),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  } satisfies WeeklyReport;
}

it("opens an offline detail from a cached group feed without requiring a separately cached detail", async () => {
  const report = cachedReport();
  const container = await render(false, true, { online: false, reports: [report], route: { workspaceId: "workspace-team", kind: "weekly_reports", page: "view", reportId: report.id } });
  expect(container.textContent).toContain("离线已缓存的周报内容");
  expect([...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "编辑")?.disabled).toBe(true);
});

it("purges cached colleague reports when audience access is revoked but own-history group access remains", async () => {
  const own = cachedReport();
  const colleague = { ...cachedReport("demo-member"), id: "colleague-report", completed_text: "撤销权限后不应显示的内容" };
  const container = await render(false, true, { reports: [own, colleague] });
  await act(async () => {
    client.setQueryData(["weekly-report", "workspace-team", "groups-v1", colleague.id], colleague);
    client.setQueryData(weeklyReportGroupsKey("workspace-team"), createDemoWeeklyReportGroups("workspace-team", []).map((group) => ({ ...group, can_view_published: false })));
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(client.getQueryData<WeeklyReport[]>(weeklyReportsKey("workspace-team", weeklyReportWeekStart(), "demo-weekly-group-workspace-team"))).toEqual([own]);
  expect(client.getQueryData(["weekly-report", "workspace-team", "groups-v1", colleague.id])).toBeUndefined();
  expect(container.querySelectorAll(".weekly-report-card").length).toBe(1);
});


it("keeps the selected week when switching report groups", async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const groups = createDemoWeeklyReportGroups("workspace-team", ["demo-user"]);
  groups.push({ ...groups[0], id: "group-b", name: "第二周报组", is_default: false });
  client.setQueryData(weeklyReportGroupsKey("workspace-team"), groups);
  const bundle = createDemoBundle();
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  function Harness() {
    const [route, setRoute] = useState<Extract<AppRoute, { kind: "weekly_reports" }>>({ workspaceId: "workspace-team", kind: "weekly_reports" });
    return <WeeklyReportsWorkspace workspaceId="workspace-team" currentUserId="demo-user" members={bundle.members} userGroups={bundle.userGroups}
      labels={bundle.labels} tasks={bundle.tasks} online demoMode={false} route={route} onNavigate={setRoute} onMenu={vi.fn()} onNotice={vi.fn()} />;
  }
  await act(async () => root!.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="上一周"]')!.click());
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>(".weekly-report-group-row")].find((item) => item.textContent === "第二周报组")!.click());
  expect(container.querySelector<HTMLInputElement>('input[aria-label="选择周"]')?.value).toBe(shiftWeeklyReportWeek(weeklyReportWeekStart(), -1));
  expect(container.querySelector("h1")?.textContent).toBe("第二周报组");
});
