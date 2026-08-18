import { expect, test, type Page } from "@playwright/test";

const demoTaskTitle = "完成 AntTodo 项目框架验收";

async function installDesktopAiBridge(page: Page) {
  await page.addInitScript(() => {
    const starts: unknown[] = [];
    Object.defineProperty(window, "__aiTerminalStarts", { value: starts });
    Object.defineProperty(window, "anttodoDesktop", {
      configurable: true,
      value: {
        platform: "darwin",
        versions: { electron: "43", chrome: "140" },
        aiWork: {
          selectDirectory: async () => "/tmp/anttodo-ai-work",
          terminal: {
            start: async (input: unknown) => {
              starts.push(input);
              return { sessionId: "test", buffer: "", running: true, exitCode: null };
            },
            write: async () => true,
            resize: async () => true,
            stop: async () => true,
            onData: () => () => undefined,
            onExit: () => () => undefined,
          },
        },
      },
    });
  });
}

test("web shows disabled AI settings entry and notes hide assignment/terminal", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  const aiSettings = page.getByRole("menuitem", { name: "设置 AI CLI" });
  await expect(aiSettings).toBeVisible();
  await expect(aiSettings).toBeDisabled();
  await expect(aiSettings).toHaveAttribute("title", "仅桌面端");

  await page.getByText("记录下一轮产品想法", { exact: true }).click();
  const detail = page.locator(".task-detail-panel");
  await detail.getByRole("button", { name: "更多任务操作" }).click();
  await page.getByRole("menuitem", { name: "切换为笔记" }).click();
  await expect(detail.getByRole("button", { name: /^负责人：/ })).toHaveCount(0);
  await expect(detail.locator(".detail-terminal-trigger")).toHaveCount(0);
});

test("AI feature settings manage prompt overrides and task-detail entries", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "沈宇宝的账户菜单" }).click();
  await page.getByRole("menuitem", { name: "设置" }).click();

  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("button", { name: "AI功能", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "AI功能" })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "关联" })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "功能", exact: true })).toBeVisible();
  const cliLink = settings.getByRole("link", { name: /蚂蚁清单 CLI/ });
  await expect(cliLink).toHaveAttribute("href", "https://docs.anttodo.com/cli/quickstart");
  await expect(cliLink).toHaveAttribute("target", "_blank");

  const formatRow = settings.locator(".ai-feature-row").filter({ hasText: "智能格式化" });
  await expect(formatRow.getByRole("switch", { name: "智能格式化" })).toBeChecked();
  await formatRow.getByRole("button", { name: /覆盖提示词/ }).click();
  const promptDialog = page.getByRole("dialog", { name: "覆盖智能格式化提示词" });
  const promptEditor = promptDialog.getByRole("textbox", { name: "智能格式化提示词" });
  await expect(promptEditor).toHaveValue(/请把任务整理为更规范的结构化建议/);
  await promptEditor.fill("使用短句整理，并保留原文术语。");
  await promptDialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(promptDialog).toBeHidden();
  await expect(formatRow.getByText("已覆盖", { exact: true })).toBeVisible();

  await formatRow.getByRole("button", { name: /覆盖提示词/ }).click();
  await expect(promptEditor).toHaveValue("使用短句整理，并保留原文术语。");
  await promptDialog.getByRole("button", { name: "恢复默认" }).click();
  await promptDialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(formatRow.getByText("默认", { exact: true })).toBeVisible();

  await formatRow.getByRole("switch", { name: "智能格式化" }).uncheck();
  await settings.getByRole("button", { name: "关闭设置" }).click();
  await page.getByText(demoTaskTitle, { exact: true }).click();
  const detail = page.locator(".task-detail-panel");
  await detail.getByRole("button", { name: "智能处理" }).click();
  await expect(page.getByRole("menuitem", { name: /格式化待办/ })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: /智能分解子级任务/ })).toBeVisible();

  await page.getByRole("button", { name: "沈宇宝的账户菜单" }).click();
  await page.getByRole("menuitem", { name: "设置" }).click();
  const reopenedSettings = page.getByRole("dialog", { name: "设置" });
  await reopenedSettings.getByRole("button", { name: "AI功能", exact: true }).click();
  await reopenedSettings.getByRole("switch", { name: "智能分解子级任务" }).uncheck();
  await reopenedSettings.getByRole("button", { name: "关闭设置" }).click();
  await expect(detail.getByRole("button", { name: "智能处理" })).toHaveCount(0);
});

