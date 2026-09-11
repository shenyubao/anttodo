import { expect, test, type Page } from "@playwright/test";

const title = "完成 AntTodo 项目框架验收";
async function toggleClosed(page: Page) {
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "显示已完成", exact: true }).click();
}
async function abandon(page: Page, taskTitle = title) {
  await page.getByText(taskTitle, { exact: true }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "放弃", exact: true }).click();
  await expect(page.locator(".toast-action")).toContainText("任务已放弃");
}

test("abandon is undoable while ended tasks are hidden", async ({ page }) => {
  await page.goto("/?demo=1");
  await toggleClosed(page);
  await abandon(page);
  await expect(page.locator(".task-row").filter({ hasText: title })).toHaveCount(0);
  await expect(page.locator(".detail-complete-trigger [data-task-status=cancelled]")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "完成子级任务：检查 Mac 安装包" })).not.toBeChecked();
  await page.getByRole("button", { name: "撤销放弃" }).click();
  await expect(page.locator(".toast")).toContainText("已撤销放弃");
  await expect(page.locator(".task-row").filter({ hasText: title })).toBeVisible();
});

test("cancelled task uses a cross in custom and priority kanban, and restarts", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "看板" }).click();
  await abandon(page);
  const card = page.locator(".kanban-card").filter({ hasText: title });
  await expect(card).toHaveClass(/cancelled/);
  await expect(card.locator(".task-cancelled-icon")).toBeVisible();
  await expect(card.locator(".kanban-card-title")).toHaveCSS("text-decoration-line", "none");
  const group = page.locator(".kanban-closed-toggle").filter({ hasText: "已完成 & 已放弃" });
  await group.click(); await expect(card).toHaveCount(0);
  await group.click(); await expect(card).toBeVisible();
  await page.getByRole("button", { name: "分组与排序" }).click();
  await page.getByRole("menuitem", { name: /分组/ }).click();
  await page.getByRole("menuitemradio", { name: "优先级", exact: true }).click();
  await expect(page.getByRole("heading", { name: "已完成 & 已放弃" })).toBeVisible();
  await card.getByRole("button", { name: "重新开始" }).click();
  await expect(card).not.toHaveClass(/cancelled/);
  await expect(card.getByRole("button", { name: "完成任务" })).toBeVisible();
});

test("abandon child only and undo from the details menu", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByText(title, { exact: true }).click();
  const detail = page.locator(".task-detail");
  await detail.getByRole("button", { name: "更多子级任务操作" }).last().click();
  await page.getByRole("menuitem", { name: "放弃", exact: true }).click();
  await expect(detail.getByRole("button", { name: "重新开始子级任务：检查 Mac 安装包" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "完成任务", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "撤销放弃" }).click();
  await expect(detail.getByRole("checkbox", { name: "完成子级任务：检查 Mac 安装包" })).not.toBeChecked();
});

test("batch abandonment only restores selected tasks", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByText("补齐树形标签 RLS 测试", { exact: true }).click({ modifiers: ["ControlOrMeta"] });
  await page.getByText("整理云效字段映射表", { exact: true }).click({ modifiers: ["ControlOrMeta"] });
  await page.locator(".task-multi-select-actions").getByRole("button", { name: "放弃", exact: true }).click();
  await expect(page.locator(".toast-action")).toContainText("已放弃 2 项任务");
  await expect(page.locator(".task-row").filter({ hasText: title })).toBeVisible();
  await page.getByRole("button", { name: "撤销放弃" }).click();
  await expect(page.locator(".task-row").filter({ hasText: "补齐树形标签 RLS 测试" })).toBeVisible();
  await expect(page.locator(".task-row").filter({ hasText: "整理云效字段映射表" })).toBeVisible();
});

test("mobile details can abandon and undo without leaving the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?demo=1");
  await page.getByText(title, { exact: true }).click();
  await page.getByRole("button", { name: "更多任务操作" }).click();
  await page.getByRole("menuitem", { name: "放弃", exact: true }).click();
  const undo = page.getByRole("button", { name: "撤销放弃" });
  await expect(undo).toBeInViewport();
  await undo.click();
  await expect(page.locator(".toast")).toContainText("已撤销放弃");
});

test("offline undo is disabled and reconnecting does not replay writes", async ({ page, context }) => {
  await page.goto("/?demo=1");
  await abandon(page);
  await context.setOffline(true);
  await expect(page.getByRole("button", { name: "撤销放弃" })).toBeDisabled();
  await expect(page.locator(".detail-complete-trigger [data-task-status=cancelled]")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "撤销放弃" })).toBeEnabled();
  await expect(page.locator(".detail-complete-trigger [data-task-status=cancelled]")).toBeVisible();
  await page.getByRole("button", { name: "撤销放弃" }).click();
  await expect(page.locator(".toast")).toContainText("已撤销放弃");
});

test("undo does not overwrite an edit made after abandoning", async ({ page }) => {
  await page.goto("/?demo=1");
  await abandon(page);
  const input = page.getByRole("textbox", { name: "任务标题", exact: true });
  await input.fill("修改后的放弃任务");
  await input.press("Tab");
  await expect(page.locator(".task-row").filter({ hasText: "修改后的放弃任务" })).toBeVisible();
  await page.getByRole("button", { name: "撤销放弃" }).click();
  await expect(page.locator(".toast")).toContainText("1 项失败");
  await expect(input).toHaveValue("修改后的放弃任务");
  await expect(page.locator(".detail-complete-trigger [data-task-status=cancelled]")).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销放弃" })).toHaveCount(0);
});
