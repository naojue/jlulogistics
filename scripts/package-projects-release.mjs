import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { collectSourceFiles, readSourceFile } from "./source-files.mjs";

const root = resolve(import.meta.dirname, "..");
const releases = join(root, "releases");
const releaseName = "zhiye-source-20261011-projects";
mkdirSync(releases, { recursive: true });
const staging = mkdtempSync(join(releases, ".projects-package-"));
if (!staging.startsWith(releases + sep)) throw new Error("Invalid release staging directory");
const files = collectSourceFiles(root);
try {
  const hashes = files.sort().map((file) => {
    const target = resolve(staging, file);
    if (!target.startsWith(staging + sep)) throw new Error("Invalid release path");
    mkdirSync(dirname(target), { recursive: true });
    const bytes = readSourceFile(root, file);
    writeFileSync(target, bytes);
    return `${createHash("sha256").update(bytes).digest("hex")}  ${file}`;
  });
  writeFileSync(join(staging, "SHA256SUMS"), hashes.join("\n") + "\n");
  const archive = join(releases, `${releaseName}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", staging, "."], { windowsHide: true });
  const checksum = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(`${archive}.sha256`, `${checksum}  ${releaseName}.tar.gz\n`);
  const installerName = "upgrade-server-projects.sh";
  writeFileSync(
    join(releases, installerName),
    readFileSync(join(staging, "scripts", installerName)),
  );
  writeFileSync(
    join(releases, `${releaseName}-manifest.json`),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        archive: `${releaseName}.tar.gz`,
        sha256: checksum,
        files,
        privateDataIncluded: false,
        note: "Source release; server backup, migration and configuration are required before activation.",
      },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(`Prepared ${relative(root, archive)}\nSHA256 ${checksum}\n`);
} finally {
  // Only the freshly created, verified staging directory inside this workspace is removed.
  if (!staging.startsWith(releases + sep)) throw new Error("Invalid cleanup directory");
  rmSync(staging, { recursive: true, force: true });
}
