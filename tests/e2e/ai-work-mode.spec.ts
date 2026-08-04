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
  await page.getByRole("button", { name: "更多操作" }).click();
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

test("desktop configures Codex and opens independent task/subtask terminals", async ({ page }) => {
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

  await page.getByRole("button", { name: "更多操作" }).click();
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

  const subtaskRow = detail.locator(".subtask-row").filter({ hasText: "检查 Mac 安装包" });
  await subtaskRow.getByRole("button", { name: /^负责人：/ }).click();
  await subtaskRow.getByRole("menuitemradio", { name: "Codex" }).click();
  await expect(detail.locator(".task-cli-terminal")).toBeVisible();
  await detail.getByRole("button", { name: "显示待办内容" }).click();
  await expect(subtaskRow.locator(".subtask-actions > *").evaluateAll((nodes) =>
    nodes.map((node) => node.className))).resolves.toEqual([
    "task-assignee-control subtask-assignee-control",
    "subtask-date-control",
    "subtask-terminal-trigger",
    "subtask-delete",
  ]);

  const starts = await page.evaluate(() => (
    window as Window & { __aiTerminalStarts: Array<{ sessionId: string; prompt: string }> }
  ).__aiTerminalStarts);
  expect(starts.map((item) => item.sessionId)).toEqual([
    expect.stringMatching(/^task:/),
    expect.stringMatching(/^subtask:/),
  ]);
  expect(starts[1].prompt).toContain(`父任务标题：${demoTaskTitle}`);
  expect(starts[1].prompt).toContain("当前子任务：检查 Mac 安装包");
  expect(starts[1].prompt).not.toContain("运行数据库安全测试");
});
