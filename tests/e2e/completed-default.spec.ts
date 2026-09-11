import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`completed tasks are visible by default and can be hidden at ${viewport.width}px`, async ({ page, context }) => {
    await page.goto("/?demo=1");
    await page.setViewportSize(viewport);

    const completedTask = page.locator(".task-row").filter({ hasText: "搭建只读离线缓存" });
    await expect(completedTask).toBeVisible();
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    const toggle = page.getByRole("menuitemcheckbox", { name: /显示已完成/ });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(completedTask).toHaveCount(0);

    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(completedTask).toBeVisible();

    await context.setOffline(true);
    await expect(completedTask).toBeVisible();
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });
}
