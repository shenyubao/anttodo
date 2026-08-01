import { expect, test, type Page } from "@playwright/test";

const demoTaskTitle = "完成 AntTodo 项目框架验收";

async function openDemoTask(page: Page) {
  await page.goto("/?demo=1");
  await page.getByText(demoTaskTitle, { exact: true }).click();
  return page.getByRole("textbox", { name: "editable markdown" });
}

test("demo task flow and details drawer", async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("heading", { name: "所有" })).toBeVisible();
  await page.getByText(demoTaskTitle, { exact: true }).click();
  await expect(page.locator(".task-detail")).toBeVisible();
  await expect(page.locator(".detail-title")).toHaveValue(demoTaskTitle);
});

test("calendar opens the reusable task dialog and manages labels", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "日历", exact: true }).click();

  const eventTitle = "优化任务详情抽屉交互";
  await page.getByText(eventTitle, { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `任务详情：${eventTitle}` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("width", "400px");
  await expect(dialog).toHaveCSS("height", "300px");
  await expect(dialog).toHaveCSS("border-radius", "14px");
  await expect(page.getByRole("separator", { name: "调整详情面板宽度" })).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "任务标题" })).toHaveValue(eventTitle);

  await dialog.getByRole("button", { name: "管理任务标签" }).click();
  const menu = dialog.getByRole("menu", { name: "选择任务标签" });
  await expect(menu.getByRole("menuitemcheckbox", { name: "桌面与 Web" }))
    .toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemcheckbox", { name: "产品研发" }).click();
  await expect(menu.getByRole("menuitemcheckbox", { name: "产品研发" }))
    .toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemcheckbox", { name: "桌面与 Web" }).click();
  await expect(menu.getByRole("menuitemcheckbox", { name: "桌面与 Web" }))
    .toHaveAttribute("aria-checked", "false");

  await dialog.getByRole("button", { name: "管理任务标签" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("mind map is full width and supports creation, details, and date dragging", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "思维导图" }).click();

  await expect(page.locator(".calendar-sidebar")).toHaveCount(0);
  await expect(page.getByRole("separator", { name: "调整侧边栏宽度" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "隐藏日历列表" })).toHaveCount(0);
  await expect(page.locator(".mind-map-canvas .react-flow")).toBeVisible();
  await page.getByRole("button", { name: "一览全部" }).click();
  await expect(page.getByText("任务清单", { exact: true })).toBeVisible();
  const inboxBranch = page.locator(".react-flow__node-inbox");
  const unscheduledBranch = page.locator(".react-flow__node-unscheduled");
  await expect(inboxBranch).toContainText("收集箱");
  await expect(unscheduledBranch).toContainText("未排期");
  const inboxBox = await inboxBranch.boundingBox();
  const unscheduledBox = await unscheduledBranch.boundingBox();
  expect(inboxBox).not.toBeNull();
  expect(unscheduledBox).not.toBeNull();
  expect(inboxBox!.y).toBeLessThan(unscheduledBox!.y);
  const monthNode = page.locator(".react-flow__node-month").first();
  const weekNode = page.locator(".react-flow__node-week").first();
  const dayNode = page.locator(".react-flow__node-day").first();
  await expect(monthNode).toHaveCSS("width", "88px");
  await expect(weekNode).toHaveCSS("width", "144px");
  await expect(dayNode).toHaveCSS("width", "110px");
  const dateNodeBackgrounds = await Promise.all([monthNode, weekNode, dayNode].map(
    (node) => node.locator(".mind-map-node").evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ));
  expect(new Set(dateNodeBackgrounds).size).toBe(1);
  const labelNode = page.locator(".react-flow__node-label").first();
  const taskNode = page.locator(".react-flow__node-task").first();
  await expect(labelNode).toBeVisible();
  await expect(labelNode.locator(".mind-map-label-content > svg")).toBeVisible();
  const labelBackground = await labelNode.locator(".mind-map-node-label")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  const taskBackground = await taskNode.locator(".mind-map-node-task")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(labelBackground).not.toBe(taskBackground);
  await expect(page.locator(".react-flow__node-task").filter({
    hasText: demoTaskTitle,
  })).toHaveCount(2);

  const targetDay = page.locator(".react-flow__node-day").first();
  await targetDay.click();
  await page.keyboard.press("Enter");
  const draft = page.getByRole("textbox", { name: "新待办标题" });
  await expect(draft).toBeFocused();
  await draft.fill("思维导图快捷创建");
  await draft.press("Enter");

  const createdTask = page.locator(".react-flow__node-task").filter({
    hasText: "思维导图快捷创建",
  });
  await expect(createdTask).toBeVisible();
  await createdTask.getByRole("button", { name: "完成任务" }).click();
  await expect(createdTask.locator(".mind-map-node-task")).toHaveClass(/completed/);
  await createdTask.click();
  const createdDialog = page.getByRole("dialog", {
    name: "任务详情：思维导图快捷创建",
  });
  await expect(createdDialog).toBeVisible();
  await expect(page.getByRole("separator", { name: "调整详情面板宽度" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "一览全部" }).click();
  const unscheduledTask = page.locator(".react-flow__node-task").filter({
    hasText: "记录下一轮产品想法",
  });
  const sourceBox = await unscheduledTask.boundingBox();
  const targetBox = await targetDay.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
    { steps: 16 },
  );
  await page.mouse.up();
  await unscheduledTask.click();
  const draggedDialog = page.getByRole("dialog", {
    name: "任务详情：记录下一轮产品想法",
  });
  await expect(draggedDialog.locator(".detail-due-trigger")).not.toContainText("无日期");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "日历", exact: true }).click();
  await expect(page.locator(".calendar-sidebar")).toBeVisible();
  await expect(page.locator(".calendar-all-check")).toHaveClass(/active/);
});

