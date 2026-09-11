import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoBundle } from "./lib/demo";
import { weeklyReportWeekStart } from "./lib/weeklyReports";
import { WeeklyReportsWorkspace } from "./WeeklyReportsWorkspace";

vi.mock("./lib/supabase", () => ({ supabase: null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe("weekly reports workspace", () => {
  it("renders the current-week title-only demo feed and navigates to a report", async () => {
    const bundle = createDemoBundle();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onNavigate = vi.fn();
    await act(async () => root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <WeeklyReportsWorkspace
          workspaceId="workspace-team"
          currentUserId="demo-user"
          members={bundle.members}
          userGroups={bundle.userGroups}
          labels={bundle.labels}
          tasks={bundle.tasks}
          online
          demoMode
          route={{ workspaceId: "workspace-team", kind: "weekly_reports" }}
          onNavigate={onNavigate}
          onMenu={vi.fn()}
          onNotice={vi.fn()}
        />
      </QueryClientProvider>,
    ));

    expect(container.querySelector("h1")?.textContent).toBe("周报");
    expect(container.querySelectorAll(".weekly-report-card").length).toBeGreaterThan(0);
    expect(container.querySelector(".weekly-report-card h2")?.textContent).toContain("周周报");
    expect(container.textContent).not.toContain("完成产品体验优化");
    expect(container.querySelector<HTMLButtonElement>(".weekly-report-create")?.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>(".weekly-report-card")?.click());
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({
      kind: "weekly_reports",
      page: "view",
    }));
  });

  it("renders the standalone editor as read-only in demo mode", async () => {
    const bundle = createDemoBundle();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <WeeklyReportsWorkspace
          workspaceId="workspace-team"
          currentUserId="demo-user"
          members={bundle.members}
          userGroups={bundle.userGroups}
          labels={bundle.labels}
          tasks={bundle.tasks}
          online
          demoMode
          route={{
            workspaceId: "workspace-team",
            kind: "weekly_reports",
            page: "new",
            weekStart: weeklyReportWeekStart(),
          }}
          onNavigate={vi.fn()}
          onMenu={vi.fn()}
          onNotice={vi.fn()}
        />
      </QueryClientProvider>,
    ));
    expect(container.querySelector("h1")?.textContent).toBe("创建周报");
    expect(container.textContent).not.toContain("推荐待办");
    expect(container.textContent).toContain("群通知");
    expect(container.textContent).toContain("通知群属于当前团队，所有成员均可选用");
    expect(container.textContent).toContain("未选择通知群，不会发送群通知");
    expect(container.querySelector(".weekly-report-notification-picker > summary")?.getAttribute("aria-disabled"))
      .toBe("true");
    expect([...container.querySelectorAll("textarea")].every((field) => field.readOnly)).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>(".weekly-report-editor-footer button")]
      .filter((button) => button.textContent !== "取消")
      .every((button) => button.disabled)).toBe(true);
  });

  it("closes the notification group picker when clicking outside", async () => {
    const bundle = createDemoBundle();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <WeeklyReportsWorkspace
          workspaceId="workspace-team"
          currentUserId="demo-user"
          members={bundle.members}
          userGroups={bundle.userGroups}
          labels={bundle.labels}
          tasks={bundle.tasks}
          online
          demoMode
          route={{
            workspaceId: "workspace-team",
            kind: "weekly_reports",
            page: "new",
            weekStart: weeklyReportWeekStart(),
          }}
          onNavigate={vi.fn()}
          onMenu={vi.fn()}
          onNotice={vi.fn()}
        />
      </QueryClientProvider>,
    ));

    const picker = container.querySelector<HTMLDetailsElement>(
      ".weekly-report-notification-picker",
    )!;
    picker.open = true;

    await act(async () => {
      picker.querySelector("summary")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(picker.open).toBe(true);

    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(picker.open).toBe(false);
  });

  it("keeps author actions visible but disabled in demo detail view", async () => {
    const bundle = createDemoBundle();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <WeeklyReportsWorkspace
          workspaceId="workspace-team"
          currentUserId="demo-user"
          members={bundle.members}
          userGroups={bundle.userGroups}
          labels={bundle.labels}
          tasks={bundle.tasks}
          online
          demoMode
          route={{
            workspaceId: "workspace-team",
            kind: "weekly_reports",
            page: "view",
            reportId: "demo-weekly-report-1",
          }}
          onNavigate={vi.fn()}
          onMenu={vi.fn()}
          onNotice={vi.fn()}
        />
      </QueryClientProvider>,
    ));
    expect(container.querySelector(".weekly-report-content a")?.getAttribute("href"))
      .toBe("https://app.anttodo.com/workspaces/workspace-team/tasks/demo-product");
    expect(container.querySelector(".weekly-report-content a")?.textContent).toBe("产品体验优化");
    for (const name of ["编辑", "发布", "删除"]) {
      const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((item) => item.textContent?.includes(name));
      expect(button?.disabled).toBe(true);
    }
  });
});
