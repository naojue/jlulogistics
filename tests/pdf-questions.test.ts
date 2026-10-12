import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { db } from "../src/lib/db";
import { storagePath } from "../src/services/storage";
import { pdfPageCount } from "../src/services/pdf-pages";
import {
  askPdfQuestion,
  pdfQuestions,
  replyPdfQuestion,
  setPdfQuestionResolved,
} from "../src/services/pdf-questions";
import {
  addDiscussion,
  discussionItems,
  removeDiscussion,
  publishPost,
} from "../src/services/discussions";
import { attachmentFile } from "../src/services/media";

const storedKeys: string[] = [];
async function actor(role = "MEMBER") {
  return db.user.create({
    data: {
      id: randomUUID(),
      email: `${randomUUID()}@example.test`,
      name: "PDF 学习成员",
      role,
      status: "ACTIVE",
      emailVerified: true,
    },
  });
}
function fixturePdf() {
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
async function resource(
  user: Awaited<ReturnType<typeof actor>>,
  mime = "application/pdf",
  bytes = fixturePdf(),
) {
  const key = randomUUID();
  storedKeys.push(key);
  await mkdir(process.env.STORAGE_DIR!, { recursive: true });
  await writeFile(storagePath(key), bytes);
  const category = await db.category.create({ data: { name: randomUUID(), kind: "RESOURCE" } });
  return db.resource.create({
    data: {
      title: "按页提问课程讲义",
      description: "用于测试 PDF 按页问题、成员权限和页码绑定。",
      area: "MEMBER",
      author: { connect: { id: user.id } },
      category: { connect: { id: category.id } },
      file: {
        create: {
          key,
          name: mime === "application/pdf" ? "两页讲义.pdf" : "说明.txt",
          mime,
          size: bytes.length,
        },
      },
    },
    include: { file: true },
  });
}
afterAll(async () => {
  await Promise.all(storedKeys.map((key) => unlink(storagePath(key)).catch(() => undefined)));
});

it("真实 PDF 页数校验拒绝伪造页码、非 PDF 和其他资料文件", async () => {
  const member = await actor();
  const pdf = await resource(member);
  const other = await resource(member);
  const text = await resource(member, "text/plain", Buffer.from("some plain text"));
  expect(await pdfPageCount(pdf.file.key)).toBe(2);
  for (const page of [0, -1, 3, 1.5, Number.NaN, Infinity])
    await expect(
      askPdfQuestion(member, pdf.id, pdf.fileId, page, "这里的公式应该如何理解？"),
    ).rejects.toThrow("页码");
  await expect(askPdfQuestion(member, pdf.id, other.fileId, 1, "错误的文件关联")).rejects.toThrow(
    "不属于",
  );
  await expect(
    askPdfQuestion(member, text.id, text.fileId, 1, "不能向 TXT 按页提问"),
  ).rejects.toThrow("PDF");
  const corrupt = await resource(
    member,
    "application/pdf",
    Buffer.from("%PDF-1.7\nnot a PDF document"),
  );
  await expect(
    askPdfQuestion(member, corrupt.id, corrupt.fileId, 1, "损坏 PDF 不应发布问题"),
  ).rejects.toThrow("无法验证");
});

it("访客和所有非可用成员状态不能查看或创建按页问题，服务重新读取账号状态", async () => {
  const member = await actor();
  const pdf = await resource(member);
  await expect(pdfQuestions(null, pdf.id, pdf.fileId)).rejects.toThrow("登录");
  for (const change of [
    { status: "PENDING" },
    { status: "REJECTED" },
    { status: "SUSPENDED" },
    { status: "ACTIVE", emailVerified: false },
    { status: "ACTIVE", emailVerified: true, mustChangePassword: true },
  ]) {
    await db.user.update({
      where: { id: member.id },
      data: { emailVerified: true, mustChangePassword: false, ...change },
    });
    await expect(pdfQuestions(member, pdf.id, pdf.fileId)).rejects.toThrow();
    await expect(
      askPdfQuestion(member, pdf.id, pdf.fileId, 1, "不能使用旧状态绕过权限"),
    ).rejects.toThrow();
  }
});

it("问题及图片两层回复继承页码，普通留言入口不能绕过锚点", async () => {
  const member = await actor();
  const other = await actor();
  const pdf = await resource(member);
  const picture = { key: randomUUID(), name: "推导.png", mime: "image/png", size: 10 };
  const question = await askPdfQuestion(
    member,
    pdf.id,
    pdf.fileId,
    2,
    "第二页推导的这一项从哪里来？",
    [picture],
  );
  const reply = await replyPdfQuestion(
    other,
    pdf.id,
    pdf.fileId,
    question.id,
    "这一项来自上一行的约束条件。",
    [{ ...picture, key: randomUUID() }],
  );
  expect(reply.pdfFileId).toBe(pdf.fileId);
  expect(reply.pdfPage).toBe(2);
  expect(await discussionItems(member, "RESOURCE", pdf.id)).toEqual([]);
  await expect(
    addDiscussion(member, "RESOURCE", pdf.id, "不能从普通讨论入口添加回复", question.id),
  ).rejects.toThrow("回复目标");
  await expect(
    replyPdfQuestion(member, pdf.id, pdf.fileId, reply.id, "不支持第三层回复"),
  ).rejects.toThrow("两层");
  const items = await pdfQuestions(member, pdf.id, pdf.fileId);
  expect(items.items).toHaveLength(2);
  const serialized = JSON.stringify(items);
  expect(serialized).not.toContain("@example.test");
  expect(serialized).not.toContain(picture.key);
  const otherPdf = await resource(member);
  expect((await pdfQuestions(member, otherPdf.id, otherPdf.fileId)).items).toEqual([]);
  await expect(
    replyPdfQuestion(member, otherPdf.id, otherPdf.fileId, question.id, "不能跨文件回复"),
  ).rejects.toThrow("不存在");
});

it("只有提问者或当前管理员能解决和重开，管理员操作留痕", async () => {
  const member = await actor();
  const other = await actor();
  const admin = await actor("ADMIN");
  const pdf = await resource(member);
  const question = await askPdfQuestion(member, pdf.id, pdf.fileId, 1, "第一页的图有什么含义？");
  await expect(
    setPdfQuestionResolved(other, pdf.id, pdf.fileId, question.id, true),
  ).rejects.toThrow("自己的");
  expect(
    (await setPdfQuestionResolved(member, pdf.id, pdf.fileId, question.id, true)).resolvedAt,
  ).not.toBeNull();
  expect(
    (await setPdfQuestionResolved(admin, pdf.id, pdf.fileId, question.id, false)).resolvedAt,
  ).toBeNull();
  expect(
    await db.auditLog.count({ where: { targetId: question.id, action: "REOPEN_PDF_QUESTION" } }),
  ).toBe(1);
  await db.user.update({ where: { id: admin.id }, data: { role: "MEMBER" } });
  await expect(
    setPdfQuestionResolved(admin, pdf.id, pdf.fileId, question.id, true),
  ).rejects.toThrow("自己的");
});

it("普通内容删除也使用事务中的最新账号状态和角色", async () => {
  const member = await actor();
  const admin = await actor("ADMIN");
  const category = await db.category.create({ data: { name: randomUUID(), kind: "POST" } });
  const post = await publishPost(member, {
    title: "删除权限更新测试",
    body: "这个帖子用于验证停用或管理员降级之后，旧角色对象不能继续删除内容。",
    categoryId: category.id,
  });
  await db.user.update({ where: { id: admin.id }, data: { role: "MEMBER" } });
  await expect(removeDiscussion(admin, "POST", post.id, "管理删除")).rejects.toThrow("自己的");
  await db.user.update({ where: { id: member.id }, data: { status: "SUSPENDED" } });
  await expect(removeDiscussion(member, "POST", post.id, "")).rejects.toThrow("停用");
  expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).deletedAt).toBeNull();
});

