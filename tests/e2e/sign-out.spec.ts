import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("admin-e2e@example.test");
  await page.getByLabel("密码", { exact: true }).fill("InitialAdminTest123!");
  await page.getByRole("button", { name: "登录社区" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
}

for (const pathname of ["/account", "/"]) {
  test(`从 ${pathname} 退出会撤销会话、清除登录显示并拒绝旧会话`, async ({ page }) => {
    await login(page);
    await page.goto(pathname);
    const session = await page.request.get("/api/auth/get-session");
    expect((await session.json()).session).toBeTruthy();
    const cookies = await page.context().cookies();
    const oldCookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/sign-out"),
    );
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("link", { name: "登录", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "退出登录", exact: true })).toHaveCount(0);
    expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
    const replay = await page.request.get("/api/auth/get-session", {
      headers: { cookie: oldCookie },
    });
    expect(await replay.json()).toBeNull();
    expect((await page.request.get("/api/resources/nonexistent/download")).status()).toBe(401);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login$/);
  });
}

test("退出失败会显示提示、保留页面与输入，并允许重试", async ({ page }) => {
  await login(page);
  await page.getByLabel("当前密码").fill("保留的密码输入");
  let finishRequest!: () => void;
  const heldRequest = new Promise<void>((resolve) => {
    finishRequest = resolve;
  });
  await page.route("**/api/auth/sign-out", async (route) => {
    await heldRequest;
    await route.fulfill({ status: 503, contentType: "text/plain", body: "Unavailable" });
  });
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "正在退出登录", exact: true })).toBeDisabled();
  finishRequest();
  await expect(page.locator("header").getByRole("alert")).toHaveText("退出失败，请稍后重试。");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByLabel("当前密码")).toHaveValue("保留的密码输入");
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeEnabled();
  expect((await (await page.request.get("/api/auth/get-session")).json()).session).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("header").getByRole("alert")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.unroute("**/api/auth/sign-out");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "登录", exact: true })).toBeVisible();
});

test("退出遇到网络错误时显示中文提示，重试可以成功", async ({ page }) => {
  await login(page);
  await page.route("**/api/auth/sign-out", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator("header").getByRole("alert")).toHaveText("网络连接失败，请稍后重试。");
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeEnabled();
  await page.unroute("**/api/auth/sign-out");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("link", { name: "登录", exact: true })).toBeVisible();
});
