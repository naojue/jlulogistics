import { it, expect, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";
import { AppError } from "../src/lib/policy";
import { enqueueProject, retryProject, removeProject } from "../src/services/projects";
import { runProjectWorkerOnce } from "../src/services/project-worker";
import { prepareProjectUpload, cleanupProjectUpload } from "../src/services/project-storage";
import type { ProjectRemoteStore } from "../src/services/github-projects";
vi.mock("@/services/project-storage", () => ({
  prepareProjectUpload: vi.fn(),
  cleanupProjectUpload: vi.fn().mockResolvedValue(undefined),
  cleanupOrphanProjectUploads: vi.fn().mockResolvedValue(undefined),
}));
async function member() {
  return db.user.create({
    data: {
      id: randomUUID(),
      name: "同步成员",
      email: `${randomUUID()}@example.test`,
      emailVerified: true,
      status: "ACTIVE",
    },
  });
}
async function queued() {
  const actor = await member();
  const key = randomUUID();
  const task = await enqueueProject(
    actor,
    {
      title: "库存分析项目",
      description: "这是用来测试项目同步的库存分析项目。",
      course: "库存管理",
      tags: "Python",
    },
    key,
  );
  return { actor, key, task };
}
function prepared() {
  vi.mocked(prepareProjectUpload).mockResolvedValue({
    files: [{ path: "main.py", size: 10, localPath: "test-file", sha256: "a".repeat(64) }],
    totalSize: 200,
    excludedCount: 1,
  });
}
function store(afterPublish?: () => Promise<void>): ProjectRemoteStore {
  return {
    createRepository: vi.fn(async (id) => ({ name: `zhiye-project-${id}`, defaultBranch: "main" })),
    publishSnapshot: vi.fn(async (_id, taskId) => {
      await afterPublish?.();
      return {
        commitSha: createHash("sha1").update(taskId).digest("hex"),
        files: [{ path: "main.py", size: 10, sha: "a".repeat(40) }],
      };
    }),
    listFiles: vi.fn(),
    readFile: vi.fn(),
    downloadArchive: vi.fn(),
  };
}
it("备份维护锁阻止空闲worker开始读取任务或向GitHub写入", async () => {
  const root = path.resolve(process.env.PROJECT_TEMP_DIR!);
  if (root !== path.resolve("data/test-project-tasks"))
    throw new Error("Test path must be isolated");
  await mkdir(root, { recursive: true });
  const marker = path.join(root, ".backup-lock");
  await writeFile(marker, "isolated backup fixture", { flag: "wx" });
  const remote = store();
  try {
    expect((await runProjectWorkerOnce(remote)).processed).toBe(false);
    expect(remote.createRepository).not.toHaveBeenCalled();
    expect(await db.projectWorkerLease.count()).toBe(0);
  } finally {
    await unlink(marker);
  }
});
it("后台确认远端成功才发布，持久化版本清单并清理临时包，版本体积只统计导入源码", async () => {
  prepared();
  const { key, task } = await queued();
  const remote = store();
  expect((await runProjectWorkerOnce(remote)).status).toBe("SUCCEEDED");
  const project = await db.project.findUniqueOrThrow({
    where: { id: task.id },
    include: { currentVersion: true },
  });
  expect(project.currentVersion?.size).toBe(10);
  expect(project.currentVersion?.number).toBe(1);
  expect(JSON.parse(project.currentVersion!.filesJson)).toEqual([
    { path: "main.py", size: 10, sha256: "a".repeat(64), blobSha: "a".repeat(40) },
  ]);
  expect(cleanupProjectUpload).toHaveBeenCalledWith(key);
  const row = await db.projectSyncTask.findUniqueOrThrow({ where: { id: task.taskId } });
  expect(row.uploadKey).toBeNull();
  expect(row.status).toBe("SUCCEEDED");
  expect((await runProjectWorkerOnce(remote)).processed).toBe(false);
});
it("远端暂时失败保留原版和暂存包，作者重试后同一任务只发布一次", async () => {
  prepared();
  const { actor, key, task } = await queued();
  const remote = store();
  vi.mocked(remote.publishSnapshot).mockRejectedValueOnce(new AppError("暂时无法连接 GitHub", 503));
  expect((await runProjectWorkerOnce(remote)).status).toBe("FAILED");
  expect(
    (await db.project.findUniqueOrThrow({ where: { id: task.id } })).currentVersionId,
  ).toBeNull();
  expect(
    (await db.projectSyncTask.findUniqueOrThrow({ where: { id: task.taskId } })).uploadKey,
  ).toBe(key);
  await retryProject(actor, task.id);
  expect((await runProjectWorkerOnce(remote)).status).toBe("SUCCEEDED");
  expect(await db.projectVersion.count({ where: { projectId: task.id } })).toBe(1);
});
it("远端成功响应仍须匹配完整文件清单，缺文件时不发布并保留重试包", async () => {
  prepared();
  const { task, key } = await queued();
  const remote = store();
  vi.mocked(remote.publishSnapshot).mockResolvedValueOnce({ commitSha: "b".repeat(40), files: [] });
  expect((await runProjectWorkerOnce(remote)).status).toBe("FAILED");
  expect(await db.projectVersion.count({ where: { projectId: task.id } })).toBe(0);
  expect(
    (await db.projectSyncTask.findUniqueOrThrow({ where: { id: task.taskId } })).uploadKey,
  ).toBe(key);
});
it("同步过程中停用作者或删除项目后不能发布新版本，任务取消并清理", async () => {
  prepared();
  const suspended = await queued();
  const remote = store(async () => {
    await db.user.update({ where: { id: suspended.actor.id }, data: { status: "SUSPENDED" } });
  });
  expect((await runProjectWorkerOnce(remote)).status).toBe("CANCELED");
  expect(await db.projectVersion.count({ where: { projectId: suspended.task.id } })).toBe(0);
  const deleted = await queued();
  const remoteDeleted = store(async () => {
    await removeProject(deleted.actor, deleted.task.id, "");
  });
  expect((await runProjectWorkerOnce(remoteDeleted)).status).toBe("CANCELED");
  expect(await db.projectVersion.count({ where: { projectId: deleted.task.id } })).toBe(0);
});
it("崩溃留下RUNNING任务可接管，活跃租约禁止第二worker，永久坏包清理后不能重试", async () => {
  prepared();
  const { actor, task } = await queued();
  await db.projectSyncTask.update({ where: { id: task.taskId }, data: { status: "RUNNING" } });
  await db.projectWorkerLease.create({
    data: { id: "project-worker", token: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  });
  expect((await runProjectWorkerOnce(store())).processed).toBe(false);
  await db.projectWorkerLease.update({
    where: { id: "project-worker" },
    data: { expiresAt: new Date(0) },
  });
  expect((await runProjectWorkerOnce(store())).status).toBe("SUCCEEDED");
  expect(await db.projectVersion.count({ where: { projectId: task.id } })).toBe(1);
  const bad = await queued();
  vi.mocked(prepareProjectUpload).mockRejectedValueOnce(new AppError("项目 ZIP 损坏"));
  expect((await runProjectWorkerOnce(store())).status).toBe("FAILED");
  await expect(retryProject(bad.actor, bad.task.id)).rejects.toThrow("无法重试");
  await expect(retryProject(actor, task.id)).rejects.toThrow("无法重试");
});
