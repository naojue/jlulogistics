import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=",
  "base64",
);
function pdfFixture() {
  const content = "BT /F1 24 Tf 70 720 Td (Study preview works) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let value = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(value.length);
    value += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = value.length;
  value += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, "0") + " 00000 n ")
    .join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(value);
}
const origin = "http://127.0.0.1:3100";
const password = "MemberExample123!";
async function register(api: APIRequestContext, email: string, invite?: string) {
  const response = await api.post("/api/account/register", {
    headers: { origin },
    data: {
      email,
      password,
      name: "学习伙伴",
      statement: "我是学习小组的成员，希望分享资料并参与讨论。",
      invite,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
}
async function emailLink(api: APIRequestContext, email: string, subject: string) {
  let link = "";
  await expect
    .poll(
      async () => {
        const list = await api.get("http://127.0.0.1:8025/api/v1/search", {
          params: { query: `to:${email}`, limit: 50 },
        });
        const data = await list.json();
        const message = data.messages?.find((item: { Subject: string }) =>
          item.Subject.includes(subject),
        );
        if (!message) return false;
        const detail = await api.get(`http://127.0.0.1:8025/api/v1/message/${message.ID}`);
        const content = await detail.json();
        link = content.Text?.match(/https?:\/\/[^\s]+/)?.[0] || "";
        return !!link;
      },
      { timeout: 20000, intervals: [250, 500, 1000] },
    )
    .toBe(true);
  return link;
}
async function login(page: Page, email: string, pass = password) {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(pass);
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/sign-in/email"),
  );
  await page.getByRole("button", { name: "登录社区" }).click();
  const response = await responsePromise;
  expect(response.status(), response.ok() ? "" : await response.text()).toBe(200);
  await expect(page).toHaveURL(/\/account/);
}

test("公开资料页、访客权限与手机布局", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "发现好资料，让学习更进一步" })).toBeVisible();
  expect((await request.get("/api/resources/nonexistent/download")).status()).toBe(401);
  expect((await request.get("/api/resources/nonexistent/preview")).status()).toBe(401);
  expect((await request.get("/api/attachments/nonexistent")).status()).toBe(401);
  expect((await request.get("/api/discussions/POST/nonexistent")).status()).toBe(401);
  await page.screenshot({ path: "test-results/home-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "发现好资料，让学习更进一步" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/home-mobile.png", fullPage: true });
});

