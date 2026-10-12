import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const releases = join(root, "releases");
const name = "fix-sign-out-20261012";
const files = ["src/components/sign-out.tsx", "src/components/sign-out.module.css"];
mkdirSync(releases, { recursive: true });
const staging = mkdtempSync(join(releases, ".sign-out-package-"));
if (!staging.startsWith(releases + sep)) throw new Error("Invalid staging directory");

try {
  const hashes = files.map((file) => {
    const target = join(staging, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, file), target);
    return `${createHash("sha256").update(readFileSync(target)).digest("hex")}  ${file}`;
  });
  writeFileSync(join(staging, "SHA256SUMS"), `${hashes.join("\n")}\n`);
  const archive = join(releases, `${name}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", staging, ...files, "SHA256SUMS"], {
    windowsHide: true,
  });

  // Reuse the existing deployment lock, source/build backup, and failure rollback.
  let installer = readFileSync(join(root, "scripts/deploy-ui.sh"), "utf8").replaceAll("\r\n", "\n");
  function replaceOnce(pattern, replacement) {
    if (!installer.includes(pattern))
      throw new Error("Deployment template changed; review required");
    installer = installer.replace(pattern, replacement);
  }
  const fileListStart = installer.indexOf("FILES=(\n");
  const fileListEnd = installer.indexOf("\n)\n", fileListStart);
  if (fileListStart < 0 || fileListEnd < 0) throw new Error("Deployment file list missing");
  replaceOnce(
    installer.slice(fileListStart, fileListEnd + 2),
    `FILES=(\n${files.map((file) => `  ${file}`).join("\n")}\n)`,
  );
  replaceOnce('chown "$APP_USER:" "$APP_ROOT/public" "$APP_ROOT/public/brand"\n', "");
  const healthStart = installer.indexOf('  if systemctl is-active --quiet "$SERVICE" &&\n');
  const healthEnd = installer.indexOf("; then\n", healthStart);
  if (healthStart < 0 || healthEnd < 0) throw new Error("Deployment health check missing");
  replaceOnce(
    installer.slice(healthStart, healthEnd + 6),
    '  if systemctl is-active --quiet "$SERVICE" &&\n' +
      '    curl --fail --silent --show-error --max-time 10 "$LOCAL_URL/" -o "$WORK_DIR/home.html" &&\n' +
      '    grep -q "吉大物流" "$WORK_DIR/home.html" &&\n' +
      '    [[ -f "$APP_ROOT/.next/BUILD_ID" ]]; then',
  );
  installer = installer
    .replace(
      "# Packaged by scripts/package-ui-release.mjs with an embedded UI-only archive.",
      "# Packaged by scripts/package-sign-out-release.mjs; updates only the logout component.",
    )
    .replaceAll("UI_DEPLOY_", "SIGN_OUT_DEPLOY_")
    .replaceAll("zhiye-ui-backups", "zhiye-sign-out-backups")
    .replaceAll("__UI_ARCHIVE_BELOW__", "__SIGN_OUT_ARCHIVE_BELOW__")
    .replaceAll("ui.tar.gz", "sign-out.tar.gz")
    .replaceAll("UI_UPDATE_OK", "SIGN_OUT_UPDATE_OK")
    .replaceAll("UI deployment", "sign-out deployment")
    .replaceAll("previous UI", "previous sign-out component")
    .replaceAll("new UI", "sign-out fix")
    .replaceAll("Embedded UI archive", "Embedded sign-out archive");
  const payload = readFileSync(archive)
    .toString("base64")
    .match(/.{1,76}/g)
    .join("\n");
  const target = join(releases, `${name}.sh`);
  writeFileSync(target, `${installer}\n__SIGN_OUT_ARCHIVE_BELOW__\n${payload}\n`);
  const checksum = createHash("sha256").update(readFileSync(target)).digest("hex");
  writeFileSync(`${target}.sha256`, `${checksum}  ${name}.sh\n`);
  writeFileSync(
    join(releases, `${name}-manifest.json`),
    JSON.stringify(
      {
        name: "退出登录修复",
        createdAt: new Date().toISOString(),
        installer: `${name}.sh`,
        sha256: checksum,
        files,
        privateDataIncluded: false,
      },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(`Prepared ${target}\nSHA256 ${checksum}\n`);
} finally {
  if (!staging.startsWith(releases + sep)) throw new Error("Invalid cleanup directory");
  rmSync(staging, { recursive: true, force: true });
}
