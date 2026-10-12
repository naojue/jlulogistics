import { currentUser } from "@/lib/session";
import { errorResponse } from "@/lib/http";
import { resourceFile } from "@/services/media";
import { fileResponse } from "@/services/file-response";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await fileResponse(
      await resourceFile(
        await currentUser(request.headers),
        (await params).id,
        new URL(request.url).searchParams.get("fileId"),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
