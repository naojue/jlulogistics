import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { toNextJsHandler } from "better-auth/next-js";
import { AppError } from "@/lib/policy";
import { errorResponse } from "@/lib/http";
const handler = toNextJsHandler(auth);
export const GET = handler.GET;
export async function POST(request: Request) {
  try {
    const pathname = new URL(request.url).pathname;
    if (pathname.endsWith("/sign-in/email")) {
      const body = await request.clone().json();
      const user =
        typeof body.email === "string"
          ? await db.user.findUnique({ where: { email: body.email.trim().toLowerCase() } })
          : null;
      if (user?.status === "SUSPENDED") throw new AppError("账号已停用，请联系管理员", 403);
    }
    let changingUser: string | undefined;
    if (pathname.endsWith("/change-password")) {
      const body = await request.clone().json();
      if (body.currentPassword === body.newPassword) throw new AppError("新密码必须与当前密码不同");
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) throw new AppError("请先登录", 401);
      const user = await db.user.findUnique({ where: { id: session.user.id } });
      if (!user || user.status === "SUSPENDED") throw new AppError("账号不可用", 403);
      changingUser = user.id;
    }
    const response = await handler.POST(request);
    if (response.ok && changingUser)
      await db.user.update({ where: { id: changingUser }, data: { mustChangePassword: false } });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
