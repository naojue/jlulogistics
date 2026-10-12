import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { AppError, assertSuper, invitationValid, type Actor } from "@/lib/policy";
import { sendMail } from "@/lib/mail";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export async function checkInvitation(token: string, email: string) {
  const invite = await db.adminInvitation.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invitationValid(invite, email)) throw new AppError("邀请码无效、已使用、已撤销或邮箱不匹配");
  return invite!;
}
export async function createInvitation(actor: Actor, email: string, deliver = false) {
  assertSuper(actor);
  const token = randomBytes(24).toString("hex");
  const invite = await db.$transaction(async (tx) => {
    const invitation = await tx.adminInvitation.create({
      data: {
        email,
        tokenHash: hashToken(token),
        creatorId: actor.id,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "CREATE_ADMIN_INVITATION",
        targetId: invitation.id,
        reason: deliver ? "添加管理员并发送激活邮件" : "创建管理员邀请码",
      },
    });
    return invitation;
  });
  const url = `${process.env.BETTER_AUTH_URL}/register?invite=${token}&email=${encodeURIComponent(email)}`;
  if (deliver) {
    try {
      await sendMail(
        email,
        "邀请你加入学习社区管理团队",
        `请在七天内打开链接，设置账号并验证邮箱：\n${url}\n如果已有账号，请登录后在成员中心兑换邀请码：${token}`,
      );
    } catch {
      return {
        token,
        url,
        warning: "邮件发送失败，请复制邀请链接；也可以撤销后重新添加。",
        id: invite.id,
      };
    }
  }
  return { token, url, id: invite.id };
}
export async function redeemInvitation(userId: string, tokenHash: string) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !user.emailVerified || user.status === "SUSPENDED" || user.role !== "MEMBER")
      throw new AppError("当前账号不能兑换管理员邀请", 403);
    const invitation = await tx.adminInvitation.findUnique({ where: { tokenHash } });
    if (!invitationValid(invitation, user.email))
      throw new AppError("邀请码无效、已使用、已撤销或邮箱不匹配");
    const now = new Date();
    const result = await tx.adminInvitation.updateMany({
      where: { id: invitation!.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (result.count !== 1) throw new AppError("邀请码已被使用");
    await tx.user.update({
      where: { id: user.id },
      data: { role: "ADMIN", status: "ACTIVE", pendingInviteHash: null },
    });
    await tx.application.updateMany({
      where: { userId, status: "PENDING" },
      data: {
        status: "ACTIVE",
        reviewerId: invitation!.creatorId,
        reviewedAt: now,
        reason: "管理员邀请激活",
      },
    });
    await tx.auditLog.create({
      data: { actorId: invitation!.creatorId, action: "ACTIVATE_ADMIN", targetId: user.id },
    });
  });
}