it("删除问题、资料或底层 PDF 后，问题及图片旧入口同时失效", async () => {
  const member = await actor();
  const other = await actor();
  const pdf = await resource(member);
  const question = await askPdfQuestion(member, pdf.id, pdf.fileId, 1, "这个定义是否有其他表达？");
  const reply = await replyPdfQuestion(
    other,
    pdf.id,
    pdf.fileId,
    question.id,
    "这里给出另一种解释。",
    [{ key: randomUUID(), name: "说明.png", mime: "image/png", size: 10 }],
  );
  const attachment = await db.attachment.findFirstOrThrow({ where: { commentId: reply.id } });
  expect((await attachmentFile(member, attachment.id)).name).toBe("说明.png");
  await expect(removeDiscussion(other, "COMMENT", question.id, "")).rejects.toThrow("自己的");
  await removeDiscussion(member, "COMMENT", question.id, "");
  expect((await pdfQuestions(member, pdf.id, pdf.fileId)).items).toEqual([]);
  await expect(attachmentFile(member, attachment.id)).rejects.toThrow("删除");
  await expect(
    replyPdfQuestion(member, pdf.id, pdf.fileId, question.id, "已删除问题不可回复"),
  ).rejects.toThrow("不存在");
  const fresh = await askPdfQuestion(member, pdf.id, pdf.fileId, 2, "新的问题附有图片。", [
    { key: randomUUID(), name: "新图.png", mime: "image/png", size: 10 },
  ]);
  const freshImage = await db.attachment.findFirstOrThrow({ where: { commentId: fresh.id } });
  await unlink(storagePath(pdf.file.key));
  await expect(pdfQuestions(member, pdf.id, pdf.fileId)).rejects.toThrow("不存在");
  await expect(attachmentFile(member, freshImage.id)).rejects.toThrow("不可访问");
  const deleted = await resource(member);
  await askPdfQuestion(member, deleted.id, deleted.fileId, 1, "资料删除后也应隐藏的问题。");
  await db.resource.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
  await expect(pdfQuestions(member, deleted.id, deleted.fileId)).rejects.toThrow("删除");
});