test("注册页面与登录失败的中文反馈、输入保留", async ({ page, request }) => {
  const email = `ui-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录社区" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("邮箱或密码不正确");
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue(email);
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue(password);
  await page.goto("/register");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("昵称", { exact: true }).fill("页面注册成员");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("申请说明").fill("我是学习小组成员，希望一起学习并分享课程资料。");
  await page.getByRole("button", { name: "提交注册申请" }).click();
  await expect(
    page.getByText("注册申请已提交，请先打开邮件验证邮箱。验证后登录查看申请状态。"),
  ).toBeVisible();
  await page.goto(await emailLink(request, email, "验证"));
  await login(page, email);
  await expect(page.getByText("邮箱已验证，正在等待管理员审批")).toBeVisible();
});

test("注册验证、首次改密、审批、上传下载、内部讨论、邀请和找回密码", async ({
  browser,
  request,
}) => {
  test.setTimeout(300000);
  const suffix = Date.now();
  const email = `member-${suffix}@example.test`;
  const invitedEmail = `invited-${suffix}@example.test`;
  const adminContext = await browser.newContext({ baseURL: origin });
  const memberContext = await browser.newContext({ baseURL: origin });
  const guestContext = await browser.newContext({ baseURL: origin });
  const invitedContext = await browser.newContext({ baseURL: origin });
  const admin = await adminContext.newPage();
  const member = await memberContext.newPage();
  const invited = await invitedContext.newPage();
  try {
    await login(admin, "admin-e2e@example.test", "InitialAdminTest123!");
    await expect(admin.getByRole("heading", { name: "请修改初始密码" })).toBeVisible();
    expect(
      (
        await adminContext.request.post("/api/resources", {
          headers: { origin },
          multipart: {
            file: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
          },
        })
      ).status(),
    ).toBe(403);
    await admin.getByLabel("当前密码").fill("InitialAdminTest123!");
    await admin.getByLabel("新密码").fill("ChangedAdminTest123!");
    await admin.getByRole("button", { name: "修改密码" }).click();
    await expect(admin.getByRole("heading", { name: "你好，社区管理员" })).toBeVisible();
    await register(request, email);
    await member.goto(await emailLink(request, email, "验证"));
    await login(member, email);
    await expect(member.getByText("邮箱已验证，正在等待管理员审批")).toBeVisible();
    expect((await memberContext.request.get("/api/resources/nonexistent/download")).status()).toBe(
      403,
    );
    expect((await memberContext.request.get("/api/resources/nonexistent/preview")).status()).toBe(
      403,
    );
    await admin.goto(`/admin/members?q=${encodeURIComponent(email)}`);
    let row = admin.getByRole("row").filter({ hasText: email });
    await row.getByRole("button", { name: "通过审批" }).click();
    await expect(row.getByText("已激活", { exact: true })).toBeVisible();
    await member.reload();
    await expect(member.getByText("账号已激活，欢迎继续分享与交流")).toBeVisible();
    await member.goto("/upload");
    const categoryId = await member
      .getByLabel("资料分类")
      .locator("option")
      .nth(1)
      .getAttribute("value");
    const forged = await memberContext.request.post("/api/resources", {
      headers: { origin },
      multipart: {
        title: "越权资料测试",
        description: "这是验证上传权限的一份学习资料。",
        area: "ADMIN",
        categoryId: categoryId!,
        tagIds: "[]",
        file: { name: "test.txt", mimeType: "text/plain", buffer: Buffer.from("study") },
      },
    });
    expect(forged.status()).toBe(403);
    const illegal = await memberContext.request.post("/api/resources", {
      headers: { origin },
      multipart: {
        title: "非法资料测试",
        description: "这是验证文件类型的一份学习资料。",
        area: "MEMBER",
        categoryId: categoryId!,
        tagIds: "[]",
        file: { name: "test.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") },
      },
    });
    expect(illegal.status()).toBe(400);
    await member.getByLabel("资料标题").fill("浏览器验收学习笔记");
    await member
      .getByLabel("资料简介")
      .fill("这是端到端测试上传的真实学习笔记，用于验证公开浏览与成员下载。");
    await member.getByLabel("资料分类").selectOption(categoryId!);
    await member.locator("input[type=file]").setInputFiles({
      name: "学习笔记.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("学习笔记：每天总结和复习。"),
    });
    await member.getByRole("button", { name: "发布资料" }).click();
    await expect(member).toHaveURL(/\/resources\/[^/]+$/);
    const resourceId = member.url().split("/").at(-1)!;
    const downloadEvent = member.waitForEvent("download");
    await member.getByRole("link", { name: "下载资料", exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("学习笔记.txt");
    expect(await readFile((await download.path())!, "utf8")).toContain("每天总结");
    await member.getByLabel("分享你的想法").fill("只对社区成员可见的资料评论");
    await member.getByRole("button", { name: "发布留言" }).click();
    await expect(member.getByText("只对社区成员可见的资料评论", { exact: true })).toBeVisible();
    const publicDetail = await guestContext.request.get(`/resources/${resourceId}`);
    expect(await publicDetail.text()).not.toContain("只对社区成员可见的资料评论");
    expect((await guestContext.request.get(`/api/resources/${resourceId}/download`)).status()).toBe(
      401,
    );
    await member.screenshot({ path: "test-results/resource-detail.png", fullPage: true });
    await member.getByRole("button", { name: "预览", exact: true }).click();
    await expect(member.locator(".content-preview pre")).toContainText("每天总结");
    const textPreview = await memberContext.request.get(`/api/resources/${resourceId}/preview`);
    expect(textPreview.headers()["cache-control"]).toContain("no-store");
    expect((await guestContext.request.get(`/api/resources/${resourceId}/preview`)).status()).toBe(
      401,
    );
    await member.goto("/upload");
    await member.getByLabel("资料标题").fill("多张图片学习资料");
    await member
      .getByLabel("资料简介")
      .fill("一组学习照片，检查多图上传以及权限一致的预览和下载。");
    await member.getByLabel("资料分类").selectOption(categoryId!);
    await member
      .locator("input[type=file]")
      .setInputFiles(
        ["first.png", "second.png"].map((name) => ({ name, mimeType: "image/png", buffer: png })),
      );
    await member.getByRole("button", { name: "发布资料" }).click();
    await expect(member).toHaveURL(/\/resources\/[^/]+$/);
    const galleryId = member.url().split("/").at(-1)!;
    await expect(member.getByRole("link", { name: "下载图片" })).toHaveCount(2);
    await member.getByRole("button", { name: "预览", exact: true }).nth(1).click();
    await expect(member.locator(".resource-image")).toBeVisible();
    await expect
      .poll(() =>
        member
          .locator(".resource-image")
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    const secondUrl = await member
      .getByRole("link", { name: "下载图片" })
      .nth(1)
      .getAttribute("href");
    expect((await memberContext.request.get(secondUrl!)).status()).toBe(200);
    expect((await guestContext.request.get(secondUrl!)).status()).toBe(401);
    const firstPage = await guestContext.request.get(`/resources/${galleryId}`);
    expect(await firstPage.text()).not.toContain("/preview?");
    await member.setViewportSize({ width: 390, height: 844 });
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await member.screenshot({ path: "test-results/multi-image-mobile.png", fullPage: true });
    await member.setViewportSize({ width: 1440, height: 1000 });
    const examples: { ext: string; archive: Record<string, Uint8Array>; expected: string }[] = [
      {
        ext: "docx",
        archive: {
          "word/document.xml": strToU8(
            '<w:document xmlns:w="word"><w:body><w:p><w:r><w:t>Word正文预览成功</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Word表格</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
          ),
        },
        expected: "Word正文预览成功",
      },
      {
        ext: "pptx",
        archive: {
          "ppt/slides/slide1.xml": strToU8(
            '<p:sld xmlns:p="presentation" xmlns:a="drawing"><a:p><a:r><a:t>幻灯片文字预览成功</a:t></a:r></a:p></p:sld>',
          ),
        },
        expected: "幻灯片文字预览成功",
      },
      {
        ext: "xlsx",
        archive: {
          "xl/worksheets/sheet1.xml": strToU8(
            '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>工作表预览成功</t></is></c><c r="C1"><v>42</v></c></row></sheetData></worksheet>',
          ),
        },
        expected: "工作表预览成功",
      },
      { ext: "zip", archive: { "目录/笔记.txt": strToU8("学习内容") }, expected: "目录/笔记.txt" },
    ];
    for (const example of examples) {
      const result = await memberContext.request.post("/api/resources", {
        headers: { origin },
        multipart: {
          title: `内容预览-${example.ext}`,
          description: "学习资料内容预览的浏览器验收。",
          area: "MEMBER",
          categoryId: categoryId!,
          tagIds: "[]",
          file: {
            name: `preview.${example.ext}`,
            mimeType: "application/octet-stream",
            buffer: Buffer.from(zipSync(example.archive)),
          },
        },
      });
      expect(result.status(), await result.text()).toBe(201);
      await member.goto(`/resources/${(await result.json()).id}`);
      await member.getByRole("button", { name: "预览", exact: true }).click();
      await expect(member.locator(".content-preview")).toContainText(example.expected);
      if (example.ext === "docx")
        await expect(member.locator(".preview-table")).toContainText("Word表格");
      if (example.ext === "xlsx") await expect(member.locator(".preview-table td")).toHaveCount(3);
    }
    const pdfUpload = await memberContext.request.post("/api/resources", {
      headers: { origin },
      multipart: {
        title: "PDF预览验收",
        description: "浏览器内 PDF 文件阅读和权限验证。",
        area: "MEMBER",
        categoryId: categoryId!,
        tagIds: "[]",
        file: { name: "preview.pdf", mimeType: "application/pdf", buffer: pdfFixture() },
      },
    });
    expect(pdfUpload.status(), await pdfUpload.text()).toBe(201);
    const pdfId = (await pdfUpload.json()).id;
    await member.goto(`/resources/${pdfId}`);
    const pdfResponse = member.waitForResponse((response) =>
      response.url().endsWith(`/api/resources/${pdfId}/preview`),
    );
    await member.getByRole("button", { name: "预览", exact: true }).click();
    const loadedPdf = await pdfResponse;
    expect(loadedPdf.status()).toBe(200);
    expect(loadedPdf.headers()["content-type"]).toBe("application/pdf");
    expect(loadedPdf.headers()["x-frame-options"]).toBe("SAMEORIGIN");
    await expect(member.locator('.pdf-reader canvas[data-rendered="true"]')).toBeVisible();
    await member.getByText("本页文字", { exact: true }).click();
    await expect(member.locator(".pdf-reader")).toContainText("Study preview works");
    await member.screenshot({ path: "test-results/pdf-preview.png", fullPage: true });
    await member.goto("/forum/new");
    await member.getByLabel("帖子标题").fill("怎样安排每天的复习");
    await member.getByLabel("讨论分类").selectOption({ label: "学习方法" });
    await member
      .getByLabel("正文", { exact: true })
      .fill("大家如何安排每天的复习时间？想听听各位的经验。");
    await member
      .locator("input[type=file]")
      .setInputFiles({ name: "post.png", mimeType: "image/png", buffer: png });
    await member.getByRole("button", { name: "发布帖子" }).click();
    await expect(member).toHaveURL(/\/forum\/(?!new$)[^/]+$/);
    const postId = member.url().split("/").at(-1)!;
    const postImage = member.locator("article .image-thumbnail img");
    await expect(postImage).toBeVisible();
    const postImageUrl = await postImage.getAttribute("src");
    expect((await guestContext.request.get(postImageUrl!)).status()).toBe(401);
    await member.getByLabel("分享你的想法").fill("每天留出三十分钟回顾当天内容。");
    await member
      .locator("input[type=file]")
      .setInputFiles({ name: "reply.png", mimeType: "image/png", buffer: png });
    await member.getByRole("button", { name: "发布留言" }).click();
    await expect(member.getByText("每天留出三十分钟回顾当天内容。", { exact: true })).toBeVisible();
    await expect(member.locator(".discussion-item .image-thumbnail img")).toBeVisible();
    await member.goto(`/forum/${postId}/edit`);
    await member.getByLabel("删除 post.png").check();
    await member.getByRole("button", { name: "保存修改" }).click();
    await expect(member).toHaveURL(new RegExp(`/forum/${postId}$`));
    expect((await memberContext.request.get(postImageUrl!)).status()).toBe(404);
    expect((await guestContext.request.get(`/api/discussions/POST/${postId}`)).status()).toBe(401);
    await admin.goto("/admin/administrators");
    const invitationPanel = admin
      .locator("section")
      .filter({ has: admin.getByRole("heading", { name: "生成管理员邀请码" }) });
    await invitationPanel.getByLabel("绑定邮箱").fill(invitedEmail);
    await invitationPanel.getByRole("button", { name: "生成邀请码与链接" }).click();
    const token = await invitationPanel.getByLabel("邀请码（仅本次显示）").inputValue();
    expect(token).toHaveLength(48);
    await register(request, invitedEmail, token);
    await invited.goto(await emailLink(request, invitedEmail, "验证"));
    await login(invited, invitedEmail);
    await expect(invited.getByText("当前身份：管理员", { exact: true })).toBeVisible();
    await invited.goto("/admin/administrators");
    await expect(invited).toHaveURL(/\/account/);
    const reused = await request.post("/api/account/register", {
      headers: { origin },
      data: {
        email: invitedEmail,
        password,
        name: "重复兑换",
        statement: "使用已经兑换过的邀请码重新注册管理员",
        invite: token,
      },
    });
    expect(reused.status()).toBe(400);
    await member.goto("/forgot-password");
    await member.getByLabel("邮箱", { exact: true }).fill(email);
    await member.getByRole("button", { name: "发送重置邮件" }).click();
    await expect(
      member.getByText("如果该邮箱已注册，你将收到重置密码邮件。请检查收件箱。"),
    ).toBeVisible();
    await member.goto(await emailLink(request, email, "重置"));
    await member.getByLabel("新密码").fill("NewMemberPassword123!");
    await member.getByRole("button", { name: "设置新密码" }).click();
    await expect(member.getByText("密码已重置，请重新登录。")).toBeVisible();
    await login(member, email, "NewMemberPassword123!");
    await member.goto(`/resources/${resourceId}`);
    await member.getByText("删除这份资料", { exact: true }).click();
    await member.getByRole("button", { name: "确认删除资料" }).click();
    await expect(member.getByRole("heading", { name: "这页内容已经不在这里了" })).toBeVisible();
    expect(
      (await memberContext.request.get(`/api/resources/${resourceId}/download`)).status(),
    ).toBe(404);
    expect((await memberContext.request.get(`/api/resources/${resourceId}/preview`)).status()).toBe(
      404,
    );
    await admin.goto(`/admin/members?q=${encodeURIComponent(email)}`);
    row = admin.getByRole("row").filter({ hasText: email });
    await row.getByPlaceholder("停用原因").fill("账号停用验收测试");
    await row.getByRole("button", { name: "停用成员" }).click();
    await expect(row.getByText("已停用", { exact: true })).toBeVisible();
    expect((await memberContext.request.get(`/api/discussions/POST/${postId}`)).status()).toBe(401);
    await member.goto("/account");
    await expect(member).toHaveURL(/\/login/);
    await admin.goto("/admin/logs");
    await expect(
      admin
        .getByText("管理员邀请激活")
        .or(admin.getByText("激活管理员", { exact: true }))
        .first(),
    ).toBeVisible();
    await admin.screenshot({ path: "test-results/admin-logs.png", fullPage: true });
  } finally {
    await Promise.all([
      adminContext.close(),
      memberContext.close(),
      guestContext.close(),
      invitedContext.close(),
    ]);
  }
});
