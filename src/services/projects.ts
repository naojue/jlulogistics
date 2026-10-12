import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, assertAdmin, assertMember, assertOwner, type Actor } from "@/lib/policy";
import type { Prisma } from "@/generated/prisma/client";
import { commentSchema } from "@/lib/validation";
import type { UploadFile } from "@/lib/files";
import { attachmentCreate, attachmentSelect, validateImages } from "@/services/media";

export const projectSchema = z.object({
  title: z.string().trim().min(3, "项目名称至少 3 字").max(120),
  description: z.string().trim().min(10, "请填写至少 10 字的项目介绍").max(5000),
  course: z.string().trim().min(2, "请填写课程或主题").max(100),
  tags: z.string().trim().max(300).default(""),
});
const messageSchema = z.string().trim().min(2, "请填写版本说明").max(2000);
const requestSchema = z.string().uuid("请求标识无效，请刷新后重试");
const publicProjectSelect = {
  id: true,
  title: true,
  description: true,
  course: true,
  tags: true,
  authorId: true,
  author: { select: { name: true } },
  currentVersionId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;
const versionSelect = {
  id: true,
  number: true,
  message: true,
  fileCount: true,
  size: true,
  createdAt: true,
} satisfies Prisma.ProjectVersionSelect;
const taskSelect = {
  id: true,
  status: true,
  error: true,
  versionMessage: true,
  updatedAt: true,
} satisfies Prisma.ProjectSyncTaskSelect;

export function githubConfigured() {
  return !!(
    process.env.GITHUB_ORGANIZATION &&
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_INSTALLATION_ID &&
    process.env.GITHUB_PRIVATE_KEY_PATH
  );
}
export const projectStorageConfigured = githubConfigured;
export async function freshProjectActor(actor: Actor | null) {
  assertMember(actor);
  const fresh = await db.user.findUnique({ where: { id: actor.id } });
  assertMember(fresh);
  return fresh;
}
async function writeActor(tx: Prisma.TransactionClient, actor: Actor) {
  const current = await tx.user.findUnique({ where: { id: actor.id } });
  assertMember(current);
  return current;
}
async function writeProject(
  tx: Prisma.TransactionClient,
  actor: Actor,
  id: string,
  ownerOnly = true,
) {
  const current = await writeActor(tx, actor);
  const project = await tx.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) throw new AppError("项目不存在或已删除", 404);
  if (ownerOnly) assertOwner(current, project.authorId);
  return { current, project };
}
export async function projectOwner(actor: Actor | null, id: string) {
  const fresh = await freshProjectActor(actor);
  const project = await db.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) throw new AppError("项目不存在或已删除", 404);
  assertOwner(fresh, project.authorId);
  return { actor: fresh, project };
}
function metadata(input: unknown) {
  const result = projectSchema.parse(input);
  const tags = [
    ...new Set(
      result.tags
        .split(/[,，、]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (tags.length > 10 || tags.some((tag) => tag.length > 30))
    throw new AppError("最多填写 10 个标签，每个标签不超过 30 字");
  return { ...result, tags: tags.join(",") };
}
function pageNumber(input: number | undefined, count: number) {
  return Math.min(
    Math.max(1, Number.isFinite(input) ? Math.trunc(input!) : 1),
    Math.max(1, Math.ceil(count / 12)),
  );
}
export async function listProjects(
  filters: { q?: string; course?: string; tag?: string; page?: number } = {},
) {
  const tag = filters.tag?.trim().slice(0, 30);
  const q = filters.q?.trim().slice(0, 100);
  const where: Prisma.ProjectWhereInput = {
    deletedAt: null,
    currentVersionId: { not: null },
    ...(filters.course ? { course: filters.course.slice(0, 100) } : {}),
    AND: [
      ...(q ? [{ OR: [{ title: { contains: q } }, { description: { contains: q } }] }] : []),
      ...(tag
        ? [
            {
              OR: [
                { tags: tag },
                { tags: { startsWith: tag + "," } },
                { tags: { endsWith: "," + tag } },
                { tags: { contains: "," + tag + "," } },
              ],
            },
          ]
        : []),
    ],
  };
  const count = await db.project.count({ where });
  const page = pageNumber(filters.page, count);
  const [items, options] = await Promise.all([
    db.project.findMany({
      where,
      select: publicProjectSelect,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 12,
      take: 12,
    }),
    db.project.findMany({
      where: { deletedAt: null, currentVersionId: { not: null } },
      select: { course: true, tags: true },
      take: 1000,
    }),
  ]);
  return {
    items,
    count,
    page,
    pages: Math.ceil(count / 12),
    courses: [...new Set(options.map((item) => item.course))].sort(),
    tags: [...new Set(options.flatMap((item) => item.tags.split(",").filter(Boolean)))].sort(),
  };
}
export async function projectDetail(actor: Actor | null, id: string) {
  let fresh: Actor | null = null;
  if (actor) {
    try {
      fresh = await freshProjectActor(actor);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
  }
  const project = await db.project.findFirst({
    where: { id, deletedAt: null },
    select: publicProjectSelect,
  });
  if (!project) throw new AppError("项目不存在或已删除", 404);
  const canEdit =
    !!fresh && (fresh.id === project.authorId || ["ADMIN", "SUPER_ADMIN"].includes(fresh.role));
  if (!project.currentVersionId && !canEdit) throw new AppError("项目尚未发布", 404);
  const [versions, latestTask] = await Promise.all([
    fresh
      ? db.projectVersion.findMany({
          where: { projectId: id },
          select: versionSelect,
          orderBy: { number: "desc" },
        })
      : [],
    canEdit
      ? db.projectSyncTask.findFirst({
          where: { projectId: id },
          select: taskSelect,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        })
      : null,
  ]);
  return {
    ...project,
    versions,
    latestTask,
    canEdit,
    member: !!fresh,
    configured: githubConfigured(),
  };
}
export async function myProjects(actor: Actor) {
  const fresh = await freshProjectActor(actor);
  const items = await db.project.findMany({
    where: { authorId: fresh.id, deletedAt: null },
    select: {
      ...publicProjectSelect,
      tasks: { select: taskSelect, orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return items.map(({ tasks, ...item }) => ({ ...item, latestTask: tasks[0] || null }));
}
export async function projectAdminList(actor: Actor, filters: { page?: number; q?: string } = {}) {
  const fresh = await freshProjectActor(actor);
  assertAdmin(fresh);
  const where: Prisma.ProjectWhereInput = {
    deletedAt: null,
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q.trim().slice(0, 100) } },
            { description: { contains: filters.q.trim().slice(0, 100) } },
          ],
        }
      : {}),
  };
  const count = await db.project.count({ where });
  const page = pageNumber(filters.page, count);
  const items = await db.project.findMany({
    where,
    select: {
      ...publicProjectSelect,
      tasks: { select: taskSelect, orderBy: { createdAt: "desc" }, take: 1 },
    },
    skip: (page - 1) * 12,
    take: 12,
    orderBy: { updatedAt: "desc" },
  });
  return {
    items: items.map(({ tasks, ...item }) => ({ ...item, latestTask: tasks[0] || null })),
    count,
    page,
    pages: Math.ceil(count / 12),
  };
}
export async function enqueueProject(
  actor: Actor,
  input: unknown,
  uploadKey: string,
  options: { projectId?: string; requestId?: string; versionMessage?: string } = {},
) {
  const fresh = await freshProjectActor(actor);
  const data = metadata(input);
  const message = messageSchema.parse(options.versionMessage || "首次发布项目");
  const requestId = requestSchema.parse(options.requestId || randomUUID());
  return db.$transaction(async (tx) => {
    const current = await writeActor(tx, fresh);
    const prior = await tx.projectSyncTask.findUnique({ where: { requestId } });
    if (prior) {
      if (
        prior.actorId !== current.id ||
        (options.projectId && options.projectId !== prior.projectId)
      )
        throw new AppError("请求标识已使用", 409);
      await writeProject(tx, current, prior.projectId);
      return { id: prior.projectId, taskId: prior.id, accepted: false };
    }
    let project;
    if (options.projectId) {
      project = await tx.project.findFirst({ where: { id: options.projectId, deletedAt: null } });
      if (!project) throw new AppError("项目不存在或已删除", 404);
      assertOwner(current, project.authorId);
      if (
        await tx.projectSyncTask.findFirst({
          where: { projectId: project.id, status: { in: ["QUEUED", "RUNNING"] } },
        })
      )
        throw new AppError("项目正在同步，请完成后再更新", 409);
      if (!project.currentVersionId)
        project = await tx.project.update({ where: { id: project.id }, data });
      // Published metadata has its own edit form; failed versions must not replace it.
    } else {
      project = await tx.project.create({ data: { ...data, authorId: current.id } });
    }
    const task = await tx.projectSyncTask.create({
      data: {
        projectId: project.id,
        actorId: current.id,
        requestId,
        uploadKey,
        versionMessage: message,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    if (current.id !== project.authorId)
      await tx.auditLog.create({
        data: { actorId: current.id, action: "UPDATE_PROJECT_VERSION", targetId: project.id },
      });
    return { id: project.id, taskId: task.id, accepted: true };
  });
}
export async function updateProject(actor: Actor, id: string, input: unknown) {
  const data = metadata(input);
  return db.$transaction(async (tx) => {
    const { current, project } = await writeProject(tx, actor, id);
    const result = await tx.project.update({ where: { id }, data });
    if (current.id !== project.authorId)
      await tx.auditLog.create({
        data: { actorId: current.id, action: "EDIT_PROJECT", targetId: id },
      });
    return result;
  });
}
export async function removeProject(actor: Actor, id: string, reason: string) {
  if (reason.length > 500) throw new AppError("删除原因最多 500 字");
  await db.$transaction(async (tx) => {
    const { current, project } = await writeProject(tx, actor, id);
    if (current.id !== project.authorId && reason.trim().length < 2)
      throw new AppError("请填写删除原因");
    await tx.project.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.projectSyncTask.updateMany({
      where: { projectId: id, status: { in: ["QUEUED", "RUNNING", "FAILED"] } },
      data: { status: "CANCELED", error: "项目已删除，同步已取消" },
    });
    if (["ADMIN", "SUPER_ADMIN"].includes(current.role))
      await tx.auditLog.create({
        data: { actorId: current.id, action: "DELETE_PROJECT", targetId: id, reason },
      });
  });
}
export async function retryProject(actor: Actor, id: string) {
  return db.$transaction(async (tx) => {
    const { current } = await writeProject(tx, actor, id);
    const task = await tx.projectSyncTask.findFirst({
      where: { projectId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (
      !task ||
      task.status !== "FAILED" ||
      !task.uploadKey ||
      task.cleanedAt ||
      task.expiresAt <= new Date()
    )
      throw new AppError("这个任务无法重试，请重新上传项目包");
    if (
      await tx.projectSyncTask.findFirst({
        where: { projectId: id, status: { in: ["QUEUED", "RUNNING"] } },
      })
    )
      throw new AppError("项目正在同步", 409);
    return tx.projectSyncTask.update({
      where: { id: task.id },
      data: { status: "QUEUED", error: null, actorId: current.id },
    });
  });
}
export async function projectVersion(actor: Actor | null, id: string, versionId?: string | null) {
  await freshProjectActor(actor);
  const project = await db.project.findFirst({
    where: { id, deletedAt: null, currentVersionId: { not: null } },
  });
  if (!project) throw new AppError("项目不存在或尚未发布", 404);
  const version = await db.projectVersion.findFirst({
    where: { id: versionId || project.currentVersionId!, projectId: id },
  });
  if (!version) throw new AppError("项目版本不存在", 404);
  return { project, version };
}
export async function projectDiscussion(actor: Actor, id: string) {
  await projectVersion(actor, id);
  return db.projectComment.findMany({
    where: {
      projectId: id,
      deletedAt: null,
      OR: [{ parentId: null }, { parent: { deletedAt: null } }],
    },
    select: {
      id: true,
      body: true,
      parentId: true,
      authorId: true,
      author: { select: { name: true } },
      createdAt: true,
      attachments: { select: attachmentSelect, orderBy: { position: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
}
export async function addProjectDiscussion(
  actor: Actor,
  id: string,
  text: string,
  parentId?: string,
  files: UploadFile[] = [],
) {
  const body = commentSchema.parse(text);
  validateImages(files);
  return db.$transaction(async (tx) => {
    const { current, project } = await writeProject(tx, actor, id, false);
    if (!project.currentVersionId) throw new AppError("项目尚未发布", 404);
    if (
      parentId &&
      !(await tx.projectComment.findFirst({
        where: { id: parentId, projectId: id, parentId: null, deletedAt: null },
      }))
    )
      throw new AppError("回复目标无效，只支持两层回复");
    return tx.projectComment.create({
      data: {
        projectId: id,
        authorId: current.id,
        body,
        parentId: parentId || null,
        attachments: { create: attachmentCreate(files) },
      },
    });
  });
}
export async function removeProjectComment(actor: Actor, id: string, reason: string) {
  if (reason.length > 500) throw new AppError("删除原因最多 500 字");
  await db.$transaction(async (tx) => {
    const current = await writeActor(tx, actor);
    const item = await tx.projectComment.findFirst({
      where: { id, deletedAt: null },
      include: { project: true },
    });
    if (!item || item.project.deletedAt) throw new AppError("留言不存在", 404);
    assertOwner(current, item.authorId);
    if (current.id !== item.authorId && reason.trim().length < 2)
      throw new AppError("请填写删除原因");
    await tx.projectComment.updateMany({
      where: { OR: [{ id }, { parentId: id }] },
      data: { deletedAt: new Date() },
    });
    if (["ADMIN", "SUPER_ADMIN"].includes(current.role))
      await tx.auditLog.create({
        data: { actorId: current.id, action: "DELETE_PROJECT_COMMENT", targetId: id, reason },
      });
  });
}
export async function projectImageFile(actor: Actor | null, id: string) {
  await freshProjectActor(actor);
  const item = await db.projectCommentAttachment.findUnique({
    where: { id },
    include: { file: true, comment: { include: { project: true, parent: true } } },
  });
  if (
    !item ||
    item.comment.deletedAt ||
    item.comment.project.deletedAt ||
    !item.comment.project.currentVersionId ||
    item.comment.parent?.deletedAt
  )
    throw new AppError("图片不存在或所属内容已删除", 404);
  return item.file;
}