test("offline AI feature settings stay read-only", async ({ context, page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "沈宇宝的账户菜单" }).click();
  await page.getByRole("menuitem", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("button", { name: "AI功能", exact: true }).click();
  await context.setOffline(true);
  await expect(settings.getByRole("switch", { name: "智能格式化" })).toBeDisabled();
  await expect(settings.getByRole("switch", { name: "智能分解子级任务" })).toBeDisabled();
  await expect(settings.getByRole("button", { name: /覆盖提示词/ })).toHaveCount(2);
  for (const button of await settings.getByRole("button", { name: /覆盖提示词/ }).all()) {
    await expect(button).toBeDisabled();
  }
  await expect(settings.getByRole("link", { name: /蚂蚁清单 CLI/ })).toBeEnabled();
});

test("desktop configures Codex and opens independent task terminals", async ({ page }) => {
  await installDesktopAiBridge(page);
  await page.goto("/?demo=1");

  await page.getByText(demoTaskTitle, { exact: true }).click();
  const detail = page.locator(".task-detail-panel");
  const terminalTrigger = detail.locator(".detail-terminal-trigger");
  await expect(terminalTrigger).toBeVisible();
  await expect(terminalTrigger).toBeEnabled();
  await terminalTrigger.click();
  await expect(page.getByRole("dialog", { name: "设置 AI CLI" })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();

  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置 AI CLI" }).click();
  const settings = page.getByRole("dialog", { name: "设置 AI CLI" });
  await settings.getByRole("checkbox", { name: "Codex" }).click();
  await settings.getByRole("button", { name: "选择" }).click();
  await expect(settings.getByRole("textbox", { name: "默认工作路径" }))
    .toHaveValue("/tmp/anttodo-ai-work");
  await settings.getByRole("button", { name: "保存" }).click();

  await expect(terminalTrigger).toBeEnabled();
  await terminalTrigger.click();
  await expect(detail.locator(".task-cli-terminal")).toBeVisible();
  await detail.getByRole("button", { name: "显示待办内容" }).click();
  await expect(detail.locator(".task-cli-terminal")).toHaveCount(0);

  const childTaskRow = detail.locator(".childTask-row").filter({ hasText: "检查 Mac 安装包" });
  await childTaskRow.getByRole("button", { name: /^负责人：/ }).click();
  await childTaskRow.getByRole("menuitemradio", { name: "Codex" }).click();
  await expect(detail.locator(".task-cli-terminal")).toBeVisible();
  await detail.getByRole("button", { name: "显示待办内容" }).click();
  await expect(childTaskRow.locator(".childTask-actions > *").evaluateAll((nodes) =>
    nodes.map((node) => node.className))).resolves.toEqual([
    "task-assignee-control childTask-assignee-control",
    "childTask-date-control",
    "childTask-terminal-trigger",
    "childTask-delete",
  ]);

  const starts = await page.evaluate(() => (
    window as Window & { __aiTerminalStarts: Array<{ sessionId: string; prompt: string }> }
  ).__aiTerminalStarts);
  expect(starts.map((item) => item.sessionId)).toEqual([
    expect.stringMatching(/^task:/),
    expect.stringMatching(/^task:/),
  ]);
  expect(starts[1].prompt).toContain(`父任务标题：${demoTaskTitle}`);
  expect(starts[1].prompt).toContain("当前子级任务：检查 Mac 安装包");
  expect(starts[1].prompt).not.toContain("运行数据库安全测试");
});
