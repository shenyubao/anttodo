import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("anttodo:feature-modules", JSON.stringify({
      weeklyReportsEnabled: true,
    }));
  });
});

function currentWeekStart() {
  const date = new Date();
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

test("weekly reports provide a title-only card feed and full detail view", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "周报", exact: true }).click();

  await expect(page.getByRole("heading", { name: "默认周报组", exact: true })).toBeVisible();
  const cards = page.locator(".weekly-report-card");
  await expect(cards.first()).toBeVisible();
  await expect(cards.first().getByRole("heading")).toContainText("周周报");
  await expect(cards.first()).not.toContainText("完成产品体验优化");
  await expect(page.getByRole("button", { name: "新建周报", exact: true })).toBeDisabled();

  await cards.first().click();
  await expect(page.getByRole("heading", { name: "本周完成" })).toBeVisible();
  await expect(page.getByRole("link", { name: "产品体验优化" })).toHaveAttribute(
    "href",
    "https://app.anttodo.com/workspaces/workspace-team/tasks/demo-product",
  );
  await page.getByRole("button", { name: "返回周报列表" }).click();
  await expect(cards.first()).toBeVisible();

  await page.goto(`/?demo=1#/workspaces/workspace-team/weekly-reports/new/${currentWeekStart()}`);
  await expect(page.getByRole("heading", { name: "创建周报" })).toBeVisible();
  await expect(page.getByText("推荐待办", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "从待办选择" })).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "群通知" })).toBeVisible();
  await expect(page.getByText("通知群属于当前团队，所有成员均可选用")).toBeVisible();
  await expect(page.getByText("未选择通知群，不会发送群通知。")).toBeVisible();
  await expect(page.locator(".weekly-report-notification-picker > summary"))
    .toHaveAttribute("aria-disabled", "true");
});

test("weekly reports keep the shared responsive navigation", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("navigation", { name: "应用视图" }).getByRole("button", { name: "周报" }).click();
  await expect(page.getByRole("heading", { name: "默认周报组", exact: true })).toBeVisible();
  await expect(page.locator(".weekly-report-card-flow")).toHaveCSS("grid-template-columns", /.+/);
});

test("weekly report group configuration remains readable in demo and mobile layouts", async ({ page }) => {
  await page.goto("/?demo=1#/workspaces/workspace-team/weekly-reports");
  await page.getByRole("button", { name: "周报组配置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑周报组" });
  await expect(dialog.getByRole("textbox", { name: "组名", exact: true })).toHaveValue("默认周报组");
  await expect(dialog.getByRole("textbox", { name: "搜索应填人员" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await expect(dialog).toContainText("北京时间");
  await expect(dialog).toContainText("本周停止提醒");
  await expect(dialog.getByRole("button", { name: "添加时间", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "关闭提示", exact: true }).click();
  await page.locator(".weekly-report-mobile-toolbar").getByRole("button", { name: "默认周报组" }).click();
  await expect(page.getByRole("complementary", { name: "周报组" })).toBeVisible();
  await page.getByRole("complementary", { name: "周报组" }).getByRole("button", { name: "默认周报组", exact: true }).click();
  await expect(page.getByRole("heading", { name: "默认周报组" })).toBeVisible();
});