test("mind map creates labels, inherits labels, and exposes context deletion", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "思维导图" }).click();

  await page.getByRole("button", { name: "一览全部" }).click();
  const productLabel = page.locator(".react-flow__node-label").filter({
    hasText: "产品研发",
  }).first();
  await productLabel.click();
  await page.getByRole("button", { name: "新增标签" }).click();
  const labelDialog = page.getByRole("dialog", { name: "添加标签" });
  await expect(labelDialog.getByRole("combobox")).toHaveValue("product");
  await labelDialog.getByPlaceholder("名称").fill("导图子标签");
  await labelDialog.getByRole("button", { name: "保存" }).click();
  await expect(labelDialog).toBeHidden();
  await expect(page.getByText("导图子标签", { exact: true })).toHaveCount(0);

  await productLabel.click();
  await page.getByRole("button", { name: "新增任务" }).click();
  const taskInput = page.getByRole("textbox", { name: "新待办标题" });
  await taskInput.fill("导图标签任务");
  await taskInput.press("Enter");
  await page.getByRole("button", { name: "一览全部" }).click();

  const createdTask = page.locator(".react-flow__node-task").filter({
    hasText: "导图标签任务",
  });
  await expect(createdTask).toBeVisible();
  await createdTask.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "删除任务" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "任务详情：导图标签任务" })).toHaveCount(0);

  const backendLabel = page.locator(".react-flow__node-label").filter({
    hasText: "Supabase 后端",
  }).first();
  await backendLabel.click({ button: "right" });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menuitem", { name: "删除标签" }).click();
  await expect(page.locator(".react-flow__node-label").filter({
    hasText: "Supabase 后端",
  })).toHaveCount(0);

  await page.getByRole("button", { name: "任务", exact: true }).click();
  await expect(page.getByText("导图标签任务", { exact: true })).toBeVisible();
  await expect(page.getByText("导图子标签", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "思维导图" }).click();
  await page.getByRole("button", { name: "一览全部" }).click();
  const inheritedTask = page.locator(".react-flow__node-task").filter({
    hasText: "导图标签任务",
  });
  await inheritedTask.click({ button: "right" });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menuitem", { name: "删除任务" }).click();
  await expect(inheritedTask).toHaveCount(0);
});

