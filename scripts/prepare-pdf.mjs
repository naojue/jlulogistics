import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
const source = path.resolve("node_modules/pdfjs-dist");
const target = path.resolve("public/vendor/pdfjs");
await mkdir(target, { recursive: true });
await cp(path.join(source, "build/pdf.worker.min.mjs"), path.join(target, "pdf.worker.min.mjs"));
for (const folder of ["cmaps", "standard_fonts", "wasm"])
  await cp(path.join(source, folder), path.join(target, folder), { recursive: true });
await cp(path.join(source, "LICENSE"), path.join(target, "LICENSE"));
