import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { nameSchema, emailSchema, statementSchema } from "@/lib/validation";
import { assertOrigin, errorResponse } from "@/lib/http";
import { AppError } from "@/lib/policy";
import { checkInvitation, hashToken } from "@/services/invitations";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const data = z
      .object({
        email: emailSchema,
        name: nameSchema,
        password: z.string().min(10, "密码至少 10 位").max(128),
        statement: statementSchema,
        invite: z.string().max(100).optional(),
      })
      .parse(await request.json());
    if (data.invite) {
      await checkInvitation(data.invite, data.email);
      if (await db.user.findUnique({ where: { email: data.email } }))
        throw new AppError("已有账号请登录后在成员中心兑换邀请码");
    }
    // Pass through the public handler so library rate limits and origin checks still apply.
    const forwarded = new Request(`${process.env.BETTER_AUTH_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        email: data.email,
        name: data.name,
        password: data.password,
        applicationStatement: data.statement,
        callbackURL: "/login?verified=1",
      }),
    });
    const response = await auth.handler(forwarded);
    if (response.ok && data.invite) {
      const result = await response.clone().json();
      const user = await db.user.findUnique({ where: { email: data.email } });
      if (user && user.id === result.user?.id && !user.emailVerified && user.role === "MEMBER")
        await db.user.update({
          where: { id: user.id },
          data: { pendingInviteHash: hashToken(data.invite) },
        });
    }
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
