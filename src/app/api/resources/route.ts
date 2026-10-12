import { currentUser } from "@/lib/session";
import { assertMember } from "@/lib/policy";
import { assertOrigin, errorResponse, parseJsonField } from "@/lib/http";
import { saveUpload, storage } from "@/services/storage";
import { publishResource } from "@/services/resources";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let keys: string[] = [];
  try {
    assertOrigin(request);
    const actor = await currentUser(request.headers);
    assertMember(actor);
    const upload = await saveUpload(request);
    keys = upload.files.map((file) => file.key);
    const resource = await publishResource(
      (await currentUser(request.headers))!,
      { ...upload.fields, tagIds: parseJsonField(upload.fields.tagIds) },
      upload.files,
    );
    keys = [];
    return Response.json({ id: resource.id }, { status: 201 });
  } catch (error) {
    await Promise.all(keys.map((key) => storage.remove(key)));
    return errorResponse(error);
  }
}
