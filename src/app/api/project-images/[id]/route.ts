import { currentUser } from "@/lib/session";
import { errorResponse } from "@/lib/http";
import { projectImageFile } from "@/services/projects";
import { fileResponse } from "@/services/file-response";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await fileResponse(
      await projectImageFile(await currentUser(request.headers), (await params).id),
      true,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
