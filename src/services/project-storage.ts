import path from "node:path";
import { createWriteStream, createReadStream } from "node:fs";
import {
  mkdir,
  readdir,
  rm,
  lstat,
  statfs,
  readFile,
  writeFile,
  realpath,
  open,
  rename,
} from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import yauzl from "yauzl";
import { AppError } from "@/lib/policy";
import {
  PROJECT_MAX_SIZE,
  PROJECT_MAX_FILE_SIZE,
  PROJECT_MAX_ENTRIES,
  PROJECT_MAX_PENDING,
  PROJECT_RESERVED_BYTES,
  validateProjectPath,
  excludedProjectPath,
  type ProjectSourceFile,
} from "@/lib/project-limits";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export type PreparedProjectUpload = {
  files: ProjectSourceFile[];
  totalSize: number;
  excludedCount: number;
};

async function rootDirectory() {
  const configured = path.resolve(
    /* turbopackIgnore: true */ process.env.PROJECT_TEMP_DIR || "./data/project-tasks",
  );
  await mkdir(/* turbopackIgnore: true */ configured, { recursive: true, mode: 0o700 });
  return realpath(/* turbopackIgnore: true */ configured);
}
async function taskDirectory(key: string) {
  if (!UUID.test(key)) throw new AppError("项目暂存地址无效");
  const root = await rootDirectory();
  const directory = path.join(root, key);
  const info = await lstat(/* turbopackIgnore: true */ directory).catch(() => null);
  if (!info || !info.isDirectory() || info.isSymbolicLink())
    throw new AppError("项目暂存文件不存在", 404);
  return directory;
}

// Atomic mkdir makes reservation admission safe across the website and background worker.
// Each directory reserves a full ZIP + extracted payload until its task has been cleaned up.
async function reserveDirectory() {
  const root = await rootDirectory();
  const lock = path.join(root, ".quota-lock");
  let locked = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await mkdir(/* turbopackIgnore: true */ lock, { mode: 0o700 });
      locked = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await lstat(/* turbopackIgnore: true */ lock).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 60_000) {
        await rm(/* turbopackIgnore: true */ lock, { recursive: true, force: true });
      } else await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!locked) throw new AppError("项目上传正在排队，请稍后重试", 503);
  try {
    const existing = (await readdir(/* turbopackIgnore: true */ root)).filter((name) =>
      UUID.test(name),
    );
    if (existing.length >= PROJECT_MAX_PENDING)
      throw new AppError("待处理项目已满，请稍后再上传", 429);
    const disk = await statfs(/* turbopackIgnore: true */ root);
    if (
      disk.bavail * disk.bsize <
      PROJECT_RESERVED_BYTES * (existing.length + 1) + 64 * 1024 * 1024
    )
      throw new AppError("服务器临时空间不足，请稍后再上传", 503);
    const key = randomUUID();
    const directory = path.join(root, key);
    await mkdir(/* turbopackIgnore: true */ directory, { mode: 0o700 });
    return { key, directory };
  } finally {
    await rm(/* turbopackIgnore: true */ lock, { recursive: true, force: true });
  }
}

export async function cleanupProjectUpload(key: string) {
  const directory = await taskDirectory(key).catch((error) => {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  });
  if (directory) await rm(/* turbopackIgnore: true */ directory, { recursive: true, force: true });
}

/** Recover reservations left by a crash before the website created its durable task row. */
export async function cleanupOrphanProjectUploads(
  activeKeys: readonly string[],
  maxAgeMs = 2 * 60 * 60 * 1000,
) {
  const active = new Set(activeKeys);
  const root = await rootDirectory();
  for (const key of await readdir(/* turbopackIgnore: true */ root)) {
    if (!UUID.test(key) || active.has(key)) continue;
    const info = await lstat(/* turbopackIgnore: true */ path.join(root, key)).catch(() => null);
    if (
      info?.isDirectory() &&
      !info.isSymbolicLink() &&
      Date.now() - info.mtimeMs > Math.max(maxAgeMs, 60 * 60 * 1000)
    )
      await cleanupProjectUpload(key);
  }
}

