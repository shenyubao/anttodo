import { expect, test, type Page } from "@playwright/test";

async function openFeatureModuleSettings(page: Page) {
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("button", { name: "功能模块" }).click();
  return settings;
}

test("feature module settings control desktop and mobile navigation locally", async ({ page, context }) => {
  await page.goto("/?demo=1");
  await page.evaluate(() => window.localStorage.removeItem("anttodo:feature-modules"));
  await page.reload();
  const rail = page.locator(".navigation-rail");

  await expect(rail.getByRole("button", { name: "周报" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "日历" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "OKR" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "四象限" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "番茄专注" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "思维导图" })).toHaveCount(0);

  let settings = await openFeatureModuleSettings(page);
  const weeklyReportsSwitch = settings.getByRole("switch", { name: "在主导航中显示周报" });
  const calendarSwitch = settings.getByRole("switch", { name: "在主导航中显示日历" });
  const okrSwitch = settings.getByRole("switch", { name: "在主导航中显示OKR" });
  const matrixSwitch = settings.getByRole("switch", { name: "在主导航中显示四象限" });
  const focusSwitch = settings.getByRole("switch", { name: "在主导航中显示番茄专注" });
  const mindMapSwitch = settings.getByRole("switch", { name: "在主导航中显示思维导图" });
  await expect(weeklyReportsSwitch).toBeChecked();
  await expect(calendarSwitch).toBeChecked();
  await expect(okrSwitch).toBeChecked();
  await expect(matrixSwitch).toBeChecked();
  await expect(focusSwitch).toBeChecked();
  await expect(mindMapSwitch).not.toBeChecked();

  await mindMapSwitch.check();
  await weeklyReportsSwitch.uncheck();
  await calendarSwitch.uncheck();
  await okrSwitch.uncheck();
  await matrixSwitch.uncheck();
  await expect(mindMapSwitch).toBeChecked();
  await expect(weeklyReportsSwitch).not.toBeChecked();
  await expect(calendarSwitch).not.toBeChecked();
  await expect(okrSwitch).not.toBeChecked();
  await expect(matrixSwitch).not.toBeChecked();
  await settings.getByRole("button", { name: "关闭设置" }).click();
  await expect(rail.getByRole("button", { name: "周报" })).toHaveCount(0);
  await expect(rail.getByRole("button", { name: "日历" })).toHaveCount(0);
  await expect(rail.getByRole("button", { name: "OKR" })).toHaveCount(0);
  await expect(rail.getByRole("button", { name: "四象限" })).toHaveCount(0);
  await expect(rail.getByRole("button", { name: "思维导图" })).toBeVisible();

  await rail.getByRole("button", { name: "思维导图" }).click();
  await expect(page.getByRole("heading", { name: "思维导图" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).evaluate((button) => button.click());
  const mobileNavigation = page.getByRole("navigation", { name: "应用视图" });
  await expect(mobileNavigation.getByRole("button", { name: "日历" })).toHaveCount(0);
  await expect(mobileNavigation.getByRole("button", { name: "番茄专注" })).toBeVisible();
  await expect(mobileNavigation.getByRole("button", { name: "思维导图" })).toBeVisible();
  await page.mouse.click(380, 420);
  await page.setViewportSize({ width: 1280, height: 720 });

  settings = await openFeatureModuleSettings(page);
  await context.setOffline(true);
  const offlineMindMapSwitch = settings.getByRole("switch", { name: "在主导航中显示思维导图" });
  await expect(offlineMindMapSwitch).toBeEnabled();
  await offlineMindMapSwitch.uncheck();
  await expect(offlineMindMapSwitch).not.toBeChecked();
  await settings.getByRole("button", { name: "关闭设置" }).click();
  await expect(rail.getByRole("button", { name: "思维导图" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "思维导图" })).toBeVisible();
  await context.setOffline(false);

  await page.reload();
  await expect(page.getByRole("heading", { name: "思维导图" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "日历" })).toHaveCount(0);
  await expect(rail.getByRole("button", { name: "思维导图" })).toHaveCount(0);

  await rail.getByRole("button", { name: "任务" }).click();
  const modifier = await page.evaluate(() => /Mac/.test(navigator.platform) ? "Meta" : "Control");
  await page.keyboard.press(`${modifier}+4`);
  await expect(page.getByRole("heading", { name: "思维导图" })).toBeVisible();
});
