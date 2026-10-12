import { currentUser } from "@/lib/session";
import { assertMember, AppError } from "@/lib/policy";
import { discussionItems, addDiscussion } from "@/services/discussions";
import { errorResponse, privateHeaders, assertOrigin } from "@/lib/http";
import { saveUpload, storage } from "@/services/storage";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  let keys: string[] = [];
  try {
    assertOrigin(request);
    assertMember(await currentUser(request.headers));
    const { kind, id } = await params;
    if (kind !== "RESOURCE" && kind !== "POST") throw new AppError("讨论类型无效");
    const upload = await saveUpload(request, { imagesOnly: true, allowEmpty: true });
    keys = upload.files.map((file) => file.key);
    const actor = await currentUser(request.headers);
    assertMember(actor);
    const item = await addDiscussion(
      actor,
      kind,
      id,
      upload.fields.body || "",
      upload.fields.parentId || undefined,
      upload.files,
    );
    keys = [];
    return Response.json({ id: item.id }, { status: 201 });
  } catch (error) {
    await Promise.all(keys.map((key) => storage.remove(key)));
    return errorResponse(error);
  }
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  try {
    const actor = await currentUser(request.headers);
    assertMember(actor);
    const { kind, id } = await params;
    if (!["RESOURCE", "POST"].includes(kind)) throw new AppError("讨论类型无效");
    const items = await discussionItems(actor, kind as "RESOURCE" | "POST", id);
    return Response.json({ items }, { headers: privateHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
