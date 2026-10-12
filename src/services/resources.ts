import { db } from "@/lib/db";
import { resourceSchema } from "@/lib/validation";
import { AppError, assertArea, assertOwner, type Actor } from "@/lib/policy";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { MAX_FILE_SIZE, isImage, type UploadFile } from "@/lib/files";
import { attachmentCreate, validateImages } from "@/services/media";

async function taxonomy(data: z.infer<typeof resourceSchema>) {
  const category = await db.category.findUnique({ where: { id: data.categoryId } });
  if (!category || category.kind !== "RESOURCE") throw new AppError("资料分类无效");
  const tags = [...new Set(data.tagIds)];
  if ((await db.tag.count({ where: { id: { in: tags } } })) !== tags.length)
    throw new AppError("资料标签无效");
  return tags;
}
export async function publishResource(
  actor: Actor,
  input: unknown,
  upload: UploadFile | UploadFile[],
) {
  const data = resourceSchema.parse(input);
  assertArea(actor, data.area);
  const files = Array.isArray(upload) ? upload : [upload];
  if (
    !files.length ||
    files.some((file) => file.size <= 0) ||
    files.reduce((total, file) => total + file.size, 0) > MAX_FILE_SIZE
  )
    throw new AppError("请选择文件，总量不能超过 50MB");
  if (files.length > 1) {
    if (files.some((file) => !isImage(file.mime))) throw new AppError("多文件上传仅支持图片");
    validateImages(files);
  }
  const tags = await taxonomy(data);
  return db.resource.create({
    data: {
      title: data.title,
      description: data.description,
      area: data.area,
      category: { connect: { id: data.categoryId } },
      author: { connect: { id: actor.id } },
      tags: { connect: tags.map((id) => ({ id })) },
      file: { create: files[0] },
      attachments: { create: attachmentCreate(files.slice(1)) },
    },
  });
}
export async function updateResource(actor: Actor, id: string, input: unknown) {
  const resource = await db.resource.findUnique({ where: { id } });
  if (!resource || resource.deletedAt) throw new AppError("资料不存在", 404);
  assertOwner(actor, resource.authorId);
  const data = resourceSchema.parse(input);
  assertArea(actor, data.area);
  const tags = await taxonomy(data);
  return db.$transaction(async (tx) => {
    await tx.resource.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        area: data.area,
        categoryId: data.categoryId,
        tags: { set: tags.map((id) => ({ id })) },
      },
    });
    if (actor.id !== resource.authorId)
      await tx.auditLog.create({
        data: { actorId: actor.id, action: "EDIT_RESOURCE", targetId: id },
      });
  });
}
export async function removeResource(actor: Actor, id: string, reason: string) {
  const resource = await db.resource.findUnique({ where: { id } });
  if (!resource || resource.deletedAt) throw new AppError("资料不存在", 404);
  assertOwner(actor, resource.authorId);
  if (actor.id !== resource.authorId && reason.trim().length < 2)
    throw new AppError("请填写删除原因");
  return db.$transaction(async (tx) => {
    await tx.resource.update({ where: { id }, data: { deletedAt: new Date() } });
    if (["ADMIN", "SUPER_ADMIN"].includes(actor.role))
      await tx.auditLog.create({
        data: { actorId: actor.id, action: "DELETE_RESOURCE", targetId: id, reason },
      });
  });
}
// Public DTO excludes storage keys, email addresses, and private discussion data.
export const publicResourceSelect = {
  id: true,
  title: true,
  description: true,
  area: true,
  authorId: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  tags: { select: { id: true, name: true } },
  author: { select: { name: true } },
  file: { select: { id: true, name: true, mime: true, size: true } },
  attachments: {
    select: { file: { select: { id: true, name: true, mime: true, size: true } } },
    orderBy: { position: "asc" },
  },
} satisfies Prisma.ResourceSelect;
export async function listResources(filters: {
  q?: string;
  area?: string;
  category?: string;
  tag?: string;
  page?: number;
  authorId?: string;
}) {
  const where: Prisma.ResourceWhereInput = {
    deletedAt: null,
    ...(filters.authorId ? { authorId: filters.authorId } : {}),
    ...(["MEMBER", "ADMIN"].includes(filters.area || "") ? { area: filters.area } : {}),
    ...(filters.category ? { categoryId: filters.category } : {}),
    ...(filters.tag ? { tags: { some: { id: filters.tag } } } : {}),
    ...(filters.q?.trim()
      ? {
          OR: [
            { title: { contains: filters.q.trim().slice(0, 100) } },
            { description: { contains: filters.q.trim().slice(0, 100) } },
          ],
        }
      : {}),
  };
  const count = await db.resource.count({ where });
  const page = Math.min(
    Math.max(1, Math.trunc(filters.page || 1)),
    Math.max(1, Math.ceil(count / 12)),
  );
  const items = await db.resource.findMany({
    where,
    select: publicResourceSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * 12,
    take: 12,
  });
  return { items, count, page, pages: Math.ceil(count / 12) };
}
