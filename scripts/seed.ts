import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { db } from "../src/lib/db";
async function seed() {
  for (const [kind, names] of [
    ["RESOURCE", ["计算机科学", "数学与统计", "语言学习", "考试备考", "其他资料"]],
    ["POST", ["学习方法", "资料求助", "问题讨论", "经验分享"]],
  ] as const) {
    for (const name of names)
      await db.category.upsert({
        where: { name_kind: { name, kind } },
        update: {},
        create: { name, kind },
      });
  }
  for (const name of ["入门", "进阶", "笔记", "练习", "课程", "工具"])
    await db.tag.upsert({ where: { name }, update: {}, create: { name } });
  if (await db.user.findFirst({ where: { role: "SUPER_ADMIN" } })) {
    console.log("已有超级管理员，保留现有账号与密码。");
    return;
  }
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password || password.length < 10 || password.includes("replace-with"))
    throw new Error("请配置 INITIAL_ADMIN_EMAIL 和至少 10 位的初始密码");
  if (await db.user.findUnique({ where: { email } }))
    throw new Error("初始管理员邮箱已被普通账号使用，请更换邮箱；不会自动提升现有账号。");
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      email,
      name: "社区管理员",
      emailVerified: true,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      mustChangePassword: true,
      applicationStatement: "系统初始化超级管理员",
      accounts: {
        create: {
          id: randomUUID(),
          accountId: id,
          providerId: "credential",
          password: await hashPassword(password),
        },
      },
    },
  });
  console.log("已创建超级管理员，首次登录必须修改密码；账号信息保存在 .env。");
}
seed()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
