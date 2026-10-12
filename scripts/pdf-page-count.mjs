import { readFile, stat } from "node:fs/promises";

// Parse untrusted PDFs in a short-lived, heap-limited process. Never render or execute content.
try {
  const file = process.argv[2];
  const info = await stat(file);
  if (!info.isFile() || info.size <= 0 || info.size > 50 * 1024 * 1024) process.exit(1);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(await readFile(file)),
    disableFontFace: true,
    useSystemFonts: false,
    isImageDecoderSupported: false,
    useWasm: false,
    verbosity: 0,
    stopAtErrors: true,
  });
  task.onPassword = () => {
    void task.destroy();
  };
  const pdf = await task.promise;
  if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > 10_000)
    process.exit(1);
  process.stdout.write(`PDF_PAGES:${pdf.numPages}\n`);
  await task.destroy();
} catch {
  process.exitCode = 1;
}
