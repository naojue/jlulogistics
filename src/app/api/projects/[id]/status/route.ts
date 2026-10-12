import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { errorResponse, privateHeaders } from "@/lib/http";
import { projectOwner } from "@/services/projects";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { project } = await projectOwner(await currentUser(request.headers), id);
    const task = await db.projectSyncTask.findFirst({
      where: { projectId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true, error: true },
    });
    return Response.json(
      {
        taskId: task?.id,
        status: task?.status || "SUCCEEDED",
        error: task?.error,
        versionId: project.currentVersionId,
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
