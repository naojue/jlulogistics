export type Actor = {
  id: string;
  role: string;
  status: string;
  emailVerified: boolean;
  mustChangePassword: boolean;
};
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function assertMember(user: Actor | null): asserts user is Actor {
  if (!user) throw new AppError("请先登录", 401);
  if (!user.emailVerified) throw new AppError("请先验证邮箱", 403);
  if (user.status !== "ACTIVE")
    throw new AppError(user.status === "SUSPENDED" ? "账号已停用" : "账号尚未通过审批", 403);
  if (user.mustChangePassword) throw new AppError("请先修改初始密码", 403);
}
export function assertAdmin(user: Actor | null): asserts user is Actor {
  assertMember(user);
  if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) throw new AppError("需要管理员权限", 403);
}
export function assertSuper(user: Actor | null): asserts user is Actor {
  assertAdmin(user);
  if (user.role !== "SUPER_ADMIN") throw new AppError("需要超级管理员权限", 403);
}
export function assertArea(user: Actor, area: string) {
  assertMember(user);
  if (!["MEMBER", "ADMIN"].includes(area)) throw new AppError("资料区无效");
  if (area === "ADMIN") assertAdmin(user);
}
export function assertOwner(user: Actor, authorId: string) {
  assertMember(user);
  if (user.id !== authorId && !["ADMIN", "SUPER_ADMIN"].includes(user.role))
    throw new AppError("只能管理自己的内容", 403);
}
export function assertManageMember(actor: Actor, target: Actor) {
  assertAdmin(actor);
  if (target.role !== "MEMBER") throw new AppError("不能修改管理员账号", 403);
}
export function invitationValid(
  invite: { email: string; expiresAt: Date; usedAt: Date | null; revokedAt: Date | null } | null,
  email: string,
  now = new Date(),
) {
  return (
    !!invite &&
    invite.email === email.trim().toLowerCase() &&
    invite.expiresAt > now &&
    !invite.usedAt &&
    !invite.revokedAt
  );
}