test("mind map dragging adds labels and moving to inbox clears them", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "思维导图" }).click();
  await page.getByRole("button", { name: "一览全部" }).click();
  await page.waitForTimeout(300);

  const taskTitle = "记录下一轮产品想法";
  const sourceTask = page.locator(".react-flow__node-task").filter({ hasText: taskTitle });
  const targetLabel = page.locator(".react-flow__node-label").filter({
    hasText: "产品研发",
  }).first();
  const sourceBox = await sourceTask.boundingBox();
  const labelBox = await targetLabel.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(labelBox!.x + labelBox!.width / 2, labelBox!.y + labelBox!.height / 2, {
    steps: 16,
  });
  await expect(targetLabel).toHaveClass(/mind-map-drop-target/);
  await page.mouse.up();

  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByText("产品研发", { exact: true }).first().click();
  await expect(
    page.getByText(taskTitle, { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "思维导图" }).click();
  await page.getByRole("button", { name: "一览全部" }).click();
  await page.waitForTimeout(300);
  const labeledTask = page.locator(".react-flow__node-task").filter({ hasText: taskTitle });
  const inbox = page.locator(".react-flow__node-inbox");
  const labeledBox = await labeledTask.boundingBox();
  const inboxBox = await inbox.boundingBox();
  expect(labeledBox).not.toBeNull();
  expect(inboxBox).not.toBeNull();
  await page.mouse.move(labeledBox!.x + labeledBox!.width / 2, labeledBox!.y + labeledBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(inboxBox!.x + inboxBox!.width / 2, inboxBox!.y + inboxBox!.height / 2, {
    steps: 12,
  });
  await expect(inbox).toHaveClass(/mind-map-drop-target/);
  await page.mouse.up();

  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("button", { name: /^收集箱/ }).click();
  await expect(page.getByText(taskTitle, { exact: true })).toBeVisible();
});

test("task search matches titles and descriptions and opens the result", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "今天", exact: true }).click();
  await page.getByRole("button", { name: "搜索", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "搜索任务" });
  const input = dialog.getByRole("textbox", { name: "搜索任务" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("width", "560px");
  await expect(dialog).toHaveCSS("height", "422px");
  await expect(dialog).toHaveCSS("border-radius", "12px");
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS("height", "53px");
  await expect(dialog.getByText("输入关键词即可搜索")).toBeVisible();
  await expect(dialog.getByText("标签", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("清单", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("日历事件", { exact: true })).toHaveCount(0);

  await input.fill("Supabase 权限");
  await dialog
    .getByRole("button", { name: `打开任务：${demoTaskTitle}` })
    .click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "所有" })).toBeVisible();
  await expect(page.locator(".detail-title")).toHaveValue(demoTaskTitle);
});

test("task search handles no results, escape, overlay, and mobile access", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "搜索任务" });
  await dialog.getByRole("textbox", { name: "搜索任务" }).fill("不存在的任务");
  await expect(dialog.getByText("未找到相关任务")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.locator(".task-search-overlay").click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeHidden();

  await page.setViewportSize({ width: 390, height: 700 });
  await expect(page.locator(".navigation-rail")).toBeHidden();
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(dialog).toBeVisible();
  const dialogBounds = await dialog.boundingBox();
  expect(dialogBounds).not.toBeNull();
  expect(dialogBounds!.width).toBeLessThanOrEqual(366);
});

test("task detail and labels follow the desktop reference layout", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "显示标签" }).click();
  await page.getByText(demoTaskTitle, { exact: true }).click();

  const detailWidth = await page.locator(".task-detail").evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(detailWidth).toBe(440);

  const titleBounds = await page.locator(".task-row.selected .task-title").boundingBox();
  const labelBounds = await page.locator(".task-row.selected .task-labels").boundingBox();
  expect(titleBounds).not.toBeNull();
  expect(labelBounds).not.toBeNull();
  expect(
    Math.abs(
      titleBounds!.y + titleBounds!.height / 2
      - (labelBounds!.y + labelBounds!.height / 2),
    ),
  ).toBeLessThan(2);

  const labelStyle = await page.locator(".task-row.selected .task-label").first().evaluate(
    (element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        height: element.getBoundingClientRect().height,
        padding: style.padding,
      };
    },
  );
  expect(labelStyle).toEqual({
    color: "rgba(0, 0, 0, 0.85)",
    fontSize: "12px",
    fontWeight: "400",
    height: 18,
    padding: "0px 6px",
  });
});

