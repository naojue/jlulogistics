import { spawn } from "node:child_process";
import path from "node:path";
import { stat } from "node:fs/promises";
import { AppError } from "@/lib/policy";
import { storagePath } from "@/services/storage";

const counts = new Map<string, { count: number; size: number; modified: number }>();
const pending = new Map<string, Promise<number>>();
let queue: Promise<unknown> = Promise.resolve();

function parsePages(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=128",
        "--disallow-code-generation-from-strings",
        /* turbopackIgnore: true */ path.resolve("scripts/pdf-page-count.mjs"),
        file,
      ],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    let output = "";
    let settled = false;
    const finish = (error?: AppError, count?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(count!);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new AppError("PDF 页码验证超时，请稍后重试或使用较小的 PDF", 422));
    }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 4096) {
        child.kill("SIGKILL");
        finish(new AppError("无法验证 PDF 页码，请下载后查看", 422));
      }
    });
    child.on("error", () => finish(new AppError("PDF 页码验证暂不可用，请稍后重试", 503)));
    child.on("close", (code) => {
      const match = output.match(/(?:^|\n)PDF_PAGES:(\d+)\n?$/);
      const count = Number(match?.[1]);
      if (code !== 0 || !Number.isSafeInteger(count) || count < 1 || count > 10_000)
        finish(new AppError("PDF 无法验证页码（可能已加密、损坏或超过 10000 页）", 422));
      else finish(undefined, count);
    });
  });
}

export async function pdfPageCount(key: string) {
  const file = storagePath(key);
  const info = await stat(/* turbopackIgnore: true */ file).catch(() => {
    throw new AppError("PDF 文件不存在", 404);
  });
  if (!info.isFile()) throw new AppError("PDF 文件不存在", 404);
  const cached = counts.get(key);
  if (cached && cached.size === info.size && cached.modified === info.mtimeMs) return cached.count;
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 4) throw new AppError("正在验证其他 PDF，请稍后重试", 429);
  const job = queue.then(async () => {
    const count = await parsePages(file);
    if (counts.size >= 64) counts.delete(counts.keys().next().value!);
    counts.set(key, { count, size: info.size, modified: info.mtimeMs });
    return count;
  });
  queue = job.catch(() => undefined);
  pending.set(key, job);
  try {
    return await job;
  } finally {
    pending.delete(key);
  }
}
