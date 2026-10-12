import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { reviewMember, resubmitApplication, setAdministrator } from "../src/services/members";
import { createInvitation, redeemInvitation, hashToken } from "../src/services/invitations";
import {
  publishResource,
  updateResource,
  removeResource,
  listResources,
} from "../src/services/resources";
import {
  publishPost,
  addDiscussion,
  removeDiscussion,
  discussionItems,
  updatePost,
} from "../src/services/discussions";
import { resourceFile, attachmentFile } from "../src/services/media";
import { MAX_FILE_SIZE } from "../src/lib/files";
import { auth } from "../src/lib/auth";
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }));
async function actor(role = "MEMBER", status = "ACTIVE", emailVerified = true) {
  return db.user.create({
    data: {
      id: randomUUID(),
      email: `${randomUUID()}@example.test`,
      name: "测试成员",
      role,
      status,
      emailVerified,
      applicationStatement: "我是学习社区的测试申请成员",
    },
  });
}
it("普通注册 API 无法指定角色、审批状态或绕过申请说明", async () => {
  const email = `${randomUUID()}@example.test`;
  const request = new Request("http://127.0.0.1:3000/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3000" },
    body: JSON.stringify({
      email,
      name: "新注册成员",
      password: "ExamplePass123!",
      applicationStatement: "学习计算机课程并分享自己的学习资料",
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      emailVerified: true,
      mustChangePassword: false,
    }),
  });
  const response = await auth.handler(request);
  expect(response.status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(user.role).toBe("MEMBER");
  expect(user.status).toBe("PENDING");
  expect(user.emailVerified).toBe(false);
  expect(await db.application.count({ where: { userId: user.id } })).toBe(1);
});
it("审批、拒绝重申与停用撤销会话", async () => {
  const admin = await actor("ADMIN");
  const user = await actor("MEMBER", "PENDING", false);
  await db.application.create({
    data: { userId: user.id, statement: "我是本组的成员，请允许我加入学习交流" },
  });
  await expect(reviewMember(admin, user.id, "ACTIVE", "")).rejects.toThrow("邮箱");
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  await reviewMember(admin, user.id, "REJECTED", "请补充身份信息");
  await resubmitApplication(
    { ...user, emailVerified: true, status: "REJECTED" },
    "我已补充所在班级和学习方向，请重新审核",
  );
  await reviewMember(admin, user.id, "ACTIVE", "");
  await db.session.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 10000),
    },
  });
  await reviewMember(admin, user.id, "SUSPENDED", "暂停该账号使用");
  expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("SUSPENDED");
});
it("邀请兑换只能成功一次，普通管理员不能邀请或提升成员", async () => {
  const superAdmin = await actor("SUPER_ADMIN");
  const admin = await actor("ADMIN");
  const user = await actor("MEMBER", "PENDING");
  await expect(createInvitation(admin, user.email)).rejects.toThrow("超级管理员");
  await expect(setAdministrator(admin, user.id, true)).rejects.toThrow();
  const invite = await createInvitation(superAdmin, user.email);
  const hash = hashToken(invite.token);
  const results = await Promise.allSettled([
    redeemInvitation(user.id, hash),
    redeemInvitation(user.id, hash),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("ADMIN");
  expect(
    (await db.adminInvitation.findUniqueOrThrow({ where: { tokenHash: hash } })).usedAt,
  ).not.toBeNull();
  await expect(setAdministrator(superAdmin, superAdmin.id, false)).rejects.toThrow("超级管理员");
});
it("资料发布、归属、分类、公开数据与删除后隐藏", async () => {
  const member = await actor();
  const other = await actor();
  const admin = await actor("ADMIN");
  const category = await db.category.create({ data: { name: randomUUID(), kind: "RESOURCE" } });
  const file = { key: randomUUID(), name: "学习讲义.pdf", mime: "application/pdf", size: 100 };
  const input = {
    title: "课程学习讲义",
    description: "这是一份用于测试资料发布与检索的学习讲义。",
    area: "MEMBER",
    categoryId: category.id,
    tagIds: [],
  };
  await expect(publishResource(member, { ...input, area: "ADMIN" }, file)).rejects.toThrow();
  const resource = await publishResource(member, input, file);
  await expect(updateResource(other, resource.id, input)).rejects.toThrow("自己的");
  const result = await listResources({ q: "课程学习讲义" });
  expect(result.items).toHaveLength(1);
  expect(JSON.stringify(result.items)).not.toContain(file.key);
  expect(JSON.stringify(result.items)).not.toContain(member.email);
  await addDiscussion(member, "RESOURCE", resource.id, "很有帮助的分享");
  await removeResource(admin, resource.id, "内容测试完成");
  expect((await listResources({ q: "课程学习讲义" })).count).toBe(0);
  await expect(discussionItems(member, "RESOURCE", resource.id)).rejects.toThrow();
});
it("讨论仅允许同一主题下的两层回复，删除主留言会隐藏子回复", async () => {
  const member = await actor();
  const other = await actor();
  const category = await db.category.create({ data: { name: randomUUID(), kind: "POST" } });
  const post = await publishPost(member, {
    title: "测试学习方法",
    body: "大家有什么值得分享的学习方法和经验呢？",
    categoryId: category.id,
  });
  const root = await addDiscussion(member, "POST", post.id, "这是一级留言");
  const child = await addDiscussion(other, "POST", post.id, "这是二级回复", root.id);
  await expect(
    addDiscussion(member, "POST", post.id, "不能有第三层回复", child.id),
  ).rejects.toThrow("两层");
  const another = await publishPost(member, {
    title: "另外一个帖子",
    body: "这是另外一个帖子，用于验证跨帖回复。",
    categoryId: category.id,
  });
  await expect(
    addDiscussion(member, "POST", another.id, "不能跨帖回复", root.id),
  ).rejects.toThrow();
  await removeDiscussion(member, "REPLY", root.id, "");
  expect(await discussionItems(member, "POST", post.id)).toHaveLength(0);
});
it("多图资料权限一致、不能串用文件ID、旧资料仍有默认下载入口", async () => {
  const member = await actor();
  const pending = await actor("MEMBER", "PENDING");
  const category = await db.category.create({ data: { name: randomUUID(), kind: "RESOURCE" } });
  const input = {
    title: "多图学习分享",
    description: "这是一组学习图片，用于验证资料多图权限。",
    area: "MEMBER",
    categoryId: category.id,
    tagIds: [],
  };
  const files = [0, 1].map((i) => ({
    key: randomUUID(),
    name: `${i}.png`,
    mime: "image/png",
    size: 10,
  }));
  const resource = await publishResource(member, input, files);
  const extra = await db.attachment.findFirstOrThrow({ where: { resourceId: resource.id } });
  await expect(resourceFile(null, resource.id)).rejects.toThrow("登录");
  await expect(resourceFile(pending, resource.id, extra.fileId)).rejects.toThrow();
  expect((await resourceFile(member, resource.id)).key).toBe(files[0].key);
  expect((await resourceFile(member, resource.id, extra.fileId)).key).toBe(files[1].key);
  await expect(resourceFile(member, resource.id, randomUUID())).rejects.toThrow("不属于");
  await expect(
    publishResource(
      member,
      input,
      files.map((file) => ({ ...file, key: randomUUID(), size: MAX_FILE_SIZE })),
    ),
  ).rejects.toThrow("50MB");
  const dto = JSON.stringify((await listResources({ q: "多图学习分享" })).items);
  expect(dto).not.toContain(files[1].key);
  expect(dto).not.toContain(member.email);
  await removeResource(member, resource.id, "");
  await expect(resourceFile(member, resource.id, extra.fileId)).rejects.toThrow("删除");
  await expect(attachmentFile(member, extra.id)).rejects.toThrow("删除");
});
it("讨论图片归属、编辑累计大小和删除父回复后访问均受控", async () => {
  const member = await actor();
  const other = await actor();
  const category = await db.category.create({ data: { name: randomUUID(), kind: "POST" } });
  const data = {
    title: "带图讨论帖子",
    body: "这是一个带图片的讨论帖子，用于验证图片权限。",
    categoryId: category.id,
  };
  const image = () => ({
    key: randomUUID(),
    name: "picture.png",
    mime: "image/png",
    size: MAX_FILE_SIZE / 2,
  });
  const post = await publishPost(member, data, [image()]);
  const imageId = (await db.attachment.findFirstOrThrow({ where: { postId: post.id } })).id;
  await expect(attachmentFile(null, imageId)).rejects.toThrow("登录");
  await expect(updatePost(other, post.id, data, [image()])).rejects.toThrow("自己的");
  await updatePost(member, post.id, data, [image()]);
  await expect(updatePost(member, post.id, data, [image()])).rejects.toThrow("50MB");
  await updatePost(member, post.id, data, [], [imageId]);
  await expect(attachmentFile(member, imageId)).rejects.toThrow("不存在");
  const root = await addDiscussion(member, "POST", post.id, "一级留言", undefined, [image()]);
  const child = await addDiscussion(other, "POST", post.id, "二级留言", root.id, [image()]);
  const childImage = await db.attachment.findFirstOrThrow({ where: { replyId: child.id } });
  expect((await attachmentFile(member, childImage.id)).mime).toBe("image/png");
  await removeDiscussion(member, "REPLY", root.id, "");
  await expect(attachmentFile(member, childImage.id)).rejects.toThrow("删除");
  const remainingImage = await db.attachment.findFirstOrThrow({ where: { postId: post.id } });
  await removeDiscussion(member, "POST", post.id, "");
  await expect(attachmentFile(member, remainingImage.id)).rejects.toThrow("删除");
});
