import { db } from "@/lib/db";
import { assertManageMember, assertSuper, AppError, type Actor } from "@/lib/policy";
import { statementSchema, reasonSchema } from "@/lib/validation";
export async function reviewMember(
  actor: Actor,
  userId: string,
  decision: string,
  rawReason: string,
) {
  return db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId } });
    if (!target) throw new AppError("用户不存在", 404);
    assertManageMember(actor, target);
    if (!["ACTIVE", "REJECTED", "SUSPENDED"].includes(decision)) throw new AppError("操作无效");
    const reason = decision === "ACTIVE" ? null : reasonSchema.parse(rawReason);
    if (decision === "SUSPENDED") {
      if (target.status !== "ACTIVE") throw new AppError("只能停用已激活成员");
    } else {
      if (target.status !== "PENDING") throw new AppError("该申请已经处理");
      if (!target.emailVerified) throw new AppError("用户尚未验证邮箱");
      const application = await tx.application.findFirst({
        where: { userId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });
      if (!application) throw new AppError("没有待处理的申请");
      await tx.application.update({
        where: { id: application.id },
        data: { status: decision, reason, reviewerId: actor.id, reviewedAt: new Date() },
      });
    }
    await tx.user.update({ where: { id: userId }, data: { status: decision } });
    if (decision !== "ACTIVE") await tx.session.deleteMany({ where: { userId } });
    await tx.auditLog.create({
      data: { actorId: actor.id, action: `MEMBER_${decision}`, targetId: userId, reason },
    });
  });
}
export async function resubmitApplication(actor: Actor, raw: string) {
  const statement = statementSchema.parse(raw);
  if (!actor.emailVerified || actor.status !== "REJECTED" || actor.role !== "MEMBER")
    throw new AppError("当前状态不能重新申请", 403);
  return db.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: { id: actor.id, status: "REJECTED", role: "MEMBER" },
      data: { status: "PENDING", applicationStatement: statement },
    });
    if (!result.count) throw new AppError("申请状态已变化，请刷新");
    await tx.application.create({ data: { userId: actor.id, statement } });
  });
}
export async function setAdministrator(actor: Actor, userId: string, promote: boolean) {
  assertSuper(actor);
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.role === "SUPER_ADMIN") throw new AppError("不能修改超级管理员", 403);
    if (!user.emailVerified || user.status !== "ACTIVE") throw new AppError("账号尚未激活");
    if (promote && user.role !== "MEMBER") throw new AppError("该用户已经是管理员");
    if (!promote && user.role !== "ADMIN") throw new AppError("该用户不是管理员");
    await tx.user.update({ where: { id: userId }, data: { role: promote ? "ADMIN" : "MEMBER" } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: promote ? "PROMOTE_ADMIN" : "DEMOTE_ADMIN",
        targetId: userId,
      },
    });
  });
}
