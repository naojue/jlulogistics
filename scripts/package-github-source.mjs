import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { zipSync } from "fflate";
import { collectSourceFiles, readSourceFile } from "./source-files.mjs";

const root = resolve(import.meta.dirname, "..");
const files = collectSourceFiles(root);
const entries = {};
const manifest = [];
for (const file of files) {
  const bytes = readSourceFile(root, file);
  entries[`zhiye-community/${file}`] = bytes;
  manifest.push({
    file,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
const outputDirectory = join(root, "releases");
mkdirSync(outputDirectory, { recursive: true });
const archiveName = "zhiye-community-github.zip";
const bytes = zipSync(entries, { level: 6 });
const checksum = createHash("sha256").update(bytes).digest("hex");
writeFileSync(join(outputDirectory, archiveName), bytes);
writeFileSync(join(outputDirectory, `${archiveName}.sha256`), `${checksum}  ${archiveName}\n`);
writeFileSync(
  join(outputDirectory, "zhiye-community-github-manifest.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      archive: archiveName,
      sha256: checksum,
      files: manifest,
      excluded: [
        "local environment",
        "private keys",
        "databases",
        "community files",
        "backups",
        "release packages",
        "live-community screenshots",
        "dependencies",
        "generated code",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(`GitHub source archive: releases/${archiveName} (${files.length} files).`);
console.log(`SHA256: ${checksum}`);