test("task assignee menu assigns, unassigns, and updates list avatars", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openDemoTask(page);

  const trigger = page.getByRole("button", { name: "负责人：沈宇宝" });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const menu = page.getByRole("menu", { name: "选择负责人" });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("width", "164px");
  await expect(menu).toHaveCSS("border-radius", "12px");
  await expect(menu.getByRole("menuitemradio", { name: "我" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    menu.getByRole("menuitemradio", { name: "不指派" }),
  ).toHaveCSS("height", "34px");

  await menu.getByRole("menuitemradio", { name: "产品同学" }).click();
  await expect(
    page.getByRole("button", { name: "负责人：产品同学" }),
  ).toBeVisible();
  await expect(page.locator(".task-row.selected .task-assignee-avatar")).toBeVisible();

  await page.getByRole("button", { name: "负责人：产品同学" }).click();
  await menu.getByRole("menuitemradio", { name: "不指派" }).click();
  await expect(page.getByRole("button", { name: "负责人：未指派" })).toBeVisible();
  await expect(page.locator(".task-row.selected .task-assignee-avatar")).toHaveCount(0);
});

test("task assignee menu supports escape and keyboard selection", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openDemoTask(page);

  const trigger = page.getByRole("button", { name: "负责人：沈宇宝" });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "选择负责人" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(menu.getByRole("menuitemradio", { name: "不指派" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: "我" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    menu.getByRole("menuitemradio", { name: "产品同学" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "负责人：产品同学" }),
  ).toBeVisible();
});

test("offline mode disables task assignment", async ({ context, page }) => {
  await page.goto("/?demo=1");
  await context.setOffline(true);
  await page.getByText(demoTaskTitle, { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "负责人：沈宇宝" }),
  ).toBeDisabled();
});

test("settings matches the reference geometry and reads account data", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "沈宇宝的账户菜单" }).click();
  await page.getByRole("menuitem", { name: "设置" }).click();

  const dialog = page.getByRole("dialog", { name: "设置" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("border-radius", "20px");
  await expect(dialog).toHaveCSS("width", "800px");
  await expect(dialog).toHaveCSS("height", "680px");
  await expect(dialog.locator(".settings-sidebar")).toHaveCSS("width", "213px");

  await expect(dialog.getByText("沈宇宝", { exact: true })).toBeVisible();
  await expect(dialog.getByText("未设置", { exact: true })).toBeVisible();
  await expect(dialog.getByText("+86 138****8000", { exact: true })).toBeVisible();
  await expect(dialog.getByText("稍后提供", { exact: true })).toHaveCount(4);
  await expect(dialog.locator(".account-profile > span:last-child")).toContainText(
    "AntTodo 产品团队",
  );
  const settingsTabLabels = await dialog.locator(".settings-tab").allTextContents();
  expect(settingsTabLabels.indexOf("团队管理")).toBe(
    settingsTabLabels.indexOf("成员管理") - 1,
  );
  expect(settingsTabLabels.indexOf("成员管理")).toBe(
    settingsTabLabels.indexOf("单点登录") - 1,
  );
  expect(settingsTabLabels).toEqual([
    "账户与安全",
    "日期与时间",
    "快捷键",
    "团队管理",
    "成员管理",
    "单点登录",
    "关于",
  ]);
  await expect(dialog.locator(".settings-tab-group-title")).toHaveText([
    "基础配置",
    "团队配置",
  ]);
  await expect(dialog.getByRole("button", { name: "连接器", exact: true })).toHaveCount(0);

  await dialog.getByRole("button", { name: "团队管理", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "团队管理" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "团队名称" })).toHaveValue(
    "AntTodo 产品团队",
  );
  await expect(dialog.getByRole("textbox", { name: "团队 Slug" })).toHaveValue(
    "anttodo-product",
  );
  await expect(dialog.getByLabel("团队访问地址")).toContainText(
    "anttodo-product.team.anttodo.com",
  );
  await dialog.getByRole("textbox", { name: "团队名称" }).fill("AntTodo 演示团队");
  await dialog.getByRole("textbox", { name: "团队 Slug" }).fill("anttodo-demo");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("团队信息已更新", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "团队名称" })).toHaveValue(
    "AntTodo 演示团队",
  );
  await expect(dialog.getByRole("region", { name: "邀请链接" })).toBeVisible();
  const inviteSwitch = dialog.getByRole("switch", { name: "启用邀请链接" });
  await expect(inviteSwitch).not.toBeChecked();
  await expect(dialog.locator(".invite-link-control")).toHaveCSS("height", "36px");
  await inviteSwitch.check();
  await expect(inviteSwitch).toBeChecked();
  await dialog.getByRole("combobox", { name: "邀请链接加入身份" })
    .selectOption("admin");
  await expect(dialog.getByText("管理员可管理团队成员、标签权限和连接器。"))
    .toBeVisible();
  await dialog.getByRole("button", { name: "复制链接" }).click();
  await expect(page.locator(".toast")).toContainText("演示邀请链接已复制");

  await dialog.getByRole("button", { name: "成员管理", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "AntTodo 演示团队" })).toBeVisible();
  await expect(dialog.getByText("产品同学", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "产品同学的角色" })).toHaveValue("member");
  await expect(dialog.getByRole("region", { name: "邀请链接" })).toHaveCount(0);

  await dialog.getByRole("button", { name: "单点登录", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "单点登录" })).toBeVisible();
  await expect(dialog.getByText("钉钉企业登录", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "日期与时间", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "日期与时间" })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "时间格式" }))
    .toHaveValue("24h");
  await expect(dialog.getByRole("combobox", { name: "日期格式" }))
    .toHaveValue("ymd");
  await expect(dialog.getByRole("combobox", { name: "每周开始于" }))
    .toHaveValue("1");
  await expect(dialog.getByRole("switch", { name: "显示农历" })).not.toBeChecked();
  await expect(dialog.getByRole("switch", { name: "显示周数" })).toBeChecked();
  await expect(dialog.getByRole("switch", { name: "显示节假日调休" })).toBeChecked();
  await expect(dialog.getByRole("switch", { name: "时区" })).not.toBeChecked();
  await expect(dialog.locator(".date-time-setting-row").first()).toHaveCSS("height", "40px");

  await dialog.getByRole("combobox", { name: "时间格式" }).selectOption("12h");
  await dialog.getByRole("combobox", { name: "日期格式" }).selectOption("dmy");
  await dialog.getByRole("combobox", { name: "每周开始于" }).selectOption("0");
  await dialog.getByRole("switch", { name: "显示农历" }).check();
  await dialog.getByRole("switch", { name: "时区" }).check();
  await dialog.getByRole("button", { name: "账户与安全" }).click();
  await expect(dialog.getByText("+86 138****8000", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "关闭设置" }).click();
  await expect(dialog).toBeHidden();
});

