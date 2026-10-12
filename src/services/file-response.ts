import { Readable } from "node:stream";
import { AppError } from "@/lib/policy";
import { privateHeaders } from "@/lib/http";
import { storage } from "@/services/storage";
import { isImage } from "@/lib/files";
export async function fileResponse(
  file: { key: string; name: string; mime: string },
  preview = false,
) {
  let stored;
  try {
    stored = await storage.read(file.key);
  } catch {
    throw new AppError("文件不存在，请联系管理员", 404);
  }
  const inline = preview && (isImage(file.mime) || file.mime === "application/pdf");
  return new Response(Readable.toWeb(stored.stream) as ReadableStream, {
    headers: {
      ...privateHeaders,
      "Content-Type": inline ? file.mime : "application/octet-stream",
      "Content-Length": String(stored.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replaceAll("'", "%27")}`,
      "Content-Security-Policy": "sandbox; frame-ancestors 'self'",
      "X-Frame-Options": preview ? "SAMEORIGIN" : "DENY",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