export async function saveProjectUpload(request: Request) {
  if (!request.body) throw new AppError("请选择项目 ZIP");
  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: Object.fromEntries(request.headers),
      preservePath: true,
      defParamCharset: "utf8",
      limits: {
        files: 1,
        fileSize: PROJECT_MAX_SIZE + 1,
        fields: 15,
        fieldSize: 80 * 1024,
        parts: 16,
      },
    });
  } catch {
    throw new AppError("项目上传格式无效");
  }
  const { key, directory } = await reserveDirectory();
  const fields: Record<string, string> = Object.create(null);
  const source = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]);
  let failure: unknown;
  let size = 0;
  let wireSize = 0;
  let name = "";
  let job: Promise<void> = Promise.resolve();
  const active = new Set<Readable>();
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      wireSize += chunk.length;
      callback(
        wireSize > PROJECT_MAX_SIZE + 512 * 1024 ? new AppError("项目 ZIP 不能超过 200MB") : null,
        chunk,
      );
    },
  });
  parser.on("field", (field, value, info) => {
    if (field.length > 100 || info.valueTruncated || field in fields)
      failure = new AppError("项目字段无效");
    fields[field] = value;
  });
  for (const event of ["filesLimit", "fieldsLimit", "partsLimit"] as const)
    parser.on(event, () => {
      failure = new AppError("每次只允许上传一个项目 ZIP");
    });
  parser.on("error", (error) => {
    for (const stream of active)
      stream.destroy(error instanceof Error ? error : new AppError("项目上传中断"));
  });
  parser.on("file", (field, stream, info) => {
    active.add(stream);
    stream.on("close", () => active.delete(stream));
    if (
      field !== "file" ||
      !info.filename ||
      info.filename.length > 200 ||
      /[\\/\x00-\x1f]/.test(info.filename) ||
      !/\.zip$/i.test(info.filename)
    ) {
      failure = new AppError("请上传文件名有效的 ZIP 项目包");
      stream.resume();
      return;
    }
    name = info.filename;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(size > PROJECT_MAX_SIZE ? new AppError("项目 ZIP 不能超过 200MB") : null, chunk);
      },
    });
    stream.on("limit", () => {
      failure = new AppError("项目 ZIP 不能超过 200MB");
    });
    job = pipeline(
      stream,
      counter,
      createWriteStream(path.join(directory, "upload.zip"), { flags: "wx", mode: 0o600 }),
    ).catch((error) => {
      failure = error;
      parser.destroy(error);
    });
  });
  const abort = () => source.destroy(new AppError("项目上传已取消"));
  const timeout = setTimeout(
    () => source.destroy(new AppError("项目上传超时，请重试")),
    30 * 60 * 1000,
  );
  timeout.unref();
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  try {
    await pipeline(source, limiter, parser);
    await job;
    if (failure) throw failure;
    if (!name || !size) throw new AppError("请选择非空的项目 ZIP");
    const file = await open(path.join(directory, "upload.zip"), "r");
    const signature = Buffer.alloc(4);
    try {
      await file.read(signature, 0, 4, 0);
    } finally {
      await file.close();
    }
    if (signature.toString("hex") !== "504b0304" && signature.toString("hex") !== "504b0506")
      throw new AppError("项目文件内容不是 ZIP");
    await writeFile(path.join(directory, "upload.json"), JSON.stringify({ name, size, fields }), {
      mode: 0o600,
    });
    return { key, fields, name, size };
  } catch (error) {
    parser.destroy();
    source.destroy();
    for (const stream of active) stream.destroy();
    await job;
    await cleanupProjectUpload(key);
    if ((error as NodeJS.ErrnoException).code === "ENOSPC")
      throw new AppError("服务器临时空间不足", 503);
    throw error;
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
  }
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

