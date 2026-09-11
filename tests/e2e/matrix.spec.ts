import { expect, test, type Page } from "@playwright/test";

async function openMatrix(page: Page) {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "四象限", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\/workspace-team\/matrix$/);
}

test("matrix matches the desktop 2×2 layout and supports its core flow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openMatrix(page);

  await expect(page.locator(".sidebar")).toHaveCount(0);
  const cards = page.locator(".matrix-quadrant");
  await expect(cards).toHaveCount(4);
  const geometry = await cards.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  expect(geometry[0]?.y).toBe(geometry[1]?.y);
  expect(geometry[2]?.y).toBe(geometry[3]?.y);
  expect(geometry[0]?.x).toBe(geometry[2]?.x);
  expect(geometry[1]?.x).toBe(geometry[3]?.x);
  await expect(page.locator(".matrix-grid")).toHaveCSS("gap", "12px");
  await expect(cards.first()).toHaveCSS("border-radius", "12px");

  await page.getByRole("button", { name: "在不重要但紧急新增任务" }).click();
  await page.getByPlaceholder("添加任务").fill("四象限 E2E 新任务");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  const createdRow = page.locator(".matrix-task-row").filter({ hasText: "四象限 E2E 新任务" });
  await expect(createdRow).toBeVisible();
  await expect(createdRow.locator(".matrix-task-assignee")).toHaveAttribute("title", "沈宇宝");
  await createdRow.getByRole("button", { name: "完成任务" }).click();
  await expect(createdRow.getByRole("button", { name: "恢复任务" })).toBeVisible();

  const desktopTaskRow = page.locator(".matrix-task-row").filter({ hasText: "完成 AntTodo 项目框架验收" });
  await desktopTaskRow.click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  const detail = page.locator(".matrix-task-detail-dialog");
  await expect(detail).toBeVisible();
  await expect(detail).toHaveCSS("width", "400px");
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  await page.goBack();
  await expect(detail).toHaveCount(0);
  await expect(page).toHaveURL(/\/matrix$/);
  await page.goForward();
  await expect(detail).toBeVisible();
  await page.goBack();

  await page.getByRole("button", { name: "不重要但紧急菜单" }).click();
  await page.getByRole("button", { name: "编辑规则" }).click();
  await page.locator(".matrix-rule-name input").fill("紧急待处理");
  await expect(page.locator(".matrix-rule-dialog")).toHaveCSS("width", "558px");
  await expect(page.locator(".matrix-rule-dialog")).toHaveCSS("height", "417px");
  await expect(page.getByRole("button", { name: "不限", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "我", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("button", { name: "四象限", exact: true }).click();
  await expect(page.getByRole("heading", { name: "紧急待处理" })).toBeVisible();
});

test("matrix supports independent presentation, cross-quadrant drag, mobile layout, and offline read-only", async ({ page, context }) => {
  await openMatrix(page);

  await page.getByRole("button", { name: "重要且紧急菜单" }).click();
  await page.getByRole("combobox", { name: "分组" }).selectOption("priority");
  await page.getByRole("combobox", { name: "排序" }).selectOption("title");
  await page.getByRole("button", { name: "升序" }).click();
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("button", { name: "四象限", exact: true }).click();
  await page.getByRole("button", { name: "重要且紧急菜单" }).click();
  await expect(page.getByRole("combobox", { name: "分组" })).toHaveValue("priority");
  await expect(page.getByRole("combobox", { name: "排序" })).toHaveValue("title");
  await expect(page.getByRole("button", { name: "降序" })).toBeVisible();
  await page.getByRole("button", { name: "重要且紧急菜单" }).click();

  await page.getByRole("button", { name: "不重要不紧急菜单" }).click();
  await page.getByRole("button", { name: "编辑规则" }).click();
  await page.getByRole("button", { name: "产品同学", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();

  const sourceRow = page.locator(".matrix-task-row").filter({ hasText: "优化任务详情抽屉交互" });
  const source = sourceRow.getByRole("button", { name: "拖动任务" });
  const target = page.locator(".matrix-quadrant").first();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + 80, { steps: 10 });
  await page.mouse.up();
  await expect(target).toContainText("优化任务详情抽屉交互");
  await expect(target.locator(".matrix-task-row").filter({ hasText: "优化任务详情抽屉交互" }).locator(".matrix-task-assignee"))
    .toHaveAttribute("title", "沈宇宝");
  await page.waitForTimeout(120);

  await page.setViewportSize({ width: 390, height: 844 });
  const cards = page.locator(".matrix-quadrant");
  const mobileGeometry = await cards.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width };
  }));
  expect(new Set(mobileGeometry.map((item) => item.x)).size).toBe(1);
  expect(mobileGeometry.map((item) => item.y)).toEqual([...mobileGeometry.map((item) => item.y)].sort((a, b) => a - b));

  const mobileTaskRow = page.locator(".matrix-task-row").filter({ hasText: "完成 AntTodo 项目框架验收" });
  await mobileTaskRow.click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  const mobileDetail = page.locator(".matrix-task-detail-dialog");
  await expect(mobileDetail).toHaveCSS("width", "390px");
  await expect(mobileDetail).toHaveCSS("height", "844px");
  await page.goBack();

  await context.setOffline(true);
  await expect(page.getByRole("button", { name: "在重要且紧急新增任务" })).toBeDisabled();
  const openTask = page.locator(".matrix-task-row").filter({ hasText: "完成 AntTodo 项目框架验收" });
  await expect(openTask.getByRole("button", { name: "完成任务" })).toBeDisabled();
  await expect(openTask.getByRole("button", { name: "拖动任务" })).toBeDisabled();
  await page.getByRole("button", { name: "重要且紧急菜单" }).click();
  await expect(page.getByRole("button", { name: "编辑规则" })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "分组" })).toBeDisabled();
});
