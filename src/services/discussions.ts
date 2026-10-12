import { db } from "@/lib/db";
import { AppError, assertMember, assertOwner, type Actor } from "@/lib/policy";
import { postSchema, commentSchema } from "@/lib/validation";
import { type UploadFile } from "@/lib/files";
import { attachmentCreate, attachmentSelect, validateImages } from "@/services/media";
import { stat } from "node:fs/promises";
import { storagePath } from "@/services/storage";
export async function publishPost(actor: Actor, input: unknown, files: UploadFile[] = []) {
  assertMember(actor);
  const data = postSchema.parse(input);
  const category = await db.category.findUnique({ where: { id: data.categoryId } });
  if (!category || category.kind !== "POST") throw new AppError("讨论分类无效");
  validateImages(files);
  return db.post.create({
    data: { ...data, authorId: actor.id, attachments: { create: attachmentCreate(files) } },
  });
}
export async function updatePost(
  actor: Actor,
  id: string,
  input: unknown,
  files: UploadFile[] = [],
  removeIds: string[] = [],
) {
  const post = await db.post.findFirst({ where: { id, deletedAt: null } });
  if (!post) throw new AppError("帖子不存在", 404);
  assertOwner(actor, post.authorId);
  const data = postSchema.parse(input);
  const category = await db.category.findUnique({ where: { id: data.categoryId } });
  if (!category || category.kind !== "POST") throw new AppError("讨论分类无效");
  return db.$transaction(async (tx) => {
    const existing = await tx.attachment.findMany({
      where: { postId: id },
      include: { file: true },
    });
    if (removeIds.some((id) => !existing.some((item) => item.id === id)))
      throw new AppError("图片不属于这篇帖子");
    validateImages(
      files,
      existing.filter((item) => !removeIds.includes(item.id)),
    );
    await tx.attachment.deleteMany({ where: { postId: id, id: { in: removeIds } } });
    const nextPosition = existing.length
      ? Math.max(...existing.map((item) => item.position)) + 1
      : 0;
    await tx.post.update({
      where: { id },
      data: {
        ...data,
        attachments: {
          create: attachmentCreate(files).map((item) => ({
            ...item,
            position: item.position + nextPosition,
          })),
        },
      },
    });
    if (actor.id !== post.authorId)
      await tx.auditLog.create({ data: { actorId: actor.id, action: "EDIT_POST", targetId: id } });
  });
}
export async function addDiscussion(
  actor: Actor,
  kind: "RESOURCE" | "POST",
  id: string,
  text: string,
  parentId?: string,
  files: UploadFile[] = [],
) {
  assertMember(actor);
  const body = commentSchema.parse(text);
  validateImages(files);
  return db.$transaction(async (tx) => {
    if (kind === "RESOURCE") {
      const resource = await tx.resource.findFirst({ where: { id, deletedAt: null } });
      if (!resource) throw new AppError("资料不存在", 404);
      if (parentId) {
        const parent = await tx.resourceComment.findFirst({
          where: { id: parentId, resourceId: id, parentId: null, deletedAt: null, pdfFileId: null },
        });
        if (!parent) throw new AppError("回复目标无效，只支持两层回复");
      }
      return tx.resourceComment.create({
        data: {
          resourceId: id,
          authorId: actor.id,
          body,
          parentId: parentId || null,
          attachments: { create: attachmentCreate(files) },
        },
      });
    }
    const post = await tx.post.findFirst({ where: { id, deletedAt: null } });
    if (!post) throw new AppError("帖子不存在", 404);
    if (parentId) {
      const parent = await tx.postReply.findFirst({
        where: { id: parentId, postId: id, parentId: null, deletedAt: null },
      });
      if (!parent) throw new AppError("回复目标无效，只支持两层回复");
    }
    return tx.postReply.create({
      data: {
        postId: id,
        authorId: actor.id,
        body,
        parentId: parentId || null,
        attachments: { create: attachmentCreate(files) },
      },
    });
  });
}
export async function removeDiscussion(
  actor: Actor,
  kind: "POST" | "COMMENT" | "REPLY",
  id: string,
  reason: string,
) {
  return db.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: actor.id } });
    assertMember(current);
    const item =
      kind === "POST"
        ? await tx.post.findUnique({ where: { id } })
        : kind === "COMMENT"
          ? await tx.resourceComment.findUnique({ where: { id } })
          : await tx.postReply.findUnique({ where: { id } });
    if (!item || item.deletedAt) throw new AppError("内容不存在", 404);
    if (kind === "COMMENT" && "pdfFileId" in item && item.pdfFileId) {
      const resource = await tx.resource.findFirst({
        where: { id: item.resourceId, deletedAt: null },
        include: { file: true, attachments: { include: { file: true } } },
      });
      const pdf =
        resource &&
        (resource.fileId === item.pdfFileId
          ? resource.file
          : resource.attachments.find((attachment) => attachment.fileId === item.pdfFileId)?.file);
      const parent =
        item.parentId && (await tx.resourceComment.findUnique({ where: { id: item.parentId } }));
      if (!pdf || pdf.mime !== "application/pdf" || (parent && parent.deletedAt))
        throw new AppError("问题或所属 PDF 已不可访问", 404);
      const stored = await stat(/* turbopackIgnore: true */ storagePath(pdf.key)).catch(() => {
        throw new AppError("问题或所属 PDF 已不可访问", 404);
      });
      if (!stored.isFile()) throw new AppError("问题或所属 PDF 已不可访问", 404);
    }
    assertOwner(current, item.authorId);
    if (current.id !== item.authorId && reason.trim().length < 2)
      throw new AppError("请填写删除原因");
    if (kind === "POST") await tx.post.update({ where: { id }, data: { deletedAt: new Date() } });
    if (kind === "COMMENT") {
      await tx.resourceComment.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.resourceComment.updateMany({
        where: { parentId: id },
        data: { deletedAt: new Date() },
      });
    }
    if (kind === "REPLY") {
      await tx.postReply.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.postReply.updateMany({ where: { parentId: id }, data: { deletedAt: new Date() } });
    }
    if (["ADMIN", "SUPER_ADMIN"].includes(current.role))
      await tx.auditLog.create({
        data: { actorId: current.id, action: `DELETE_${kind}`, targetId: id, reason },
      });
  });
}
export async function discussionItems(actor: Actor, kind: "RESOURCE" | "POST", id: string) {
  assertMember(actor);
  const select = {
    id: true,
    body: true,
    parentId: true,
    authorId: true,
    author: { select: { name: true } },
    createdAt: true,
    attachments: { select: attachmentSelect, orderBy: { position: "asc" } },
  } as const;
  if (kind === "RESOURCE") {
    if (!(await db.resource.findFirst({ where: { id, deletedAt: null } })))
      throw new AppError("资料不存在", 404);
    return db.resourceComment.findMany({
      where: { resourceId: id, deletedAt: null, pdfFileId: null },
      select,
      orderBy: { createdAt: "asc" },
    });
  }
  if (!(await db.post.findFirst({ where: { id, deletedAt: null } })))
    throw new AppError("帖子不存在", 404);
  return db.postReply.findMany({
    where: { postId: id, deletedAt: null },
    select,
    orderBy: { createdAt: "asc" },
  });
}
