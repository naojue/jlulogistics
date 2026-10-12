import { currentUser } from "@/lib/session";
import { assertMember, AppError } from "@/lib/policy";
import { assertOrigin, errorResponse, privateHeaders } from "@/lib/http";
import { saveProjectUpload, cleanupProjectUpload } from "@/services/project-storage";
import { enqueueProject, githubConfigured } from "@/services/projects";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let key: string | null = null;
  try {
    assertOrigin(request);
    const actor = await currentUser(request.headers);
    assertMember(actor);
    if (!githubConfigured()) throw new AppError("项目库尚未连接 GitHub，请联系管理员完成配置", 503);
    const upload = await saveProjectUpload(request);
    key = upload.key;
    const fresh = await currentUser(request.headers);
    assertMember(fresh);
    const result = await enqueueProject(fresh, upload.fields, upload.key, {
      projectId: upload.fields.projectId || undefined,
      requestId: upload.fields.requestId,
      versionMessage: upload.fields.versionMessage,
    });
    if (!result.accepted) await cleanupProjectUpload(key);
    key = null;
    return Response.json(
      { id: result.id, taskId: result.taskId },
      { status: 202, headers: privateHeaders },
    );
  } catch (error) {
    if (key) await cleanupProjectUpload(key).catch(() => {});
    return errorResponse(error);
  }
}