test("sidebar and detail panel resizing stops at the reference limits", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openDemoTask(page);

  const sidebar = page.locator(".sidebar");
  const sidebarHandle = page.getByRole("separator", { name: "调整侧边栏宽度" });
  const sidebarHandleBounds = await sidebarHandle.boundingBox();
  expect(sidebarHandleBounds).not.toBeNull();
  await page.mouse.move(sidebarHandleBounds!.x + 2, sidebarHandleBounds!.y + 200);
  await page.mouse.down();
  await page.mouse.move(sidebarHandleBounds!.x + 500, sidebarHandleBounds!.y + 200);
  await page.mouse.up();
  await expect(sidebarHandle).toHaveAttribute("aria-valuenow", "450");
  expect((await sidebar.boundingBox())!.width).toBe(450);

  const detail = page.locator(".task-detail");
  const detailHandle = page.getByRole("separator", { name: "调整详情面板宽度" });
  const detailHandleBounds = await detailHandle.boundingBox();
  expect(detailHandleBounds).not.toBeNull();
  await page.mouse.move(detailHandleBounds!.x + 2, detailHandleBounds!.y + 200);
  await page.mouse.down();
  await page.mouse.move(detailHandleBounds!.x + 500, detailHandleBounds!.y + 200);
  await page.mouse.up();
  await expect(detailHandle).toHaveAttribute("aria-valuenow", "320");
  expect((await detail.boundingBox())!.width).toBe(320);

  await detailHandle.focus();
  await page.keyboard.press("End");
  await expect(detailHandle).toHaveAttribute("aria-valuenow", "440");
  expect((await detail.boundingBox())!.width).toBe(440);
});

