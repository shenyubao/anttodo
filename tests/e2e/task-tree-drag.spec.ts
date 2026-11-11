import { expect, test, type Page } from "@playwright/test";

const row = (page: Page, id: string) => page.locator(`.task-scroll article[data-task-id="${id}"]`);
async function dragTo(page: Page, sourceId: string, targetId: string, ratio: number, release = true, sourceGroup?: string, targetGroup?: string) {
  const source = sourceGroup ? page.locator(`.task-group[data-group-id="${sourceGroup}"] article[data-task-id="${sourceId}"]`) : row(page, sourceId);
  const target = targetGroup ? page.locator(`.task-group[data-group-id="${targetGroup}"] article[data-task-id="${targetId}"]`) : row(page, targetId);
  await source.hover();
  const handle = source.locator(".task-drag-handle");
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + 100, to!.y + to!.height * ratio, { steps: 12 });
  await expect(page.locator(".task-tree-drop")).toBeVisible();
  if (release) await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?demo=1#/workspaces/workspace-team/views/all");
  await expect(row(page, "task-1")).toBeVisible();
});

test("a child promotes to a root and can return under its original parent", async ({ page }) => {
  await dragTo(page, "task-1-package", "task-3", 0.1);
  await expect(row(page, "task-1-package")).toHaveClass(/task-row/);
  await expect(page.locator('[aria-label="子级任务：完成 AntTodo 项目框架验收"] [data-task-id="task-1-package"]')).toHaveCount(0);
  await expect(row(page, "task-1-security").locator(".task-drag-handle")).toBeVisible();
  await dragTo(page, "task-1-package", "task-1", 0.5);
  await expect(row(page, "task-1-package")).toHaveClass(/task-list-childTask-row/);
  await expect(page.locator('[aria-label="子级任务：完成 AntTodo 项目框架验收"] [data-task-id="task-1-package"]')).toHaveCount(1);
});

test("a child can move under a nested task and another root", async ({ page }) => {
  await dragTo(page, "task-1-package", "task-1-security", 0.5);
  await expect(row(page, "task-1-package")).toHaveCSS("padding-left", "74px");
  await dragTo(page, "task-1-package", "task-3", 0.5);
  await expect(page.locator('[aria-label="子级任务：补齐树形标签 RLS 测试"] [data-task-id="task-1-package"]')).toHaveCount(1);
  await expect(row(page, "task-1-package")).toHaveCSS("padding-left", "58px");
});

test("hover unfolds a collapsed parent and success keeps it expanded", async ({ page }) => {
  await row(page, "task-1").getByRole("button", { name: "收起子级任务：完成 AntTodo 项目框架验收" }).click();
  await dragTo(page, "task-3", "task-1", 0.5, false);
  await expect(row(page, "task-1-package")).toBeVisible();
  await page.screenshot({ path: "test-results/task-tree-drag-preview.png" });
  await page.mouse.up();
  await expect(page.locator('[aria-label="子级任务：完成 AntTodo 项目框架验收"] [data-task-id="task-3"]')).toHaveCount(1);
  await expect(row(page, "task-1").getByRole("button", { name: "收起子级任务：完成 AntTodo 项目框架验收" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".task-scroll")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".task-scroll")).toHaveAttribute("data-tree-dragging", "false");
  // dnd-kit suppresses immediate post-drag clicks; model a normal button press.
  await row(page, "task-1").getByRole("button", { name: "收起子级任务：完成 AntTodo 项目框架验收" }).click({ delay: 60 });
  await expect(row(page, "task-3")).toHaveCount(0);
});

