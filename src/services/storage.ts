import path from "node:path";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, unlink, stat, open } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { AppError } from "@/lib/policy";
import { MAX_FILE_SIZE, MAX_IMAGE_COUNT, isImage, type UploadFile } from "@/lib/files";

export { MAX_FILE_SIZE } from "@/lib/files";
export const MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  md: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  zip: "application/zip",
};
export function validateFilename(name: string) {
  if (!name || name.length > 200 || /[\\/\x00-\x1f]/.test(name)) throw new AppError("文件名无效");
  const ext = name.split(".").at(-1)?.toLowerCase() || "";
  if (!MIME[ext]) throw new AppError("不支持此文件类型，请上传文档、图片或 ZIP");
  return { ext, mime: MIME[ext] };
}
export function storagePath(key: string) {
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new AppError("文件地址无效", 400);
  // Runtime private data belongs on persistent storage, outside the build output.
  return path.join(
    /* turbopackIgnore: true */ path.resolve(
      /* turbopackIgnore: true */ process.env.STORAGE_DIR || "./data/files",
    ),
    key,
  );
}
export const storage = {
  async remove(key: string) {
    await unlink(storagePath(key)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  },
  async read(key: string) {
    const file = storagePath(key);
    const info = await stat(/* turbopackIgnore: true */ file);
    if (!info.isFile()) throw new AppError("文件不存在", 404);
    return { stream: createReadStream(/* turbopackIgnore: true */ file), size: info.size };
  },
};
export function validSignature(ext: string, header: Buffer) {
  const hex = header.toString("hex");
  if (ext === "pdf") return header.subarray(0, 5).toString() === "%PDF-";
  if (["jpg", "jpeg"].includes(ext)) return hex.startsWith("ffd8ff");
  if (ext === "png") return hex.startsWith("89504e470d0a1a0a");
  if (ext === "webp")
    return (
      header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WEBP"
    );
  if (["docx", "pptx", "xlsx", "zip"].includes(ext))
    return hex.startsWith("504b0304") || hex.startsWith("504b0506");
  if (["doc", "ppt", "xls"].includes(ext)) return hex.startsWith("d0cf11e0a1b11e1");
  return !header.includes(0);
}
// Streaming multipart parsing keeps the 50MB aggregate limit independent of Content-Length.
export async function saveUpload(
  request: Request,
  options: { imagesOnly?: boolean; allowEmpty?: boolean } = {},
) {
  if (!request.body) throw new AppError("上传请求为空");
  const fields: Record<string, string> = Object.create(null);
  const files: UploadFile[] = [];
  const keys: string[] = [];
  const jobs: Promise<void>[] = [];
  let failure: unknown;
  let wireSize = 0;
  let fileSize = 0;
  const source = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]);
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      wireSize += chunk.length;
      callback(
        wireSize > MAX_FILE_SIZE + 512 * 1024 ? new AppError("文件总量不能超过 50MB") : null,
        chunk,
      );
    },
  });
  let parser;
  try {
    parser = Busboy({
      headers: Object.fromEntries(request.headers),
      defParamCharset: "utf8",
      preservePath: true,
      limits: {
        files: MAX_IMAGE_COUNT,
        fileSize: MAX_FILE_SIZE + 1,
        fields: 20,
        fieldSize: 80 * 1024,
        parts: 40,
      },
    });
  } catch {
    throw new AppError("上传请求格式无效");
  }
  parser.on("field", (name, value, info) => {
    if (info.valueTruncated || name in fields) failure = new AppError("上传字段无效");
    fields[name] = value;
  });
  parser.on("filesLimit", () => {
    failure = new AppError("最多上传 20 张图片");
  });
  parser.on("fieldsLimit", () => {
    failure = new AppError("上传字段过多");
  });
  parser.on("partsLimit", () => {
    failure = new AppError("上传内容过多");
  });
  const active = new Set<Readable>();
  parser.on("error", (error) => {
    for (const stream of active)
      stream.destroy(error instanceof Error ? error : new AppError("上传中断"));
  });
  parser.on("file", (field, stream, info) => {
    active.add(stream);
    stream.on("close", () => active.delete(stream));
    // Browsers submit an empty file part for an optional unselected input.
    if (!info.filename && options.allowEmpty) {
      stream.resume();
      return;
    }
    let metadata: ReturnType<typeof validateFilename>;
    try {
      if (field !== "file") throw new AppError("文件字段无效");
      metadata = validateFilename(info.filename);
      if (options.imagesOnly && !isImage(metadata.mime))
        throw new AppError("讨论只能上传 JPG、PNG 或 WebP 图片");
    } catch (error) {
      failure = error;
      stream.resume();
      return;
    }
    const key = randomUUID();
    keys.push(key);
    const position = keys.length - 1;
    const target = storagePath(key);
    let size = 0;
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      fileSize += chunk.length;
      if (fileSize > MAX_FILE_SIZE) failure = new AppError("文件总量不能超过 50MB");
    });
    stream.on("limit", () => {
      failure = new AppError("文件总量不能超过 50MB");
    });
    const job = pipeline(stream, createWriteStream(target, { flags: "wx", mode: 0o600 }))
      .then(async () => {
        if (size === 0) throw new AppError("不能上传空文件");
        if (size > MAX_FILE_SIZE) throw new AppError("文件总量不能超过 50MB");
        const file = await open(/* turbopackIgnore: true */ target, "r");
        const header = Buffer.alloc(Math.min(512, size));
        try {
          await file.read(header, 0, header.length, 0);
        } finally {
          await file.close();
        }
        if (!validSignature(metadata.ext, header)) throw new AppError("文件内容与扩展名不匹配");
        files[position] = { key, name: info.filename, mime: metadata.mime, size };
      })
      .catch((error) => {
        failure = error;
      });
    jobs.push(job);
  });
  await mkdir(path.dirname(storagePath(randomUUID())), { recursive: true });
  const abort = () => source.destroy(new AppError("上传已取消"));
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  try {
    await pipeline(source, limiter, parser);
    await Promise.all(jobs);
    if (failure) throw failure;
    if (!files.length && !options.allowEmpty) throw new AppError("请选择文件");
    if (files.length > 1 && files.some((file) => !isImage(file.mime)))
      throw new AppError("多文件上传仅支持图片，文档或 ZIP 请单独发布");
    return { files, file: files[0], fields };
  } catch (error) {
    parser.destroy();
    await Promise.all(jobs);
    await Promise.all(keys.map((key) => storage.remove(key)));
    throw error;
  } finally {
    request.signal.removeEventListener("abort", abort);
  }
}
