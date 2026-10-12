import { db } from "@/lib/db";
import { AppError, assertMember, type Actor } from "@/lib/policy";
import { MAX_FILE_SIZE, MAX_IMAGE_COUNT, isImage, type UploadFile } from "@/lib/files";
import { stat } from "node:fs/promises";
import { storagePath } from "@/services/storage";
export function validateImages(files: UploadFile[], existing: { file: { size: number } }[] = []) {
  if (files.some((file) => !isImage(file.mime) || file.size <= 0))
    throw new AppError("请选择有效的 JPG、PNG 或 WebP 图片");
  if (files.length + existing.length > MAX_IMAGE_COUNT) throw new AppError("最多上传 20 张图片");
  if (
    files.reduce((total, file) => total + file.size, 0) +
      existing.reduce((total, item) => total + item.file.size, 0) >
    MAX_FILE_SIZE
  )
    throw new AppError("文件总量不能超过 50MB");
}
export const attachmentSelect = {
  id: true,
  file: { select: { name: true, mime: true, size: true } },
} as const;
export const attachmentCreate = (files: UploadFile[]) =>
  files.map((file, position) => ({ position, file: { create: file } }));
export async function resourceFile(actor: Actor | null, id: string, fileId?: string | null) {
  assertMember(actor);
  const resource = await db.resource.findFirst({
    where: { id, deletedAt: null },
    include: { file: true, attachments: { include: { file: true } } },
  });
  if (!resource) throw new AppError("资料不存在或已被删除", 404);
  if (!fileId || fileId === resource.fileId) return resource.file;
  const file = resource.attachments.find((item) => item.fileId === fileId)?.file;
  if (!file) throw new AppError("文件不属于这份资料", 404);
  return file;
}
export async function attachmentFile(actor: Actor | null, id: string) {
  assertMember(actor);
  const item = await db.attachment.findUnique({
    where: { id },
    include: {
      file: true,
      resource: true,
      post: true,
      comment: { include: { resource: true, parent: true } },
      reply: { include: { post: true, parent: true } },
    },
  });
  const visible =
    item &&
    ((item.resource && !item.resource.deletedAt) ||
      (item.post && !item.post.deletedAt) ||
      (item.comment &&
        !item.comment.deletedAt &&
        !item.comment.resource.deletedAt &&
        !item.comment.parent?.deletedAt) ||
      (item.reply &&
        !item.reply.deletedAt &&
        !item.reply.post.deletedAt &&
        !item.reply.parent?.deletedAt));
  if (!visible) throw new AppError("图片不存在或所属内容已删除", 404);
  if (item!.comment?.pdfFileId) {
    const current = await db.user.findUnique({ where: { id: actor.id } });
    assertMember(current);
    const pdf = await resourceFile(current, item!.comment.resourceId, item!.comment.pdfFileId);
    if (pdf.mime !== "application/pdf") throw new AppError("所属 PDF 已不可访问", 404);
    // An orphaned/deleted PDF must also hide its anchored discussion images.
    const stored = await stat(/* turbopackIgnore: true */ storagePath(pdf.key)).catch(() => {
      throw new AppError("所属 PDF 已不可访问", 404);
    });
    if (!stored.isFile()) throw new AppError("所属 PDF 已不可访问", 404);
  }
  return item!.file;
}
