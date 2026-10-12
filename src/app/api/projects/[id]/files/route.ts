import { currentUser } from "@/lib/session";
import { errorResponse, privateHeaders } from "@/lib/http";
import { projectFileList } from "@/services/project-content";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(request.url);
    return Response.json(
      await projectFileList(
        await currentUser(request.headers),
        (await params).id,
        url.searchParams.get("versionId"),
      ),
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
