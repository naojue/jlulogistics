import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

const origin = "http://127.0.0.1:3100";
const password = "PdfQuestionsMember123!";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=",
  "base64",
);
function twoPagePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>",
  ];
  let value = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(value.length);
    value += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = value.length;
  value += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join("\n")}\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(value);
}

// Deliberately open only the database owned by scripts/e2e-server.ts; never import runtime db/env.
function testMember(email: string, status: string) {
  const file = path.resolve("data/e2e/community.db");
  if (file !== path.join(path.resolve("data/e2e"), "community.db"))
    throw new Error("测试数据库地址无效");
  const connection = new Database(file);
  try {
    const changed = connection
      .prepare(
        'UPDATE "User" SET "emailVerified"=1, "status"=? WHERE "email"=? AND "role"=\'MEMBER\'',
      )
      .run(status, email);
    if (changed.changes !== 1) throw new Error("隔离测试成员不存在");
  } finally {
    connection.close();
  }
}

test("PDF 按页提问：真实登录、页码、草稿保留、图片回复、解决和跳页", async ({ page, request }) => {
  test.setTimeout(180000);
  const suffix = Date.now();
  const email = `pdf-questions-${suffix}@example.test`;
  expect((await request.get("/api/resources/nonexistent/questions?fileId=missing")).status()).toBe(
    401,
  );
  const registered = await request.post("/api/account/register", {
    headers: { origin },
    data: {
      email,
      password,
      name: "按页提问测试成员",
      statement: "这是仅用于隔离浏览器验收的学习社区成员申请。",
    },
  });
  expect(registered.status(), await registered.text()).toBe(200);
  testMember(email, "PENDING");
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录社区" }).click();
  await expect(page).toHaveURL(/\/account/);
  expect(
    (await page.request.get("/api/resources/nonexistent/questions?fileId=missing")).status(),
  ).toBe(403);
  testMember(email, "ACTIVE");
  await page.goto("/upload");
  const categoryId = await page
    .getByLabel("资料分类")
    .locator("option")
    .nth(1)
    .getAttribute("value");
  const published = await page.request.post("/api/resources", {
    headers: { origin },
    multipart: {
      title: `两页PDF按页提问验收 ${suffix}`,
      description: "这份真实两页 PDF 用于验证页码绑定和提问交互。",
      area: "MEMBER",
      categoryId: categoryId!,
      tagIds: "[]",
      file: { name: "两页.pdf", mimeType: "application/pdf", buffer: twoPagePdf() },
    },
  });
  expect(published.status(), await published.text()).toBe(201);
  const { id } = await published.json();
  await page.goto(`/resources/${id}`);
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.locator("canvas")).toHaveAttribute("data-rendered", "true");
  const questions = page.getByRole("region", { name: "PDF 按页提问" });
  await expect(questions.getByRole("button", { name: "发布第 1 页问题" })).toBeVisible();
  const fileId = await questions.locator('input[name="fileId"]').first().inputValue();
  const draft = questions.locator("form").first();
  const questionText = `第二页的公式如何理解 ${suffix}`;
  await draft.locator("textarea").fill(questionText);
  await draft
    .locator('input[type="file"]')
    .setInputFiles({ name: "公式.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByText("2 / 2 页", { exact: true })).toBeVisible();
  await expect(draft.locator("textarea")).toHaveValue(questionText);
  expect(
    await draft
      .locator('input[type="file"]')
      .evaluate((element: HTMLInputElement) => element.files?.length),
  ).toBe(1);
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/resources/${id}/questions`) &&
      response.request().method() === "POST",
  );
  await questions.getByRole("button", { name: "发布第 2 页问题" }).click();
  const questionResponse = await saved;
  expect(questionResponse.status(), await questionResponse.text()).toBe(201);
  const questionId = (await questionResponse.json()).id;
  const question = questions
    .locator(".discussion-item")
    .filter({ has: page.getByText(questionText, { exact: true }) });
  await expect(question).toBeVisible();
  await expect(question.locator("img")).toHaveJSProperty("naturalWidth", 1);
  await question.getByText("回复这个问题", { exact: true }).click();
  const reply = question.getByLabel("回复内容");
  await reply.fill("这一项来自上一行的约束条件。");
  const replyForm = question
    .locator("form")
    .filter({ has: page.getByLabel("回复内容", { exact: true }) });
  await replyForm
    .locator('input[type="file"]')
    .setInputFiles({ name: "回复.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(question).toBeHidden();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(reply).toHaveValue("这一项来自上一行的约束条件。");
  expect(
    await replyForm
      .locator('input[type="file"]')
      .evaluate((element: HTMLInputElement) => element.files?.length),
  ).toBe(1);
  await replyForm.getByRole("button", { name: "提交回复" }).click();
  await expect(question.getByText("这一项来自上一行的约束条件。", { exact: true })).toBeVisible();
  await question.getByRole("button", { name: "标记已解决" }).click();
  await expect(question.getByText("已解决", { exact: true })).toBeVisible();
  await question.getByRole("button", { name: "重新打开" }).click();
  await expect(question.getByText("待解决", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await questions.getByRole("button", { name: "全部问题", exact: true }).click();
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "跳到第 2 页" }).click();
  await expect(page.getByText("2 / 2 页", { exact: true })).toBeVisible();
  const invalid = await page.request.post(`/api/resources/${id}/questions`, {
    headers: { origin },
    multipart: {
      action: "ask",
      fileId,
      page: "3",
      body: "服务器不能接受伪造的总页数。",
      totalPages: "9999",
    },
  });
  expect(invalid.status()).toBe(400);
  expect(invalid.headers()["cache-control"]).toContain("no-store");
  expect(
    (
      await page.request.post(`/api/discussions/RESOURCE/${id}`, {
        headers: { origin },
        multipart: { parentId: questionId, body: "不能通过普通讨论入口绕过页码" },
      })
    ).status(),
  ).toBe(400);
  await draft.locator("textarea").fill("   ");
  await draft
    .locator('input[type="file"]')
    .setInputFiles({ name: "失败保留.png", mimeType: "image/png", buffer: png });
  await questions.getByRole("button", { name: "发布第 2 页问题" }).click();
  await expect(draft.getByRole("alert")).toContainText("请输入内容");
  await expect(draft.locator("textarea")).toHaveValue("   ");
  expect(
    await draft
      .locator('input[type="file"]')
      .evaluate((element: HTMLInputElement) => element.files?.length),
  ).toBe(1);
  await page.screenshot({ path: "data/e2e/pdf-questions.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/pdf-questions-mobile.png", fullPage: true });
  await page.screenshot({ path: "data/e2e/pdf-questions-mobile.png", fullPage: true });
  testMember(email, "SUSPENDED");
  expect((await page.request.get(`/api/resources/${id}/questions?fileId=${fileId}`)).status()).toBe(
    401,
  );
  const guest = await request.get(`/resources/${id}`);
  expect(await guest.text()).not.toContain(questionText);
});
