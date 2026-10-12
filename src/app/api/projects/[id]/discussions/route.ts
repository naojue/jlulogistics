import { currentUser } from "@/lib/session";
import { assertMember } from "@/lib/policy";
import { assertOrigin, errorResponse, privateHeaders } from "@/lib/http";
import { projectDiscussion, addProjectDiscussion } from "@/services/projects";
import { saveUpload, storage } from "@/services/storage";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await currentUser(request.headers);
    assertMember(actor);
    return Response.json(await projectDiscussion(actor, (await params).id), {
      headers: privateHeaders,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let keys: string[] = [];
  try {
    assertOrigin(request);
    const actor = await currentUser(request.headers);
    assertMember(actor);
    const upload = await saveUpload(request, { imagesOnly: true, allowEmpty: true });
    keys = upload.files.map((file) => file.key);
    const fresh = await currentUser(request.headers);
    assertMember(fresh);
    const item = await addProjectDiscussion(
      fresh,
      (await params).id,
      upload.fields.body || "",
      upload.fields.parentId || undefined,
      upload.files,
    );
    keys = [];
    return Response.json({ id: item.id }, { status: 201, headers: privateHeaders });
  } catch (error) {
    await Promise.all(keys.map((key) => storage.remove(key)));
    return errorResponse(error);
  }
}
