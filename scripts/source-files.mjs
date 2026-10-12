import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";

const rootFiles = [
  ".editorconfig",
  ".env.example",
  ".gitattributes",
  ".gitignore",
  ".prettierignore",
  ".prettierrc.json",
  "AGENTS.md",
  "CLAUDE.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "components.json",
  "next.config.ts",
  "package.json",
  "package-lock.json",
  "playwright.config.ts",
  "playwright.ui.config.ts",
  "postcss.config.mjs",
  "prisma.config.ts",
  "tsconfig.json",
  "vitest.config.ts",
];
const directories = [".github", "src", "prisma", "docs", "scripts", "tests", "public", "examples"];
const excludedDirectories = new Set([
  ".git",
  ".ssh",
  ".aws",
  ".azure",
  ".kube",
  "node_modules",
  "data",
  "backups",
  "releases",
  ".tools",
  "coverage",
  "test-results",
  "playwright-report",
  ".cache",
  "out",
  "dist",
  ".vscode",
  ".idea",
]);
const excludedPaths = ["src/generated", "public/vendor/pdfjs", "docs/design/ui-live"];
const privateFiles =
  /(?:\.(?:pem|key|p12|pfx|keystore|db|sqlite|sqlite3)(?:-.*)?|\.(?:zip|tar|tar\.gz|tgz)|\.log)$/i;
const credentialNames = new Set([
  ".npmrc",
  ".netrc",
  ".pypirc",
  ".git-credentials",
  ".envrc",
  "id_rsa",
  "id_ed25519",
]);
const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".md",
  ".sh",
  ".ps1",
  ".yml",
  ".yaml",
  ".sql",
  ".toml",
  ".py",
  ".svg",
]);

export function isSourcePath(file) {
  if (typeof file !== "string" || !file || file.includes("\\")) return false;
  const parts = file.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes(":")))
    return false;
  if (file === ".env.example") return true;
  if (
    parts.some(
      (part) =>
        excludedDirectories.has(part.toLowerCase()) ||
        part.toLowerCase().startsWith(".next") ||
        part.toLowerCase().startsWith("test-results-"),
    )
  )
    return false;
  const normalized = file.toLowerCase();
  if (excludedPaths.some((path) => normalized === path || normalized.startsWith(`${path}/`)))
    return false;
  const name = basename(file).toLowerCase();
  if (name === ".env" || name.startsWith(".env.") || name.endsWith(".env")) return false;
  if (credentialNames.has(name) || privateFiles.test(name) || name.endsWith(".tsbuildinfo"))
    return false;
  return (
    rootFiles.includes(file) || directories.some((directory) => file.startsWith(`${directory}/`))
  );
}

export function collectSourceFiles(projectRoot) {
  const root = resolve(projectRoot);
  const files = [];
  function visit(file) {
    if (!isSourcePath(file) && !directories.includes(file)) return;
    const target = join(root, file);
    const info = lstatSync(target, { throwIfNoEntry: false });
    if (!info) return;
    if (info.isSymbolicLink()) throw new Error(`Source export refuses symbolic links: ${file}`);
    if (info.isDirectory()) {
      for (const entry of readdirSync(target)) visit(`${file}/${entry}`);
    } else if (info.isFile() && isSourcePath(file)) files.push(file);
  }
  for (const file of [...rootFiles, ...directories]) visit(file);
  return files.sort();
}

export function readSourceFile(projectRoot, file) {
  if (!isSourcePath(file)) throw new Error("File is outside the public source allowlist.");
  const root = realpathSync(resolve(projectRoot));
  const target = join(root, file);
  let cursor = root;
  for (const part of file.split("/")) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink())
      throw new Error("Source export refuses symbolic links.");
  }
  const canonical = realpathSync(target);
  if (
    !canonical.startsWith(root + sep) ||
    !isSourcePath(relative(root, canonical).split(sep).join("/"))
  ) {
    throw new Error("Source export refuses paths outside the project.");
  }
  let bytes = readFileSync(target);
  const text = bytes.toString("utf8");
  // Report only the filename, never the candidate credential or file contents.
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(
      text,
    )
  ) {
    throw new Error(`Potential private credential in public source: ${file}`);
  }
  if (textExtensions.has(extname(file)) || rootFiles.includes(file)) {
    bytes = Buffer.from(text.replaceAll("\r\n", "\n"));
  }
  return bytes;
}
