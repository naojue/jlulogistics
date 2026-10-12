import { betterAuth, APIError } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { redeemInvitation } from "@/services/invitations";

export const auth = betterAuth({
  appName: "知页学习社区",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "sqlite" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    autoSignIn: false,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    async sendResetPassword({ user, url }) {
      await sendMail(
        user.email,
        "重置学习社区密码",
        `请打开链接设置新密码：\n${url}\n如果不是你的操作，请忽略此邮件。`,
      );
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    expiresIn: 3600,
    async sendVerificationEmail({ user, url }) {
      await sendMail(
        user.email,
        "验证学习社区邮箱",
        `请在一小时内验证邮箱：\n${url}\n邮箱验证完成后，普通成员仍需等待管理员审批。`,
      );
    },
    async afterEmailVerification(user) {
      const record = await db.user.findUnique({
        where: { id: user.id },
        select: { pendingInviteHash: true },
      });
      if (record?.pendingInviteHash) {
        try {
          await redeemInvitation(user.id, record.pendingInviteHash);
        } catch {
          await db.user.update({ where: { id: user.id }, data: { pendingInviteHash: null } });
        }
      }
    },
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "MEMBER", input: false },
      status: { type: "string", defaultValue: "PENDING", input: false },
      mustChangePassword: { type: "boolean", defaultValue: false, input: false },
      pendingInviteHash: { type: "string", required: false, input: false, returned: false },
      applicationStatement: { type: "string", required: true, returned: false, input: true },
    },
  },
  session: { cookieCache: { enabled: false }, expiresIn: 7 * 86400 },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 5 },
      "/send-verification-email": { window: 60, max: 5 },
    },
  },
  databaseHooks: {
    user: {
      create: {
        async before(user) {
          const data = user as typeof user & { applicationStatement?: string };
          const statement = data.applicationStatement?.trim() || "";
          if (statement.length < 10 || statement.length > 1000)
            throw new APIError("BAD_REQUEST", { message: "申请说明需要 10 至 1000 个字" });
          if (user.name.trim().length < 2 || user.name.length > 30)
            throw new APIError("BAD_REQUEST", { message: "昵称需要 2 至 30 个字" });
          return {
            data: {
              ...user,
              email: user.email.trim().toLowerCase(),
              name: user.name.trim(),
              applicationStatement: statement,
              role: "MEMBER",
              status: "PENDING",
              mustChangePassword: false,
              pendingInviteHash: null,
            },
          };
        },
        async after(user) {
          await db.application.create({
            data: {
              userId: user.id,
              statement: (user as typeof user & { applicationStatement: string })
                .applicationStatement,
            },
          });
        },
      },
    },
  },
});
