import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { zipSync, unzipSync, strToU8 } from "fflate";

const origin = "http://127.0.0.1:3100";
const password = "ProjectMemberTest123!";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=",
  "base64",
);

async function activeMember(api: APIRequestContext, email: string, name: string) {
  const databasePath = path.resolve("data/e2e/community.db");
  if (databasePath !== path.join(path.resolve("data/e2e"), "community.db"))
    throw new Error("隔离测试路径无效");
  const connection = new Database(databasePath);
  try {
    // Browser suites share one loopback IP. Clear only this isolated fixture's accumulated limits.
    connection.prepare('DELETE FROM "RateLimit"').run();
    const response = await api.post("/api/account/register", {
      headers: { origin },
      data: {
        email,
        password,
        name,
        statement: "我是双学位测试成员，希望分享课程项目与交流实现思路。",
      },
    });
    expect(response.status(), await response.text()).toBe(200);
    const result = connection
      .prepare(
        'UPDATE "User" SET "emailVerified" = 1, "status" = ?, "mustChangePassword" = 0 WHERE "email" = ? AND "role" = ?',
      )
      .run("ACTIVE", email, "MEMBER");
    expect(result.changes).toBe(1);
  } finally {
    connection.close();
  }
}
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录社区" }).click();
  await expect(page).toHaveURL(/\/account$/);
}
async function currentVersion(api: APIRequestContext, id: string) {
  const response = await api.get(`/api/projects/${id}/status`);
  expect(response.status(), await response.text()).toBe(200);
  const result = await response.json();
  expect(result.status).toBe("SUCCEEDED");
  expect(result.versionId).toBeTruthy();
  return result.versionId as string;
}
function sourceZip(version: number) {
  return Buffer.from(
    zipSync({
      "README.md": strToU8(
        `# 配送路线项目\n\nREADME VERSION ${version}\n\n运行：python src/${version === 1 ? "main" : "planner"}.py\n\n<script>window.__projectScriptExecuted = true</script>`,
      ),
      [version === 1 ? "src/main.py" : "src/planner.py"]: strToU8(
        `print("PROJECT VERSION ${version}")\n`,
      ),
      "data/orders.csv": strToU8("order,demand\nA,3\nB,4\n"),
      ".env": strToU8("TEST_FAKE_PASSWORD=not-a-real-secret"),
      "node_modules/ignored.txt": strToU8("do not import"),
      ".github/workflows/ignored.yml": strToU8("do not run"),
    }),
  );
}

