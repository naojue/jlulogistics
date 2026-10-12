import { currentUser } from "@/lib/session";
import { AppError, assertMember } from "@/lib/policy";
import { assertOrigin, errorResponse, privateHeaders } from "@/lib/http";
import { saveUpload, storage } from "@/services/storage";
import {
  askPdfQuestion,
  pdfQuestions,
  removePdfQuestion,
  replyPdfQuestion,
  setPdfQuestionResolved,
} from "@/services/pdf-questions";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await currentUser(request.headers);
    assertMember(actor);
    const { id } = await params;
    const query = new URL(request.url).searchParams;
    const fileId = query.get("fileId") || "";
    const page = query.has("page") ? Number(query.get("page")) : undefined;
    return Response.json(await pdfQuestions(actor, id, fileId, page), { headers: privateHeaders });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
    return response;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let keys: string[] = [];
  try {
    assertOrigin(request);
    assertMember(await currentUser(request.headers));
    const { id } = await params;
    const { files, fields } = await saveUpload(request, { imagesOnly: true, allowEmpty: true });
    keys = files.map((file) => file.key);
    const actor = await currentUser(request.headers);
    assertMember(actor);
    const fileId = fields.fileId || "";
    let item: { id: string };
    if (fields.action === "ask") {
      item = await askPdfQuestion(actor, id, fileId, Number(fields.page), fields.body || "", files);
    } else if (fields.action === "reply") {
      item = await replyPdfQuestion(
        actor,
        id,
        fileId,
        fields.questionId || "",
        fields.body || "",
        files,
      );
    } else if (fields.action === "resolve" || fields.action === "reopen") {
      if (files.length) throw new AppError("修改问题状态不接收图片");
      item = await setPdfQuestionResolved(
        actor,
        id,
        fileId,
        fields.questionId || "",
        fields.action === "resolve",
      );
    } else if (fields.action === "delete") {
      if (files.length) throw new AppError("删除操作不接收图片");
      await removePdfQuestion(actor, id, fileId, fields.questionId || "", fields.reason || "");
      item = { id: fields.questionId };
    } else {
      throw new AppError("问题操作无效");
    }
    keys = [];
    return Response.json({ id: item.id }, { status: 201, headers: privateHeaders });
  } catch (error) {
    await Promise.all(keys.map((key) => storage.remove(key)));
    const response = errorResponse(error);
    response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
    return response;
  }
}