test("rich-text toolbar formats markdown and flushes before closing", async ({ page }) => {
  const editor = await openDemoTask(page);
  const styleButton = page.getByRole("button", { name: "文本样式", exact: true });

  await expect(styleButton).toHaveAttribute("aria-expanded", "false");
  await styleButton.click();
  await expect(styleButton).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "更多文本样式" }).click();
  await expect(page.getByRole("button", { name: "沉浸写作" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Block type" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Bold" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Check list" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "添加附件" })).toBeVisible();

  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Markdown 富文本");
  await page.keyboard.press("ControlOrMeta+A");
  await page.getByRole("radio", { name: "Bold" }).click();
  await expect(page.locator(".rich-editor-content strong")).toHaveText("Markdown 富文本");

  await page.getByRole("button", { name: "关闭详情" }).click();
  await page.getByText(demoTaskTitle, { exact: true }).click();
  await expect(page.locator(".rich-editor-content strong")).toHaveText("Markdown 富文本");
});

test("rich-text editor inserts time and exits immersive mode with Escape", async ({ page }) => {
  const editor = await openDemoTask(page);
  await page.getByRole("button", { name: "文本样式", exact: true }).click();

  await editor.click();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "更多文本样式" }).click();
  await page.getByRole("button", { name: "插入当前时间" }).click();
  await expect(editor).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);

  await page.getByRole("button", { name: "更多文本样式" }).click();
  await page.getByRole("button", { name: "沉浸写作" }).click();
  await expect(page.locator(".task-detail")).toHaveClass(/rich-editor-immersive/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".task-detail")).not.toHaveClass(/rich-editor-immersive/);
});

test("narrow task detail exposes secondary formatting under More", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await openDemoTask(page);
  await page.getByRole("button", { name: "文本样式", exact: true }).click();

  const detailWidth = await page.locator(".task-detail").evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(detailWidth).toBeLessThan(560);
  await expect(page.getByRole("button", { name: "更多文本样式" })).toBeVisible();
  await page.getByRole("button", { name: "更多文本样式" }).click();
  await expect(page.getByRole("button", { name: "插入当前时间" })).toBeVisible();
  await expect(page.getByRole("button", { name: "引用" })).toBeVisible();
});

test("offline rich-text editor is read-only and disables formatting", async ({
  page,
  context,
}) => {
  const editor = await openDemoTask(page);
  await page.getByRole("button", { name: "文本样式", exact: true }).click();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(page.locator(".rich-editor-toolbar")).toHaveClass(/is-disabled/);
  await expect(page.getByRole("button", { name: "添加附件" })).toBeDisabled();
});

test("pasted images and selected files use the shared attachment flow", async ({ page }) => {
  const editor = await openDemoTask(page);
  await page.getByRole("button", { name: "文本样式", exact: true }).click();

  await editor.focus();
  await editor.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(
        [
          Uint8Array.from(
            atob(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZugAAAABJRU5ErkJggg==",
            ),
            (character) => character.charCodeAt(0),
          ),
        ],
        "pasted.png",
        { type: "image/png" },
      ),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  });
  await expect(page.locator(".rich-editor-content img")).toHaveCount(1);

  await page.locator(".rich-editor-file-input").setInputFiles({
    name: "requirements.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 demo"),
  });
  await expect(
    page.locator(".rich-editor-content a", { hasText: "requirements.pdf" }),
  ).toBeVisible();
});

test("due date picker saves point, range, all-day, and clear states", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByText("完成 AntTodo 项目框架验收", { exact: true }).click();

  await page.getByRole("button", { name: "设置到期时间" }).click();
  const picker = page.getByRole("dialog", { name: "设置到期时间" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("button", { name: "今天", exact: true })).toBeVisible();
  await expect(picker.getByRole("button", { name: "明天", exact: true })).toBeVisible();
  await expect(picker.getByRole("button", { name: "下周", exact: true })).toBeVisible();
  await expect(picker.getByRole("button", { name: "下月", exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "明天", exact: true }).click();
  await picker.getByRole("button", { name: "确定" }).click();
  await expect(picker).toBeHidden();
  await expect(page.locator(".detail-due-trigger")).not.toHaveClass(/overdue/);

  await page.getByRole("button", { name: "设置到期时间" }).click();
  await picker.getByRole("tab", { name: "时间段" }).click();
  await picker.getByRole("checkbox", { name: "全天" }).check();
  await expect(picker.getByRole("button", { name: "提醒" })).toHaveAttribute("aria-disabled", "true");
  await expect(picker.getByRole("button", { name: "重复" })).toHaveAttribute("aria-disabled", "true");
  await picker.getByRole("button", { name: "提醒" }).dispatchEvent("click");
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "确定" }).click();
  await expect(page.locator(".detail-due-trigger")).toContainText("全天");

  await page.getByRole("button", { name: "设置到期时间" }).click();
  await picker.getByRole("button", { name: "清除" }).click();
  await expect(page.locator(".detail-due-trigger")).toContainText("无日期");
});

