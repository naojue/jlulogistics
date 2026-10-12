import { currentUser } from "@/lib/session";
import { errorResponse, privateHeaders } from "@/lib/http";
import { projectFileText } from "@/services/project-content";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(request.url);
    return Response.json(
      await projectFileText(
        await currentUser(request.headers),
        (await params).id,
        url.searchParams.get("versionId"),
        url.searchParams.get("path") || "",
      ),
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
