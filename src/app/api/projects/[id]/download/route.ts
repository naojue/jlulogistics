import { currentUser } from "@/lib/session";
import { errorResponse } from "@/lib/http";
import { projectArchiveResponse } from "@/services/project-content";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await projectArchiveResponse(
      await currentUser(request.headers),
      (await params).id,
      new URL(request.url).searchParams.get("versionId"),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
