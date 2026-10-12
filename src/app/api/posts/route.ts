import { currentUser } from "@/lib/session";
import { assertMember } from "@/lib/policy";
import { assertOrigin, errorResponse, parseJsonField } from "@/lib/http";
import { saveUpload, storage } from "@/services/storage";
import { publishPost, updatePost } from "@/services/discussions";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let keys: string[] = [];
  try {
    assertOrigin(request);
    assertMember(await currentUser(request.headers));
    const upload = await saveUpload(request, { imagesOnly: true, allowEmpty: true });
    keys = upload.files.map((file) => file.key);
    const actor = await currentUser(request.headers);
    assertMember(actor);
    const id = upload.fields.id;
    const removeIds = z.array(z.string()).max(20).parse(parseJsonField(upload.fields.removeIds));
    if (id) await updatePost(actor, id, upload.fields, upload.files, removeIds);
    const post = id ? { id } : await publishPost(actor, upload.fields, upload.files);
    keys = [];
    return Response.json({ id: post.id }, { status: id ? 200 : 201 });
  } catch (error) {
    await Promise.all(keys.map((key) => storage.remove(key)));
    return errorResponse(error);
  }
}