async function cachedPreparation(
  manifestPath: string,
  extracted: string,
): Promise<PreparedProjectUpload | null> {
  try {
    const metadata = await lstat(/* turbopackIgnore: true */ manifestPath);
    const directory = await lstat(/* turbopackIgnore: true */ extracted);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size > 1024 * 1024 ||
      !directory.isDirectory() ||
      directory.isSymbolicLink()
    )
      return null;
    const cached = JSON.parse(
      await readFile(/* turbopackIgnore: true */ manifestPath, "utf8"),
    ) as PreparedProjectUpload;
    if (
      !Array.isArray(cached.files) ||
      !cached.files.length ||
      cached.files.length > PROJECT_MAX_ENTRIES ||
      !Number.isSafeInteger(cached.totalSize) ||
      cached.totalSize < 0 ||
      cached.totalSize > PROJECT_MAX_SIZE ||
      !Number.isSafeInteger(cached.excludedCount) ||
      cached.excludedCount < 0 ||
      cached.files.length + cached.excludedCount > PROJECT_MAX_ENTRIES
    )
      return null;
    const paths = new Set<string>();
    const localPaths = new Set<string>();
    let includedSize = 0;
    for (const file of cached.files) {
      if (
        !file ||
        typeof file.path !== "string" ||
        typeof file.localPath !== "string" ||
        typeof file.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        file.size > PROJECT_MAX_FILE_SIZE ||
        validateProjectPath(file.path) !== file.path ||
        file.path.endsWith("/") ||
        excludedProjectPath(file.path) ||
        paths.has(file.path.toLowerCase()) ||
        localPaths.has(file.localPath) ||
        path.dirname(file.localPath) !== extracted ||
        !/^\d{4}\.dat$/.test(path.basename(file.localPath))
      )
        return null;
      paths.add(file.path.toLowerCase());
      localPaths.add(file.localPath);
      includedSize += file.size;
      if (includedSize > cached.totalSize) return null;
      const info = await lstat(/* turbopackIgnore: true */ file.localPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size) return null;
      const hash = createHash("sha256");
      let actualSize = 0;
      for await (const chunk of createReadStream(/* turbopackIgnore: true */ file.localPath)) {
        actualSize += (chunk as Buffer).length;
        if (actualSize > file.size) return null;
        hash.update(chunk as Buffer);
      }
      if (actualSize !== file.size || hash.digest("hex") !== file.sha256) return null;
    }
    return cached;
  } catch {
    return null;
  }
}

