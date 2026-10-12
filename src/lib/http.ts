import { AppError } from "@/lib/policy";
import { ZodError } from "zod";
export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export function errorResponse(error: unknown) {
  if (error instanceof AppError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: privateHeaders },
    );
  if (error instanceof ZodError)
    return Response.json({ error: error.issues[0]?.message || "请检查填写内容" }, { status: 400 });
  console.error("Request failed", error instanceof Error ? error.message : "unknown");
  return Response.json({ error: "操作失败，请稍后重试" }, { status: 500, headers: privateHeaders });
}
export function assertOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL || request.url).origin)
    throw new AppError("请求来源无效", 403);
}
export function parseJsonField(value: string | undefined, fallback: unknown = []) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    throw new AppError("上传参数格式无效");
  }
}
