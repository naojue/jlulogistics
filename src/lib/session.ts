import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertMember, assertAdmin, assertSuper, AppError } from "@/lib/policy";

export async function currentUser(requestHeaders?: Headers) {
  const session = await auth.api.getSession({ headers: requestHeaders || (await headers()) });
  if (!session) return null;
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user || user.status === "SUSPENDED") return null;
  return user;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new AppError("请先登录", 401);
  return user;
}
export async function requireMember() {
  const user = await currentUser();
  assertMember(user);
  return user;
}
export async function requireAdmin() {
  const user = await currentUser();
  assertAdmin(user);
  return user;
}
export async function requireSuper() {
  const user = await currentUser();
  assertSuper(user);
  return user;
}
export async function memberPage(admin = false, superOnly = false) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword || user.status !== "ACTIVE" || !user.emailVerified)
    redirect("/account");
  if (superOnly && user.role !== "SUPER_ADMIN") redirect("/account");
  if (admin && !["ADMIN", "SUPER_ADMIN"].includes(user.role)) redirect("/account");
  return user;
}