test("date and time preferences affect the picker and task timezone", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "沈宇宝的账户菜单" }).click();
  await page.getByRole("menuitem", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("button", { name: "日期与时间", exact: true }).click();
  await settings.getByRole("combobox", { name: "时间格式" }).selectOption("12h");
  await settings.getByRole("combobox", { name: "每周开始于" }).selectOption("0");
  await settings.getByRole("switch", { name: "显示农历" }).check();
  await settings.getByRole("switch", { name: "时区" }).check();
  await settings.getByRole("button", { name: "关闭设置" }).click();

  await page.getByText("完成 AntTodo 项目框架验收", { exact: true }).click();
  await page.getByRole("button", { name: "设置到期时间" }).click();
  const picker = page.getByRole("dialog", { name: "设置到期时间" });
  await expect(picker.getByText("日", { exact: true })).toBeVisible();
  await expect(picker.locator(".due-calendar-grid")).toHaveClass(/with-lunar/);
  await expect(picker.getByRole("combobox", { name: "任务时区" }))
    .toHaveValue(/.+\/.+|UTC/);
  await picker.getByRole("combobox", { name: "任务时区" }).fill("America/New_York");
  await picker.getByRole("button", { name: "确定" }).click();

  await page.getByRole("button", { name: "设置到期时间" }).click();
  await expect(picker.getByRole("combobox", { name: "任务时区" }))
    .toHaveValue("America/New_York");
});

test("due date editing is read-only while offline", async ({ page, context }) => {
  await page.goto("/?demo=1");
  await page.getByText("完成 AntTodo 项目框架验收", { exact: true }).click();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("button", { name: "设置到期时间" })).toBeDisabled();
});

test("priority menu updates the toolbar and task list without reordering", async ({ page }) => {
  await page.goto("/?demo=1");
  const taskTitle = "完成 AntTodo 项目框架验收";
  const taskRow = page.locator(".task-row").filter({ hasText: taskTitle });
  const initialOrder = await page.locator(".task-title").allTextContents();

  await page.getByText(taskTitle, { exact: true }).click();
  const trigger = page.getByRole("button", { name: "设置优先级，当前高优先级" });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "设置优先级" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "高优先级" })).toHaveAttribute("aria-checked", "true");

  await menu.getByRole("menuitemradio", { name: "中优先级" }).click();
  await expect(page.getByRole("button", { name: "设置优先级，当前中优先级" })).toBeVisible();
  await expect(taskRow.locator(".priority-bar")).toHaveCSS("background-color", "rgb(255, 172, 56)");
  await expect(page.locator(".task-title")).toHaveText(initialOrder);

  await page.getByRole("button", { name: "设置优先级，当前中优先级" }).click();
  await menu.getByRole("menuitemradio", { name: "低优先级" }).click();
  await expect(taskRow.locator(".priority-bar")).toHaveCSS("background-color", "rgb(71, 114, 250)");

  await page.getByRole("button", { name: "设置优先级，当前低优先级" }).click();
  await menu.getByRole("menuitemradio", { name: "无优先级" }).click();
  await expect(taskRow.locator(".priority-bar")).toHaveCount(0);
  await expect(page.locator(".task-title")).toHaveText(initialOrder);
});

test("priority menu supports keyboard dismissal and is disabled offline", async ({ page, context }) => {
  await page.goto("/?demo=1");
  await page.getByText("完成 AntTodo 项目框架验收", { exact: true }).click();
  const trigger = page.getByRole("button", { name: "设置优先级，当前高优先级" });

  await trigger.click();
  const menu = page.getByRole("menu", { name: "设置优先级" });
  await expect(menu.getByRole("menuitemradio", { name: "高优先级" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: "中优先级" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitemradio", { name: "无优先级" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(trigger).toBeDisabled();
});

test("task list menu groups by labels and keeps multi-label tasks in every group", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "分组与排序" }).click();
  await page.getByRole("menuitem", { name: "分组 自定义" }).click();
  const groupingMenu = page.getByRole("menu", { name: "分组方式" });
  await groupingMenu.getByRole("menuitemradio", { name: "标签" }).click();

  await expect(
    page.locator(".workspace-main .task-group-collapse").filter({ hasText: "产品研发" }),
  ).toBeVisible();
  await expect(page.getByText("完成 AntTodo 项目框架验收", { exact: true }))
    .toHaveCount(2);
});

