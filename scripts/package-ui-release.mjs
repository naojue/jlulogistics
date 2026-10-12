import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const files = [
  "src/app/globals.css",
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/components/auth-page.tsx",
  "src/components/navigation.tsx",
  "src/components/brand.tsx",
  "src/components/theme-switcher.tsx",
  "src/components/supply-chain-art.tsx",
  "public/theme-init.js",
  "public/brand/jida-logistics-v1.png",
];
const releases = join(root, "releases");
mkdirSync(releases, { recursive: true });
const staging = mkdtempSync(join(releases, ".ui-package-"));
try {
  const hashes = files.map((file) => {
    const target = join(staging, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, file), target);
    return `${createHash("sha256").update(readFileSync(target)).digest("hex")}  ${file}`;
  });
  writeFileSync(join(staging, "SHA256SUMS"), `${hashes.join("\n")}\n`);
  const archive = join(releases, "jida-ui-20261010.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", staging, ...files, "SHA256SUMS"]);
  const template = readFileSync(join(root, "scripts/deploy-ui.sh"), "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  const payload = readFileSync(archive)
    .toString("base64")
    .match(/.{1,76}/g)
    .join("\n");
  const installer = join(releases, "jida-ui-20261010.sh");
  writeFileSync(installer, `${template}\n__UI_ARCHIVE_BELOW__\n${payload}\n`);
  const checksum = createHash("sha256").update(readFileSync(installer)).digest("hex");
  writeFileSync(`${installer}.sha256`, `${checksum}  jida-ui-20261010.sh\n`);
  writeFileSync(
    join(releases, "jida-ui-20261010-manifest.json"),
    JSON.stringify(
      {
        name: "吉大物流 UI 更新",
        createdAt: new Date().toISOString(),
        installer: "jida-ui-20261010.sh",
        sha256: checksum,
        files,
        preserves: [
          ".env",
          "data",
          "prisma",
          "package.json",
          "package-lock.json",
          "src/services",
          "src/lib",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(`Prepared ${installer}\nSHA256 ${checksum}\n`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
