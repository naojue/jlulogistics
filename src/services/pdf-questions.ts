import { db } from "@/lib/db";
import { AppError, assertMember, assertOwner, type Actor } from "@/lib/policy";
import { commentSchema } from "@/lib/validation";
import type { UploadFile } from "@/lib/files";
import type { Prisma } from "@/generated/prisma/client";
import { stat } from "node:fs/promises";
import { storagePath } from "@/services/storage";
import { resourceFile, attachmentSelect, attachmentCreate, validateImages } from "@/services/media";
import { pdfPageCount } from "@/services/pdf-pages";

async function currentActor(actor: Actor | null) {
  assertMember(actor);
  const current = await db.user.findUnique({ where: { id: actor.id } });
  assertMember(current);
  return current;
}

async function anchor(actor: Actor | null, resourceId: string, fileId: string, page?: number) {
  const current = await currentActor(actor);
  if (!fileId) throw new AppError("请选择 PDF 文件");
  const file = await resourceFile(current, resourceId, fileId);
  if (file.mime !== "application/pdf") throw new AppError("按页提问仅支持 PDF");
  const pages = await pdfPageCount(file.key);
  if (page !== undefined && (!Number.isSafeInteger(page) || page < 1 || page > pages))
    throw new AppError(`PDF 页码无效，请选择 1–${pages} 页`);
  // Parsing can take seconds; account changes during validation must take effect immediately.
  const fresh = await currentActor(current);
  await resourceFile(fresh, resourceId, fileId);
  return { current: fresh, pages };
}

async function assertPdfBinding(tx: Prisma.TransactionClient, resourceId: string, fileId: string) {
  const resource = await tx.resource.findFirst({
    where: { id: resourceId, deletedAt: null },
    include: { file: true, attachments: { include: { file: true } } },
  });
  const file =
    resource &&
    (resource.fileId === fileId
      ? resource.file
      : resource.attachments.find((attachment) => attachment.fileId === fileId)?.file);
  if (!file || file.mime !== "application/pdf")
    throw new AppError("资料或 PDF 文件已不可访问", 404);
  const info = await stat(/* turbopackIgnore: true */ storagePath(file.key)).catch(() => {
    throw new AppError("资料或 PDF 文件已不可访问", 404);
  });
  if (!info.isFile()) throw new AppError("资料或 PDF 文件已不可访问", 404);
}

const questionSelect = {
  id: true,
  body: true,
  parentId: true,
  authorId: true,
  author: { select: { name: true } },
  createdAt: true,
  pdfFileId: true,
  pdfPage: true,
  resolvedAt: true,
  attachments: { select: attachmentSelect, orderBy: { position: "asc" } },
} as const;

export async function pdfQuestions(
  actor: Actor | null,
  resourceId: string,
  fileId: string,
  page?: number,
) {
  const { current, pages } = await anchor(actor, resourceId, fileId, page);
  const items = await db.resourceComment.findMany({
    where: {
      resourceId,
      pdfFileId: fileId,
      ...(page === undefined ? {} : { pdfPage: page }),
      deletedAt: null,
      OR: [{ parentId: null }, { parent: { deletedAt: null, pdfFileId: fileId } }],
    },
    select: questionSelect,
    orderBy: { createdAt: "asc" },
  });
  return {
    items,
    pages,
    userId: current.id,
    admin: ["ADMIN", "SUPER_ADMIN"].includes(current.role),
  };
}

export async function askPdfQuestion(
  actor: Actor | null,
  resourceId: string,
  fileId: string,
  page: number,
  text: string,
  files: UploadFile[] = [],
) {
  await anchor(actor, resourceId, fileId, page);
  const body = commentSchema.parse(text);
  validateImages(files);
  return db.$transaction(async (tx) => {
    const current = actor && (await tx.user.findUnique({ where: { id: actor.id } }));
    assertMember(current);
    await assertPdfBinding(tx, resourceId, fileId);
    return tx.resourceComment.create({
      data: {
        resourceId,
        authorId: current.id,
        pdfFileId: fileId,
        pdfPage: page,
        body,
        attachments: { create: attachmentCreate(files) },
      },
    });
  });
}

export async function replyPdfQuestion(
  actor: Actor | null,
  resourceId: string,
  fileId: string,
  questionId: string,
  text: string,
  files: UploadFile[] = [],
) {
  await anchor(actor, resourceId, fileId);
  const body = commentSchema.parse(text);
  validateImages(files);
  return db.$transaction(async (tx) => {
    const current = actor && (await tx.user.findUnique({ where: { id: actor.id } }));
    assertMember(current);
    await assertPdfBinding(tx, resourceId, fileId);
    const parent = await tx.resourceComment.findFirst({
      where: {
        id: questionId,
        resourceId,
        pdfFileId: fileId,
        parentId: null,
        deletedAt: null,
        resource: { deletedAt: null },
      },
    });
    if (!parent || parent.pdfPage === null)
      throw new AppError("问题不存在或已被删除，只支持两层回复", 404);
    return tx.resourceComment.create({
      data: {
        resourceId,
        authorId: current.id,
        parentId: parent.id,
        pdfFileId: parent.pdfFileId,
        pdfPage: parent.pdfPage,
        body,
        attachments: { create: attachmentCreate(files) },
      },
    });
  });
}

export async function setPdfQuestionResolved(
  actor: Actor | null,
  resourceId: string,
  fileId: string,
  questionId: string,
  resolved: boolean,
) {
  await anchor(actor, resourceId, fileId);
  return db.$transaction(async (tx) => {
    const current = actor && (await tx.user.findUnique({ where: { id: actor.id } }));
    assertMember(current);
    await assertPdfBinding(tx, resourceId, fileId);
    const question = await tx.resourceComment.findFirst({
      where: {
        id: questionId,
        resourceId,
        pdfFileId: fileId,
        parentId: null,
        deletedAt: null,
        resource: { deletedAt: null },
      },
    });
    if (!question || question.pdfPage === null) throw new AppError("问题不存在", 404);
    assertOwner(current, question.authorId);
    const updated = await tx.resourceComment.update({
      where: { id: question.id },
      data: { resolvedAt: resolved ? new Date() : null },
    });
    if (["ADMIN", "SUPER_ADMIN"].includes(current.role))
      await tx.auditLog.create({
        data: {
          actorId: current.id,
          action: resolved ? "RESOLVE_PDF_QUESTION" : "REOPEN_PDF_QUESTION",
          targetId: question.id,
        },
      });
    return updated;
  });
}

export async function removePdfQuestion(
  actor: Actor | null,
  resourceId: string,
  fileId: string,
  commentId: string,
  reason: string,
) {
  const { current } = await anchor(actor, resourceId, fileId);
  const item = await db.resourceComment.findFirst({
    where: {
      id: commentId,
      resourceId,
      pdfFileId: fileId,
      deletedAt: null,
      OR: [{ parentId: null }, { parent: { deletedAt: null, pdfFileId: fileId } }],
    },
  });
  if (!item) throw new AppError("问题或回复不存在", 404);
  if (reason.length > 500) throw new AppError("删除原因最多 500 个字");
  const { removeDiscussion } = await import("@/services/discussions");
  await removeDiscussion(current, "COMMENT", item.id, reason);
}