test("专业项目上传、失败重试、代码版本、图文讨论及访问权限", async ({ browser, request }) => {
  test.setTimeout(240000);
  const suffix = Date.now();
  const ownerEmail = `project-owner-${suffix}@example.test`;
  const peerEmail = `project-peer-${suffix}@example.test`;
  await activeMember(request, ownerEmail, "项目作者");
  await activeMember(request, peerEmail, "项目伙伴");
  const ownerContext = await browser.newContext({ baseURL: origin });
  const peerContext = await browser.newContext({ baseURL: origin });
  const guestContext = await browser.newContext({ baseURL: origin });
  const owner = await ownerContext.newPage();
  const peer = await peerContext.newPage();
  const guest = await guestContext.newPage();
  const pageErrors: string[] = [];
  owner.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await login(owner, ownerEmail);
    await login(peer, peerEmail);
    await owner.goto("/projects/new");
    await expect(owner.getByRole("heading", { name: "发布专业项目" })).toBeVisible();
    await owner.getByLabel("项目名称", { exact: true }).fill("配送路线算法实践项目");
    await owner
      .getByLabel("项目介绍", { exact: true })
      .fill("这个项目比较配送路线的实现方式，包含代码、小样例数据和运行说明。");
    await owner.getByLabel("课程 / 主题", { exact: true }).fill("运筹学与数据结构");
    await owner.getByLabel("技术标签", { exact: true }).fill("Python,路径规划");
    await owner.getByLabel("首版说明").fill("实现第一版配送路线数据读取与输出");
    await owner
      .locator('input[type="file"][name="file"]')
      .setInputFiles({ name: "project-v1.zip", mimeType: "application/zip", buffer: sourceZip(1) });

    const fixture = JSON.parse(await readFile("data/e2e/mock-github.json", "utf8")) as {
      url: string;
    };
    expect(new URL(fixture.url).hostname).toBe("127.0.0.1");
    expect(
      (
        await request.post(`${fixture.url}/test/fail-next`, {
          data: { match: "/git/trees", count: 1, status: 503 },
        })
      ).ok(),
    ).toBe(true);
    const acceptedPromise = owner.waitForResponse(
      (response) =>
        response.url().endsWith("/api/projects") && response.request().method() === "POST",
    );
    await owner.getByRole("button", { name: "上传并发布项目" }).click();
    const accepted = await acceptedPromise;
    expect(accepted.status(), await accepted.text()).toBe(202);
    const { id } = (await accepted.json()) as { id: string };
    await expect(owner.getByText("同步失败", { exact: true })).toBeVisible({ timeout: 45000 });
    await expect(owner.getByLabel("项目名称", { exact: true })).toHaveValue("配送路线算法实践项目");
    expect(
      await owner
        .locator('input[type="file"][name="file"]')
        .evaluate((input) => (input as HTMLInputElement).files?.length),
    ).toBe(1);
    await owner.getByRole("button", { name: "重新同步已上传的文件" }).click();
    await expect(owner).toHaveURL(new RegExp(`/projects/${id}$`), { timeout: 45000 });
    await expect(owner.locator(".project-code")).toContainText("README VERSION 1");
    expect(
      await owner.evaluate(
        () => (window as Window & { __projectScriptExecuted?: boolean }).__projectScriptExecuted,
      ),
    ).toBeUndefined();
    const version1 = await currentVersion(ownerContext.request, id);
    const files1Response = await ownerContext.request.get(
      `/api/projects/${id}/files?versionId=${version1}`,
    );
    expect(files1Response.headers()["cache-control"]).toContain("no-store");
    const files1 = (await files1Response.json()) as { files: { path: string }[] };
    expect(files1.files.map((file) => file.path)).toEqual([
      "README.md",
      "data/orders.csv",
      "src/main.py",
    ]);
    await owner.getByRole("button", { name: "src/main.py", exact: true }).click();
    await expect(owner.locator(".project-code")).toContainText("PROJECT VERSION 1");
    const download = await ownerContext.request.get(
      `/api/projects/${id}/download?versionId=${version1}`,
    );
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toContain("attachment");
    const archive = unzipSync(await download.body());
    expect(Object.keys(archive).some((file) => file.endsWith("/README.md"))).toBe(true);
    expect(Object.keys(archive).some((file) => file.endsWith("/.env"))).toBe(false);

    await guest.goto(`/projects/${id}`);
    await expect(guest.getByRole("heading", { name: "配送路线算法实践项目" })).toBeVisible();
    await expect(guest.getByText("代码与讨论，向社区成员开放")).toBeVisible();
    await expect(guest.locator(".project-code")).toHaveCount(0);
    for (const endpoint of ["files", "file?path=README.md", "download", "discussions", "status"]) {
      const response = await guestContext.request.get(`/api/projects/${id}/${endpoint}`);
      expect(response.status(), endpoint).toBe(401);
      expect(response.headers()["cache-control"], endpoint).toContain("no-store");
    }
    expect((await guestContext.request.get("/api/project-images/nonexistent")).status()).toBe(401);
    await peer.goto(`/projects/${id}/edit`);
    await expect(peer.getByRole("heading", { name: "编辑与更新项目" })).toHaveCount(0);
    const tamper = await peerContext.request.post("/api/projects", {
      headers: { origin },
      multipart: {
        projectId: id,
        requestId: crypto.randomUUID(),
        title: "篡改其他人的项目",
        description: "这个上传应该因内容归属检查而被拒绝。",
        course: "数据结构",
        tags: "Python",
        versionMessage: "尝试篡改更新",
        file: { name: "tamper.zip", mimeType: "application/zip", buffer: sourceZip(2) },
      },
    });
    expect(tamper.status(), await tamper.text()).toBe(403);

    const discussion = owner
      .locator("section.panel")
      .filter({ has: owner.getByRole("heading", { name: /项目讨论/ }) });
    await discussion.getByLabel("分享你的想法").fill("这个版本可以怎样改进路线计算？");
    await discussion
      .locator('input[type="file"]')
      .setInputFiles({ name: "route.png", mimeType: "image/png", buffer: png });
    await discussion.getByRole("button", { name: "发布留言" }).click();
    const thread = discussion
      .locator(".discussion-item")
      .filter({ hasText: "这个版本可以怎样改进路线计算？" })
      .first();
    await expect(thread.locator("img")).toBeVisible();
    await expect
      .poll(() =>
        thread.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    const imageUrl = await thread.locator("img").getAttribute("src");
    expect((await guestContext.request.get(imageUrl!)).status()).toBe(401);
    await thread
      .locator("summary")
      .filter({ hasText: /^回复$/ })
      .click();
    await thread.getByLabel("回复内容").fill("可以比较贪心方案和最短路径方案的成本。");
    await thread.getByRole("button", { name: "提交回复" }).click();
    await expect(thread.locator(".discussion-children")).toContainText("可以比较贪心方案");

    await owner.getByRole("link", { name: "编辑与更新项目" }).click();
    await owner
      .getByLabel("项目 ZIP")
      .setInputFiles({ name: "project-v2.zip", mimeType: "application/zip", buffer: sourceZip(2) });
    await owner.getByLabel("版本更新说明").fill("重命名主程序并更新第二版运行说明");
    await owner.getByRole("button", { name: "上传新版本" }).click();
    await expect(owner).toHaveURL(new RegExp(`/projects/${id}$`), { timeout: 45000 });
    await expect(owner.locator(".project-code")).toContainText("README VERSION 2");
    const version2 = await currentVersion(ownerContext.request, id);
    expect(version2).not.toBe(version1);
    const files2 = (await (
      await ownerContext.request.get(`/api/projects/${id}/files?versionId=${version2}`)
    ).json()) as { files: { path: string }[] };
    expect(files2.files.some((file) => file.path === "src/main.py")).toBe(false);
    expect(files2.files.some((file) => file.path === "src/planner.py")).toBe(true);
    await owner.getByLabel("项目版本").selectOption(version1);
    await expect(owner.locator(".project-code")).toContainText("README VERSION 1");
    await owner.screenshot({ path: "data/e2e/projects.png", fullPage: true });
    await owner.setViewportSize({ width: 390, height: 844 });
    expect(
      await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await owner.screenshot({ path: "data/e2e/projects-mobile.png", fullPage: true });
    await owner.setViewportSize({ width: 1440, height: 1000 });
    await owner.getByLabel("项目版本").selectOption(version2);
    await expect(owner.locator(".project-code")).toContainText("README VERSION 2");
    await owner.screenshot({ path: "test-results/project-desktop.png", fullPage: true });
    const stats = (await (await request.get(`${fixture.url}/test/stats`)).json()) as {
      repositories: number;
    };
    expect(stats.repositories).toBe(1);
    expect(pageErrors).toEqual([]);

    await owner.locator("summary").filter({ hasText: "删除这个项目" }).click();
    await owner.getByRole("button", { name: "确认删除项目" }).click();
    await expect
      .poll(async () =>
        (
          await ownerContext.request.get(`/api/projects/${id}/download?versionId=${version1}`)
        ).status(),
      )
      .toBe(404);
    expect(
      (await ownerContext.request.get(`/api/projects/${id}/files?versionId=${version2}`)).status(),
    ).toBe(404);
    expect((await ownerContext.request.get(`/api/projects/${id}/discussions`)).status()).toBe(404);
    expect((await ownerContext.request.get(imageUrl!)).status()).toBe(404);
  } finally {
    await ownerContext.close();
    await peerContext.close();
    await guestContext.close();
  }
});