test("task list preferences are independent for smart and label lists", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "分组与排序" }).click();
  await page.getByRole("menuitem", { name: "排序 自定义" }).click();
  await page.getByRole("menu", { name: "排序方式" })
    .getByRole("menuitemradio", { name: "优先级" })
    .click();

  await page.getByRole("complementary")
    .getByRole("button", { name: "桌面与 Web 1", exact: true })
    .click();
  await page.getByRole("button", { name: "分组与排序" }).click();
  await expect(page.getByRole("menuitem", { name: "排序 自定义" })).toBeVisible();
});

test("custom sections can be created and renamed", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "添加分组" }).click();
  await page.getByPlaceholder("分组名称").fill("本周计划");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByText("本周计划", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "管理分组“本周计划”" }).click();
  await page.getByRole("menuitem", { name: "重命名" }).click();
  const input = page.locator(".task-section-rename input");
  await input.fill("下周计划");
  await input.press("Enter");
  await expect(page.getByText("下周计划", { exact: true })).toBeVisible();
});

test("custom layout supports pointer cross-group moves and keyboard sorting", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "添加分组" }).click();
  await page.getByPlaceholder("分组名称").fill("待处理");
  await page.getByRole("button", { name: "添加", exact: true }).click();

  const targetGroup = page.locator(".task-group").filter({ hasText: "待处理" });
  const sourceHandle = page.getByRole("button", {
    name: "拖动任务“记录下一轮产品想法”",
  });
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetGroup.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + 80, targetBox!.y + targetBox!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(
    targetGroup.getByText("记录下一轮产品想法", { exact: true }),
  ).toBeVisible();

  const before = await page.locator(".task-title").allTextContents();
  const keyboardHandle = page.getByRole("button", {
    name: "拖动任务“完成 AntTodo 项目框架验收”",
  });
  await keyboardHandle.focus();
  await keyboardHandle.press("Space");
  await keyboardHandle.press("ArrowDown");
  await keyboardHandle.press("Space");
  const after = await page.locator(".task-title").allTextContents();
  expect(after[0]).toBe(before[1]);
  expect(after[1]).toBe(before[0]);
});

test("offline task list preferences and custom layout are read-only", async ({ page, context }) => {
  await page.goto("/?demo=1");
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByRole("button", { name: "分组与排序" }).click();
  await page.getByRole("menuitem", { name: "分组 自定义" }).click();
  await expect(
    page.getByRole("menu", { name: "分组方式" })
      .getByRole("menuitemradio", { name: "时间", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "添加分组" })).toBeDisabled();
});

test("moving a label to inbox removes the label and keeps inbox outside the label tree", async ({ page }) => {
  await page.goto("/?demo=1");
  const labelTree = page.locator(".label-tree");
  await expect(labelTree.getByText("收集箱", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /收集箱/ })).toBeVisible();

  const productLabel = labelTree.locator('.label-row[data-label-id="product"]');
  await productLabel.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "移至收集箱" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await menu.getByRole("menuitem", { name: "移至收集箱" }).click();

  await expect(productLabel).toHaveCount(0);
  await expect(labelTree.getByText("桌面与 Web", { exact: true })).toBeVisible();
  await expect(labelTree.getByText("Supabase 后端", { exact: true })).toBeVisible();
  await expect(page.getByText("整理云效字段映射表", { exact: true })).toBeVisible();
  await expect(page.getByText("完成 AntTodo 项目框架验收", { exact: true })).toHaveCount(0);
});

test("connector page is removed from the main navigation", async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole(
    "button",
    { name: "连接器" },
  )).toHaveCount(0);
  await expect(page.getByText("产品演示同步")).toHaveCount(0);
});

test("account menu contains workspace, settings, and sign-out actions", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "沈宇宝的账户菜单" }).click();

  await expect(page.getByRole("menuitem", { name: "切换团队" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "成员管理" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "设置" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "退出登录" })).toBeVisible();

  await page.getByRole("menuitem", { name: "切换团队" }).click();
  await page.getByRole("menuitemradio", { name: "个人空间" }).click();
  await page.getByRole("button", { name: "沈宇宝的账户菜单" }).click();
  await page.getByRole("menuitem", { name: "设置" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.locator(".account-profile > span:last-child")).toContainText(
    "个人空间",
  );
});
