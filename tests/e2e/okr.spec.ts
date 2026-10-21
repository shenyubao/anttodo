import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("anttodo:feature-modules", JSON.stringify({
      okrEnabled: true,
    }));
  });
});

async function dismissDemoNotice(page: import("@playwright/test").Page) {
  const close = page.getByRole("button", { name: "关闭提示" });
  if (await close.isVisible()) await close.click();
}

test("OKR target workspace keeps routing and responsive employee navigation", async ({ page }) => {
  await page.goto("/?demo=1");
  await dismissDemoNotice(page);
  const rail = page.locator(".navigation-rail");
  await expect(rail.getByRole("button", { name: "OKR" })).toBeVisible();
  await rail.getByRole("button", { name: "OKR" }).click();

  await expect(page).toHaveURL(/#\/workspaces\/workspace-team\/okr\/demo-user\//);
  await expect(page.locator(".okr-layout")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "搜索员工" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "沈宇宝" })).toBeVisible();
  await expect(page.getByLabel("OKR 周期").locator("option")).toHaveCount(3);
  await expect(page.getByText("让 AntTodo 成为团队每天信赖的协作工具", { exact: true })).toBeVisible();
  await expect(page.locator(".okr-objective-card")).toHaveCount(2);
  await expect(page.locator(".okr-kr-row")).toHaveCount(4);
  await expect(page.locator(".okr-objective-note.filled")).toHaveCount(2);
  await expect(page.locator(".okr-objective-note-label")).toHaveText(["备注", "备注"]);

  await page.getByRole("button", { name: "更多" }).click();
  const moreMenu = page.getByRole("menu");
  await expect(moreMenu.getByRole("menuitem", { name: "显示设置" })).toBeVisible();
  await expect(moreMenu.getByText(/评论|分享/)).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".okr-layout")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "沈宇宝" })).toBeVisible();
  await page.goForward();
  await expect(page.locator(".okr-layout")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await dismissDemoNotice(page);
  await expect.poll(async () => (await page.locator(".okr-layout").boundingBox())?.width).toBe(390);
  await page.getByRole("button", { name: "打开员工列表" }).click();
  await expect(page.locator(".okr-member-sidebar")).toHaveClass(/mobile-open/);
  await page.mouse.click(370, 420);
  await expect(page.locator(".okr-member-sidebar")).not.toHaveClass(/mobile-open/);
});

test("OKR demo switches cycles and owners and stays read-only without backend calls", async ({ page, context }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/\/(rest|realtime)\/v1\//.test(request.url())) requests.push(request.url());
  });
  await page.goto("/?demo=1#/workspaces/workspace-team/okr");
  await dismissDemoNotice(page);
  const cycle = page.getByLabel("OKR 周期");
  await expect(page.locator(".okr-kr-row")).toHaveCount(4);
  const currentCycleId = await cycle.inputValue();
  await expect(page.getByRole("button", { name: "编辑 Objective" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "添加 Objective" })).toHaveCount(0);
  for (const input of await page.getByRole("textbox", { name: "评分" }).all()) {
    await expect(input).toBeDisabled();
  }

  await page.locator(".okr-objective-row .okr-progress-meter-hit").first().click();
  const detail = page.getByRole("dialog", { name: "OKR 详情" });
  await expect(detail).toContainText("70%");
  await detail.getByRole("tab", { name: "进展记录" }).click();
  await expect(detail).toContainText("暂无进展");
  await expect(detail.getByRole("textbox")).toHaveCount(0);
  await page.getByRole("button", { name: "关闭 OKR 详情" }).click();
  await page.locator(".okr-kr-row .okr-progress-meter-hit").first().click();
  await expect(detail).toContainText("核心任务流程验收通过率达到 100%");
  await page.getByRole("button", { name: "关闭 OKR 详情" }).click();

  await page.locator(".okr-member-sidebar").getByRole("button", { name: "产品同学" }).click();
  await expect(page.getByRole("heading", { name: "产品同学" })).toBeVisible();
  await expect(page.getByText("打造清晰顺畅的跨端任务体验", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "已对齐：让 AntTodo 成为团队每天信赖的协作工具" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "产品同学" })).toBeVisible();
  await dismissDemoNotice(page);
  await page.locator(".okr-member-sidebar").getByRole("button", { name: "沈宇宝" }).click();

  await page.getByRole("button", { name: "上一个周期" }).click();
  await expect(page.getByText("完成 AntTodo 核心能力建设", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一个周期" }).click();
  await expect(cycle).toHaveValue(currentCycleId);
  await page.getByRole("button", { name: "下一个周期" }).click();
  await expect(page.getByText("推动团队协作规模化落地", { exact: true })).toBeVisible();

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await cycle.selectOption(currentCycleId);
  await expect(page.getByText("让 AntTodo 成为团队每天信赖的协作工具", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "显示设置" })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "周期管理" })).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("task and KR details keep a bidirectional return path", async ({ page }) => {
  await page.goto("/?demo=1");
  await dismissDemoNotice(page);
  const taskTitle = "完成 AntTodo 项目框架验收";
  await page.getByText(taskTitle, { exact: true }).click();
  const taskDetail = page.locator(".task-detail-panel");
  const linkedKr = taskDetail.locator(".detail-okr-link");
  await expect(linkedKr).toContainText("核心任务流程验收通过率达到 100%");
  await linkedKr.getByRole("button").first().click();

  await expect(page).toHaveURL(/\/key-results\//);
  const okrDetail = page.getByRole("dialog", { name: "OKR 详情" });
  await expect(okrDetail.getByRole("tab", { name: "待办清单" })).toHaveAttribute("aria-selected", "true");
  await expect(okrDetail.getByRole("button", { name: new RegExp(taskTitle) })).toBeVisible();
  const targetUrl = page.url();

  await okrDetail.getByRole("button", { name: new RegExp(taskTitle) }).click();
  const taskDialog = page.locator(".task-detail-dialog");
  await expect(taskDialog.locator(".detail-title")).toHaveValue(taskTitle);
  await page.keyboard.press("Escape");
  await expect(taskDialog).toHaveCount(0);
  await expect(page).toHaveURL(targetUrl);
  await expect(okrDetail.getByRole("tab", { name: "待办清单" })).toHaveAttribute("aria-selected", "true");
});

test("OKR picker is available from task menus and becomes a mobile sheet", async ({ page }) => {
  await page.goto("/?demo=1");
  await dismissDemoNotice(page);
  const task = page.getByText("完成 AntTodo 项目框架验收", { exact: true });
  await task.click({ button: "right" });
  await page.getByRole("menuitem", { name: "关联 OKR" }).click();
  const picker = page.getByRole("dialog", { name: "选择关联 KR" });
  await expect(picker).toContainText("让 AntTodo 成为团队每天信赖的协作工具");
  await expect(picker.getByRole("button", { name: "确定" })).toBeDisabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(picker).toHaveCSS("left", "8px");
  await expect(picker).toHaveCSS("right", "8px");
});
