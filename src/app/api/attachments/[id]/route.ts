import { currentUser } from "@/lib/session";
import { errorResponse } from "@/lib/http";
import { attachmentFile } from "@/services/media";
import { fileResponse } from "@/services/file-response";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await fileResponse(
      await attachmentFile(await currentUser(request.headers), (await params).id),
      true,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