test("escape restores temporary expansion and makes no tree change", async ({ page }) => {
  await row(page, "task-1").getByRole("button", { name: "收起子级任务：完成 AntTodo 项目框架验收" }).click();
  await dragTo(page, "task-3", "task-1", 0.5, false);
  await expect(row(page, "task-1-package")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(row(page, "task-1-package")).toHaveCount(0);
  await expect(row(page, "task-3")).toHaveClass(/task-row/);
});

test("moving a parent carries descendants and rejects descendant destinations", async ({ page }) => {
  await dragTo(page, "task-1", "task-1-package", 0.5, false);
  await expect(page.locator('.task-tree-drop[data-drop-valid="false"]')).toContainText("不能移入");
  await page.mouse.up();
  await expect(row(page, "task-1")).toHaveClass(/task-row/);
  await dragTo(page, "task-1", "task-3", 0.5);
  await expect(row(page, "task-1")).toHaveClass(/task-list-childTask-row/);
  await expect(row(page, "task-1-package")).toHaveCSS("padding-left", "74px");
});

test("keyboard dragging can change a task's parent", async ({ page }) => {
  const handle = row(page, "task-1-package").locator(".task-drag-handle");
  await handle.focus();
  await page.keyboard.press("Space", { delay: 50 });
  await expect(page.locator(".task-row-drag-overlay")).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('.task-tree-drop[data-drop-placement="before"]')).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.task-tree-drop[data-drop-placement="inside"]')).toBeVisible();
  await page.keyboard.press("Space");
  await expect(row(page, "task-1-package")).toHaveCSS("padding-left", "74px");
});

test("offline lists keep their data and disable all drag handles on mobile", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.setOffline(true);
  await expect(page.locator(".offline-banner")).toBeVisible();
  await expect(row(page, "task-1")).toBeVisible();
  await expect(row(page, "task-1").locator(".task-drag-handle")).toHaveCount(0);
  await expect(row(page, "task-1-package").locator(".task-drag-handle")).toHaveCount(0);
  await context.setOffline(false);
});

test("promotion explains when a task leaves the current filter", async ({ page }) => {
  await page.goto("/?demo=1#/workspaces/workspace-team/views/assigned");
  await dragTo(page, "task-1-package", "task-3", 0.1);
  await expect(row(page, "task-1-package")).toHaveCount(0);
  await expect(page.getByText("任务已移动，因不符合当前筛选条件，已从当前列表隐藏")).toBeVisible();
});

test("multi-label copies have independent drop targets and update together", async ({ page }) => {
  await page.getByRole("button", { name: "分组与排序" }).click();
  await page.getByRole("menuitem", { name: "分组 无" }).click();
  await page.getByRole("menu", { name: "分组方式" }).getByRole("menuitemradio", { name: "团队标签" }).click();
  await expect(row(page, "task-3")).toHaveCount(2);
  await dragTo(page, "task-3", "task-1", 0.5, false, "label:backend", "label:urgent");
  await expect(page.locator(".task-tree-drop")).toHaveCount(1);
  await page.mouse.up();
  await expect(row(page, "task-3")).toHaveCount(1);
  await expect(row(page, "task-3")).toHaveClass(/task-list-childTask-row/);
});

test("a child can promote into an empty custom section", async ({ page }) => {
  await page.locator('.sidebar .label-row[data-label-id="product"]').click();
  await page.getByRole("button", { name: "标签设置", exact: true }).click();
  await page.getByRole("menuitem", { name: "添加分组" }).click();
  await page.getByRole("textbox", { name: "分组名称" }).fill("拖拽目标");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  const target = page.locator(".task-group").filter({ hasText: "拖拽目标" });
  // Section membership must survive promotion even with automatic ordering.
  await page.getByRole("button", { name: "分组与排序" }).click();
  await page.getByRole("menuitem", { name: "排序 自定义" }).click();
  await page.getByRole("menu", { name: "排序方式" }).getByRole("menuitemradio", { name: "时间", exact: true }).click();
  const source = row(page, "task-1-package");
  await source.hover();
  const from = (await source.locator(".task-drag-handle").boundingBox())!;
  const to = (await target.locator(".task-group-header").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 150, to.y + to.height / 2, { steps: 12 });
  await expect(target.locator(".task-tree-drop")).toContainText("提升为顶级任务");
  await page.mouse.up();
  await expect(target.locator('article[data-task-id="task-1-package"]')).toHaveClass(/task-row/);
});
