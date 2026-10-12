import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { AppError, assertMember, assertOwner } from "@/lib/policy";
import { GitHubProjectStore, type ProjectRemoteStore } from "@/services/github-projects";
import {
  prepareProjectUpload,
  cleanupProjectUpload,
  cleanupOrphanProjectUploads,
} from "@/services/project-storage";

const LEASE_ID = "project-worker";
const LEASE_MS = 120_000;
async function backupMaintenanceActive() {
  const marker = path.join(
    path.resolve(
      /* turbopackIgnore: true */ process.env.PROJECT_TEMP_DIR || "./data/project-tasks",
    ),
    ".backup-lock",
  );
  try {
    await access(/* turbopackIgnore: true */ marker);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function claimLease(token: string) {
  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.projectWorkerLease.findUnique({ where: { id: LEASE_ID } });
      const expiresAt = new Date(Date.now() + LEASE_MS);
      if (!row) {
        await tx.projectWorkerLease.create({ data: { id: LEASE_ID, token, expiresAt } });
        return true;
      }
      const result = await tx.projectWorkerLease.updateMany({
        where: { id: LEASE_ID, expiresAt: { lte: new Date() } },
        data: { token, expiresAt },
      });
      return result.count === 1;
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002")
      return false;
    throw error;
  }
}
async function stillOwnLease(token: string) {
  return !!(await db.projectWorkerLease.findFirst({
    where: { id: LEASE_ID, token, expiresAt: { gt: new Date() } },
  }));
}
async function checkedTask(taskId: string, token: string) {
  if (!(await stillOwnLease(token))) throw new AppError("同步任务已由其他进程接管", 409);
  const task = await db.projectSyncTask.findUnique({
    where: { id: taskId },
    include: { project: true, actor: true },
  });
  if (
    !task ||
    task.status !== "RUNNING" ||
    task.project.deletedAt ||
    !task.uploadKey ||
    task.expiresAt <= new Date()
  )
    throw new AppError("项目任务已取消或已过期", 409);
  assertMember(task.actor);
  assertOwner(task.actor, task.project.authorId);
  return task;
}
async function cleanTask(id: string, key: string) {
  await cleanupProjectUpload(key);
  await db.projectSyncTask.update({
    where: { id },
    data: { uploadKey: null, cleanedAt: new Date() },
  });
}
async function cleanupFinished() {
  const rows = await db.projectSyncTask.findMany({
    where: {
      uploadKey: { not: null },
      OR: [{ status: { in: ["SUCCEEDED", "CANCELED"] } }, { expiresAt: { lte: new Date() } }],
    },
    take: 20,
  });
  for (const row of rows) {
    if (row.status !== "SUCCEEDED" && row.status !== "CANCELED")
      await db.projectSyncTask.update({
        where: { id: row.id },
        data: { status: "CANCELED", error: "同步任务已过期，请重新上传" },
      });
    await cleanTask(row.id, row.uploadKey!);
  }
  const active = await db.projectSyncTask.findMany({
    where: { uploadKey: { not: null } },
    select: { uploadKey: true },
  });
  await cleanupOrphanProjectUploads(active.map((row) => row.uploadKey!));
}
// The HTTP request only queues work. A separate systemd process runs this function serially.
export async function runProjectWorkerOnce(remote: ProjectRemoteStore = new GitHubProjectStore()) {
  if (await backupMaintenanceActive()) return { processed: false };
  const token = randomUUID();
  if (!(await claimLease(token))) return { processed: false };
  let timer: ReturnType<typeof setInterval> | undefined;
  let leaseLost = false;
  try {
    // The backup first creates its marker, then atomically claims the same database lease.
    // Rechecking after admission closes the idle-worker/start-backup race.
    if (await backupMaintenanceActive()) return { processed: false };
    timer = setInterval(() => {
      void db.projectWorkerLease
        .updateMany({
          where: { id: LEASE_ID, token },
          data: { expiresAt: new Date(Date.now() + LEASE_MS) },
        })
        .then(({ count }) => {
          if (!count) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        });
    }, 15_000);
    timer.unref();
    await cleanupFinished();
    const pending = await db.projectSyncTask.findFirst({
      where: { status: { in: ["QUEUED", "RUNNING"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!pending) return { processed: false };
    await db.projectSyncTask.update({
      where: { id: pending.id },
      data: { status: "RUNNING", error: null, attempts: { increment: 1 } },
    });
    try {
      const task = await checkedTask(pending.id, token);
      const prepared = await prepareProjectUpload(task.uploadKey!);
      await checkedTask(task.id, token);
      const repository = await remote.createRepository(task.projectId);
      const snapshot = await remote.publishSnapshot(task.projectId, task.id, prepared.files);
      const remoteFiles = new Map(snapshot.files.map((file) => [file.path, file]));
      if (
        !/^[a-f0-9]{40}$/.test(snapshot.commitSha) ||
        remoteFiles.size !== prepared.files.length ||
        snapshot.files.length !== prepared.files.length ||
        prepared.files.some((file) => {
          const saved = remoteFiles.get(file.path);
          return !saved || saved.size !== file.size || !/^[a-f0-9]{40}$/.test(saved.sha);
        })
      )
        throw new AppError("远端版本文件清单校验失败，请重试或联系管理员", 502);
      if (leaseLost) throw new AppError("同步任务已由其他进程接管", 409);
      await checkedTask(task.id, token);
      await db.$transaction(async (tx) => {
        const lease = await tx.projectWorkerLease.findFirst({
          where: { id: LEASE_ID, token, expiresAt: { gt: new Date() } },
        });
        if (!lease) throw new AppError("同步任务已由其他进程接管", 409);
        const current = await tx.projectSyncTask.findUniqueOrThrow({
          where: { id: task.id },
          include: { project: true, actor: true },
        });
        assertMember(current.actor);
        assertOwner(current.actor, current.project.authorId);
        if (
          current.status !== "RUNNING" ||
          current.project.deletedAt ||
          current.expiresAt <= new Date()
        )
          throw new AppError("项目任务已取消或过期", 409);
        let version = await tx.projectVersion.findUnique({ where: { taskId: task.id } });
        if (!version) {
          const last = await tx.projectVersion.aggregate({
            where: { projectId: task.projectId },
            _max: { number: true },
          });
          version = await tx.projectVersion.create({
            data: {
              projectId: task.projectId,
              taskId: task.id,
              number: (last._max.number || 0) + 1,
              message: task.versionMessage,
              commitSha: snapshot.commitSha,
              fileCount: prepared.files.length,
              size: prepared.files.reduce((total, file) => total + file.size, 0),
              filesJson: JSON.stringify(
                prepared.files.map((file) => ({
                  path: file.path,
                  size: file.size,
                  sha256: file.sha256,
                  blobSha: remoteFiles.get(file.path)!.sha,
                })),
              ),
            },
          });
        }
        await tx.project.update({
          where: { id: task.projectId },
          data: { repositoryName: repository.name, currentVersionId: version.id },
        });
        await tx.projectSyncTask.update({
          where: { id: task.id },
          data: { status: "SUCCEEDED", error: null },
        });
      });
      await cleanTask(task.id, task.uploadKey!);
      return { processed: true, taskId: task.id, status: "SUCCEEDED" };
    } catch (error) {
      if (!(await stillOwnLease(token)))
        return { processed: true, taskId: pending.id, status: "RUNNING" };
      const current = await db.projectSyncTask.findUniqueOrThrow({
        where: { id: pending.id },
        include: { project: true, actor: true },
      });
      let canceled =
        !!current.project.deletedAt ||
        current.status === "CANCELED" ||
        current.expiresAt <= new Date();
      try {
        assertMember(current.actor);
        assertOwner(current.actor, current.project.authorId);
      } catch {
        canceled = true;
      }
      // A cleanup error after a committed version must not turn success into failure.
      if (current.status === "SUCCEEDED")
        return { processed: true, taskId: pending.id, status: "SUCCEEDED" };
      const status = canceled ? "CANCELED" : "FAILED";
      const message = canceled
        ? "项目任务已取消，请确认账号和项目状态"
        : error instanceof AppError
          ? error.message
          : "项目同步失败，请重试或联系管理员";
      await db.projectSyncTask.update({
        where: { id: pending.id },
        data: { status, error: message },
      });
      if (
        (canceled || (error instanceof AppError && [400, 404].includes(error.status))) &&
        current.uploadKey
      )
        await cleanTask(current.id, current.uploadKey);
      return { processed: true, taskId: pending.id, status };
    }
  } finally {
    if (timer) clearInterval(timer);
    await db.projectWorkerLease.deleteMany({ where: { id: LEASE_ID, token } });
  }
}
