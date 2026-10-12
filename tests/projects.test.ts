import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import {
  enqueueProject,
  updateProject,
  removeProject,
  retryProject,
  listProjects,
  projectDetail,
  addProjectDiscussion,
  projectDiscussion,
  removeProjectComment,
  projectImageFile,
  projectVersion,
} from "../src/services/projects";
import {
  projectFileList,
  projectFileText,
  projectArchiveResponse,
} from "../src/services/project-content";
import type { ProjectRemoteStore } from "../src/services/github-projects";
async function member(role = "MEMBER") {
  return db.user.create({
    data: {
      id: randomUUID(),
      email: `${randomUUID()}@example.test`,
      name: "项目测试成员",
      role,
      status: "ACTIVE",
      emailVerified: true,
    },
  });
}
const input = () => ({
  title: `配送规划${randomUUID()}`,
  description: "这是用于比较物流配送算法的课程实践项目。",
  course: "数据结构与物流管理",
  tags: "Python,图算法",
});
async function published(actor: Awaited<ReturnType<typeof member>>) {
  const data = input();
  const project = await db.project.create({ data: { ...data, authorId: actor.id } });
  const version = await db.projectVersion.create({
    data: {
      projectId: project.id,
      taskId: randomUUID(),
      number: 1,
      message: "首次发布",
      commitSha: "a".repeat(40),
      fileCount: 1,
      size: 10,
    },
  });
  await db.project.update({
    where: { id: project.id },
    data: { currentVersionId: version.id, repositoryName: `zhiye-project-${project.id}` },
  });
  return { project, version };
}
it("未同步项目只向作者和管理员展示，重复请求只建立一个项目及任务", async () => {
  const owner = await member();
  const other = await member();
  const admin = await member("ADMIN");
  const requestId = randomUUID();
  const key = randomUUID();
  const data = input();
  const queued = await enqueueProject(owner, data, key, { requestId });
  const duplicate = await enqueueProject(owner, data, randomUUID(), { requestId });
  expect(duplicate).toMatchObject({ id: queued.id, taskId: queued.taskId, accepted: false });
  expect(await db.projectSyncTask.count({ where: { projectId: queued.id } })).toBe(1);
  expect((await listProjects({ q: data.title })).count).toBe(0);
  await expect(projectDetail(null, queued.id)).rejects.toThrow("尚未发布");
  await expect(projectDetail(other, queued.id)).rejects.toThrow("尚未发布");
  expect((await projectDetail(owner, queued.id)).canEdit).toBe(true);
  expect((await projectDetail(admin, queued.id)).canEdit).toBe(true);
  await expect(enqueueProject(other, data, randomUUID(), { requestId })).rejects.toThrow("已使用");
});
it("项目写权限以数据库为准，角色伪造、停用、降级与非作者编辑被拒绝", async () => {
  const owner = await member();
  const other = await member();
  const admin = await member("ADMIN");
  const { project } = await published(owner);
  await expect(
    updateProject({ ...other, role: "SUPER_ADMIN" }, project.id, input()),
  ).rejects.toThrow("自己的");
  await updateProject(admin, project.id, input());
  expect(await db.auditLog.count({ where: { targetId: project.id, action: "EDIT_PROJECT" } })).toBe(
    1,
  );
  await db.user.update({ where: { id: admin.id }, data: { role: "MEMBER" } });
  await expect(updateProject(admin, project.id, input())).rejects.toThrow("自己的");
  await db.user.update({ where: { id: owner.id }, data: { status: "SUSPENDED" } });
  await expect(updateProject(owner, project.id, input())).rejects.toThrow("停用");
  await expect(enqueueProject(owner, input(), randomUUID())).rejects.toThrow("停用");
});
it("版本固定在项目内，公开介绍没有私有版本说明、源码、同步信息与邮箱", async () => {
  const owner = await member();
  const other = await member();
  const { project, version } = await published(owner);
  const second = await published(other);
  const publicData = await projectDetail(null, project.id);
  expect(publicData.versions).toEqual([]);
  expect(publicData.latestTask).toBeNull();
  expect(JSON.stringify(publicData)).not.toContain(owner.email);
  expect(JSON.stringify(publicData)).not.toContain(version.commitSha);
  await expect(projectVersion(null, project.id)).rejects.toThrow("登录");
  await expect(projectVersion(owner, project.id, second.version.id)).rejects.toThrow("版本不存在");
  expect((await projectVersion(owner, project.id, version.id)).version.commitSha).toBe(
    version.commitSha,
  );
});
it("每个项目同时只接受一个更新，坏任务不能重试，软删除阻断版本和讨论", async () => {
  const owner = await member();
  const { project } = await published(owner);
  const results = await Promise.allSettled([
    enqueueProject(owner, input(), randomUUID(), {
      projectId: project.id,
      requestId: randomUUID(),
    }),
    enqueueProject(owner, input(), randomUUID(), {
      projectId: project.id,
      requestId: randomUUID(),
    }),
  ]);
  expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  await expect(retryProject(owner, project.id)).rejects.toThrow("无法重试");
  await removeProject(owner, project.id, "");
  await expect(projectVersion(owner, project.id)).rejects.toThrow("不存在");
  await expect(addProjectDiscussion(owner, project.id, "项目很有帮助")).rejects.toThrow("不存在");
  expect(
    await db.projectSyncTask.count({ where: { projectId: project.id, status: "CANCELED" } }),
  ).toBe(1);
});
it("项目讨论支持两层附图，跨项目及第三层被拒绝，删父留言隐藏旧图片", async () => {
  const owner = await member();
  const other = await member();
  const admin = await member("ADMIN");
  const { project } = await published(owner);
  const second = await published(other);
  const root = await addProjectDiscussion(owner, project.id, "这是项目问题", undefined, [
    { key: randomUUID(), name: "截图.png", mime: "image/png", size: 20 },
  ]);
  const reply = await addProjectDiscussion(other, project.id, "这是改进建议", root.id);
  await expect(addProjectDiscussion(owner, project.id, "第三层回复", reply.id)).rejects.toThrow(
    "两层",
  );
  await expect(
    addProjectDiscussion(owner, second.project.id, "跨项目回复", root.id),
  ).rejects.toThrow("两层");
  await expect(removeProjectComment(other, root.id, "")).rejects.toThrow("自己的");
  const items = await projectDiscussion(owner, project.id);
  const imageId = items[0].attachments[0].id;
  await expect(projectImageFile(null, imageId)).rejects.toThrow("登录");
  expect((await projectImageFile(owner, imageId)).name).toBe("截图.png");
  await removeProjectComment(admin, root.id, "测试内容已处理");
  expect(await projectDiscussion(owner, project.id)).toEqual([]);
  await expect(projectImageFile(owner, imageId)).rejects.toThrow("不存在");
});
it("代码预览有界截取且只返回文本，下载不转发GitHub凭证、重定向或cookie", async () => {
  const owner = await member();
  const { project } = await published(owner);
  const remote = {
    readFile: async () => new Response("x".repeat(2 * 1024 * 1024)),
    downloadArchive: async () =>
      new Response("ZIP", {
        headers: { "Set-Cookie": "private=value", Location: "https://private.invalid/secret" },
      }),
  } as unknown as ProjectRemoteStore;
  const result = await projectFileText(owner, project.id, null, "main.py", remote);
  expect(result.truncated).toBe(true);
  expect(result.text.length).toBe(1024 * 1024);
  await expect(projectFileText(owner, project.id, null, "../main.py", remote)).rejects.toThrow(
    "路径",
  );
  await expect(projectFileText(owner, project.id, null, "report.pdf", remote)).rejects.toThrow(
    "暂不支持",
  );
  const response = await projectArchiveResponse(owner, project.id, null, remote);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("location")).toBeNull();
  expect(await response.text()).toBe("ZIP");
});
it("等待远端期间停用账号或删除项目，在返回源码、目录或下载前再次拒绝并取消流", async () => {
  const owner = await member();
  const { project } = await published(owner);
  const suspend = async () => {
    await db.user.update({ where: { id: owner.id }, data: { status: "SUSPENDED" } });
  };
  const remote = {
    listFiles: async () => {
      await suspend();
      return [{ path: "secret.py", size: 6, sha: "a".repeat(40) }];
    },
    readFile: async () => {
      await suspend();
      return new Response("secret");
    },
  } as unknown as ProjectRemoteStore;
  await expect(projectFileList(owner, project.id, null, remote)).rejects.toThrow("停用");
  await db.user.update({ where: { id: owner.id }, data: { status: "ACTIVE" } });
  await expect(projectFileText(owner, project.id, null, "secret.py", remote)).rejects.toThrow(
    "停用",
  );
  await db.user.update({ where: { id: owner.id }, data: { status: "ACTIVE" } });
  const cancel = vi.fn();
  const download = {
    downloadArchive: async () => {
      await removeProject(owner, project.id, "");
      return new Response(new ReadableStream({ cancel }));
    },
  } as unknown as ProjectRemoteStore;
  await expect(projectArchiveResponse(owner, project.id, null, download)).rejects.toThrow("不存在");
  expect(cancel).toHaveBeenCalledOnce();
});