export async function prepareProjectUpload(key: string): Promise<PreparedProjectUpload> {
  const directory = await taskDirectory(key);
  const manifestPath = path.join(directory, "prepared.json");
  const temporaryManifest = path.join(directory, "prepared.json.tmp");
  const archivePath = path.join(directory, "upload.zip");
  const extracted = path.join(directory, "files");
  let zip: yauzl.ZipFile | undefined;
  const result: PreparedProjectUpload = { files: [], totalSize: 0, excludedCount: 0 };
  try {
    const cached = await cachedPreparation(manifestPath, extracted);
    if (cached) return cached;
    // A worker can stop between individual files or while writing the manifest. Only this
    // verified UUID task's fixed subdirectory is removed before reconstructing it from its ZIP.
    await rm(/* turbopackIgnore: true */ extracted, { recursive: true, force: true });
    await rm(/* turbopackIgnore: true */ manifestPath, { force: true });
    await rm(/* turbopackIgnore: true */ temporaryManifest, { force: true });
    await mkdir(/* turbopackIgnore: true */ extracted, { mode: 0o700 });
    zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
      yauzl.open(
        /* turbopackIgnore: true */ archivePath,
        { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true },
        (error, archive) =>
          error || !archive ? reject(new AppError("项目 ZIP 损坏或格式不支持")) : resolve(archive),
      );
    });
    const seen = new Set<string>();
    const filePaths = new Set<string>();
    const requiredDirectories = new Set<string>();
    let entries = 0;
    await new Promise<void>((resolve, reject) => {
      const archive = zip!;
      let complete = false;
      const fail = (error: unknown) => {
        if (complete) return;
        complete = true;
        archive.close();
        reject(error instanceof AppError ? error : new AppError("项目 ZIP 损坏或无法安全读取"));
      };
      archive.on("error", fail);
      archive.on("end", () => {
        if (!complete) {
          complete = true;
          resolve();
        }
      });
      archive.on("entry", (entry: yauzl.Entry) => {
        void (async () => {
          if (++entries > PROJECT_MAX_ENTRIES) throw new AppError("项目 ZIP 最多包含 1000 个条目");
          let name: string;
          try {
            name = validateProjectPath(entry.fileName);
          } catch {
            throw new AppError("项目 ZIP 含不安全的文件路径");
          }
          const identity = name.replace(/\/$/, "").toLowerCase();
          if (seen.has(identity)) throw new AppError("项目 ZIP 含重复文件路径");
          seen.add(identity);
          const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
          const fileType = mode & 0xf000;
          if (fileType && fileType !== 0x8000 && fileType !== 0x4000)
            throw new AppError("项目 ZIP 不允许符号链接或特殊文件");
          if (entry.generalPurposeBitFlag & 1 || entry.compressionMethod === 99)
            throw new AppError("项目 ZIP 不支持加密文件");
          const parents = identity.split("/").slice(0, -1);
          for (let index = 1; index <= parents.length; index++) {
            const parent = parents.slice(0, index).join("/");
            if (filePaths.has(parent)) throw new AppError("项目 ZIP 文件与目录路径冲突");
            requiredDirectories.add(parent);
          }
          if (name.endsWith("/")) {
            if (entry.uncompressedSize !== 0 || fileType === 0x8000)
              throw new AppError("项目 ZIP 目录内容无效");
            archive.readEntry();
            return;
          }
          if (requiredDirectories.has(identity) || fileType === 0x4000)
            throw new AppError("项目 ZIP 文件与目录路径冲突");
          filePaths.add(identity);
          if (entry.uncompressedSize > PROJECT_MAX_FILE_SIZE)
            throw new AppError("项目单个文件不能超过 100MiB");
          if (result.totalSize + entry.uncompressedSize > PROJECT_MAX_SIZE)
            throw new AppError("项目解压后的总量不能超过 200MB");
          const excluded = excludedProjectPath(name);
          if (excluded) result.excludedCount++;
          const localPath = path.join(extracted, `${String(entries).padStart(4, "0")}.dat`);
          const hash = createHash("sha256");
          let crc = 0xffffffff;
          let size = 0;
          const stream = await new Promise<Readable>((resolveStream, rejectStream) => {
            archive.openReadStream(entry, (error, contents) =>
              error || !contents ? rejectStream(error) : resolveStream(contents),
            );
          });
          const counter = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              size += chunk.length;
              result.totalSize += chunk.length;
              if (size > PROJECT_MAX_FILE_SIZE || result.totalSize > PROJECT_MAX_SIZE)
                return callback(new AppError("项目解压大小超过 200MB 或单个文件超过 100MiB"));
              hash.update(chunk);
              for (const byte of chunk) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
              callback(null, chunk);
            },
          });
          const target = excluded
            ? new Writable({
                write(_chunk, _encoding, callback) {
                  callback();
                },
              })
            : createWriteStream(localPath, { flags: "wx", mode: 0o600 });
          await pipeline(stream, counter, target);
          if (size !== entry.uncompressedSize || (crc ^ 0xffffffff) >>> 0 !== entry.crc32)
            throw new AppError("项目 ZIP 文件校验失败");
          if (!excluded)
            result.files.push({ path: name, size, localPath, sha256: hash.digest("hex") });
          archive.readEntry();
        })().catch(fail);
      });
      archive.readEntry();
    });
    if (!result.files.length)
      throw new AppError("项目包没有可导入的文件，请排除依赖和密钥后上传源码");
    result.files.sort((a, b) => a.path.localeCompare(b.path, "en"));
    const manifest = await open(/* turbopackIgnore: true */ temporaryManifest, "wx", 0o600);
    try {
      await manifest.writeFile(JSON.stringify(result));
      await manifest.sync();
    } finally {
      await manifest.close();
    }
    await rename(
      /* turbopackIgnore: true */ temporaryManifest,
      /* turbopackIgnore: true */ manifestPath,
    );
    return result;
  } catch (error) {
    await cleanupProjectUpload(key);
    if ((error as NodeJS.ErrnoException).code === "ENOSPC")
      throw new AppError("服务器临时空间不足", 503);
    throw error;
  } finally {
    zip?.close();
  }
}
