import { expect, test, type Page } from "@playwright/test";

const title = "完成 AntTodo 项目框架验收";

async function openTask(page: Page) {
  await page.goto("/?demo=1");
  await page.getByText(title, { exact: true }).click();
  return page.getByRole("textbox", { name: "editable markdown" });
}

async function typeMention(page: Page) {
  const editor = page.getByRole("textbox", { name: "editable markdown" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("@");
  return page.getByRole("option", { name: "产品同学" });
}

test("description contact clicks insert and save silently until explicit send", async ({ page }) => {
  const editor = await openTask(page);
  await (await typeMention(page)).click();
  await expect(editor).toHaveText("@产品同学 ");
  const prompt = page.getByRole("group", { name: "发送提及通知" });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".rich-editor-status")).toContainText("已提交发送");
  await expect(prompt).toHaveCount(0);
  await expect(page.locator(".task-detail")).toBeVisible();
  await page.getByRole("button", { name: "关闭详情" }).click();
  await page.getByText(title, { exact: true }).click();
  await expect(editor).toContainText("@产品同学");
  await expect(prompt).toHaveCount(0);
});

test("calendar dialog treats the contact menu and send prompt as internal interactions", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("anttodo:feature-modules", JSON.stringify({ calendarEnabled: true })));
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "日历", exact: true }).click();
  const taskTitle = "优化任务详情抽屉交互";
  await page.getByText(taskTitle, { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `任务详情：${taskTitle}` });
  await expect(dialog).toBeVisible();
  await (await typeMention(page)).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "editable markdown" })).toHaveText("@产品同学 ");
  const prompt = dialog.getByRole("group", { name: "发送提及通知" });
  await expect(prompt).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(prompt).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.keyboard.type(" and @");
  await page.getByRole("option", { name: "产品同学" }).click();
  await prompt.getByRole("button", { name: "发送", exact: true }).click();
  await expect(dialog.locator(".rich-editor-status")).toContainText("已提交发送");
  await expect(dialog).toBeVisible();
});

test("keyboard mention selection can dismiss notification by typing, Escape or outside click", async ({ page }) => {
  const editor = await openTask(page);
  await typeMention(page);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  const prompt = page.getByRole("group", { name: "发送提及通知" });
  await expect(prompt).toBeVisible();
  await page.keyboard.type("keep typing");
  await expect(prompt).toHaveCount(0);
  await expect(editor).toContainText("@产品同学 keep typing");
  await page.keyboard.type(" @");
  await page.keyboard.press("Tab");
  await expect(prompt).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(prompt).toHaveCount(0);
  await expect(page.locator(".task-detail")).toBeVisible();
  await page.keyboard.type(" @");
  await page.keyboard.press("Enter");
  await expect(prompt).toBeVisible();
  await page.getByRole("textbox", { name: "任务标题" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(editor).toContainText("@产品同学");
});

test("selecting a filtered contact replaces only the query at the saved caret", async ({ page }) => {
  const editor = await openTask(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("before @产 after");
  await editor.evaluate((element) => {
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange();
    range.setStart(text, "before @产".length);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await page.getByRole("option", { name: "产品同学" }).click();
  await expect(editor).toHaveText("before @产品同学  after");
  await expect(page.getByRole("group", { name: "发送提及通知" })).toBeVisible();
});

test("offline closes the prompt and makes the description read-only", async ({ page, context }) => {
  const editor = await openTask(page);
  await (await typeMention(page)).click();
  await expect(page.getByRole("group", { name: "发送提及通知" })).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("group", { name: "发送提及通知" })).toHaveCount(0);
  await expect(editor).toHaveAttribute("contenteditable", "false");
});

test("notes support the same explicit notification flow", async ({ page }) => {
  await openTask(page);
  await page.getByRole("button", { name: "更多任务操作" }).click();
  await page.getByRole("menuitem", { name: "切换为笔记" }).click();
  await expect(page.getByRole("textbox", { name: "笔记标题" })).toBeVisible();
  await (await typeMention(page)).click();
  await page.getByRole("group", { name: "发送提及通知" }).getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".rich-editor-status")).toContainText("已提交发送");
});

test("immersive writing keeps contact selection and notification controls usable", async ({ page }) => {
  await openTask(page);
  await page.getByRole("button", { name: "文本样式", exact: true }).click();
  await page.getByRole("button", { name: "更多文本样式" }).click();
  await page.getByRole("button", { name: "沉浸写作" }).click();
  await expect(page.locator(".task-detail")).toHaveClass(/rich-editor-immersive/);
  await (await typeMention(page)).click();
  await page.getByRole("group", { name: "发送提及通知" }).getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".rich-editor-status")).toContainText("已提交发送");
});

test("mobile contact tap preserves the insertion caret", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await openTask(page);
  const option = await typeMention(page);
  await option.tap();
  await expect(page.getByRole("textbox", { name: "editable markdown" })).toHaveText("@产品同学 ");
  const prompt = page.getByRole("group", { name: "发送提及通知" });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "发送", exact: true }).tap();
  await expect(page.locator(".rich-editor-status")).toContainText("已提交发送");
  await context.close();
});
