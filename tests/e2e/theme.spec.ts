import { test, expect, type Page } from "@playwright/test";

async function chooseTheme(page: Page, name: string) {
  await page.getByLabel("主题设置", { exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}

test("品牌、暗色闪光、偏好记忆与主题切换保留输入", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("link", { name: "吉大物流 · 学习社区首页" })).toBeVisible();
  expect(
    await page.locator(".brand-mark").evaluate((el) => getComputedStyle(el).maskImage),
  ).toContain("jida-logistics-v1.png");
  await page.screenshot({
    path: "docs/design/ui-v1/jida-home-light-desktop.png",
    fullPage: true,
    animations: "disabled",
    caret: "initial",
  });

  await chooseTheme(page, "暗色");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page
      .locator(".brand-mark")
      .evaluate((el) => getComputedStyle(el, "::after").animationName),
  ).toBe("brand-shimmer");
  expect(
    await page.locator(".brand-visual").evaluate((el) => getComputedStyle(el).filter),
  ).toContain("drop-shadow");
  await page.screenshot({
    path: "docs/design/ui-v1/jida-home-dark-desktop.png",
    fullPage: true,
    animations: "disabled",
    caret: "initial",
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("link", { name: "登录", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("邮箱", { exact: true }).fill("theme-check@example.test");
  await page.getByLabel("密码", { exact: true }).fill("RetainedInput123!");
  await chooseTheme(page, "浅色");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue("theme-check@example.test");
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("RetainedInput123!");
  await page.screenshot({
    path: "docs/design/ui-v1/jida-login-light.png",
    fullPage: true,
    animations: "disabled",
    caret: "initial",
  });
  await chooseTheme(page, "暗色");
  await page.screenshot({
    path: "docs/design/ui-v1/jida-login-dark.png",
    fullPage: true,
    animations: "disabled",
    caret: "initial",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".brand-mark")
      .evaluate((el) => getComputedStyle(el, "::after").animationName),
  ).toBe("none");
  expect(
    await page.locator(".brand-mark").evaluate((el) => getComputedStyle(el, "::after").display),
  ).toBe("none");
  expect(errors).toEqual([]);
});

test("首次跟随系统、系统变化与手动覆盖", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await chooseTheme(page, "暗色");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await chooseTheme(page, "跟随系统");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("手机深浅主题布局、主题菜单键盘操作", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.screenshot({
    path: "docs/design/ui-v1/jida-home-light-mobile.png",
    fullPage: true,
    animations: "disabled",
    caret: "initial",
  });
  for (const name of ["暗色", "浅色"]) {
    await chooseTheme(page, name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByLabel("主题设置", { exact: true })).toBeVisible();
  }
  await chooseTheme(page, "暗色");
  await page.screenshot({
    path: "docs/design/ui-v1/jida-home-dark-mobile.png",
    fullPage: true,
    animations: "disabled",
    caret: "initial",
  });
  const summary = page.getByLabel("主题设置", { exact: true });
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "跟随系统", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".theme-menu")).not.toHaveAttribute("open");
  await expect(summary).toBeFocused();
});

test("本地存储不可用时仍能切换主题", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage disabled", "SecurityError");
      },
    });
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await chooseTheme(page, "暗色");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await chooseTheme(page, "浅色");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
