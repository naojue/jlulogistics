/** Limits for project imports; ordinary resources and discussion images stay at 50MB. */
export const PROJECT_MAX_SIZE = 200 * 1024 * 1024;
export const PROJECT_MAX_FILE_SIZE = 100 * 1024 * 1024;
export const PROJECT_MAX_ENTRIES = 1000;
export const PROJECT_MAX_PENDING = 2;
export const PROJECT_RESERVED_BYTES = PROJECT_MAX_SIZE * 2;
export const PROJECT_CODE_PREVIEW_SIZE = 1024 * 1024;

export type ProjectSourceFile = {
  path: string;
  size: number;
  localPath: string;
  sha256: string;
};
export type RemoteProjectFile = { path: string; size: number; sha: string };

export function validateProjectPath(input: string) {
  if (
    !input ||
    input.length > 400 ||
    /[\\\x00-\x1f\x7f:]/.test(input) ||
    input.startsWith("/") ||
    input.includes("\uFFFD")
  )
    throw new Error("项目文件路径无效");
  const normalized = input.normalize("NFC");
  const parts = normalized.replace(/\/$/, "").split("/");
  if (
    parts.length > 20 ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[ .]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    throw new Error("项目文件路径无效");
  return normalized;
}

export function excludedProjectPath(input: string) {
  const parts = input.toLowerCase().replace(/\/$/, "").split("/");
  const excluded = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "out",
    "target",
    ".next",
    ".venv",
    "venv",
    "__pycache__",
    "bin",
    "obj",
    ".cache",
    "coverage",
    ".ssh",
    ".aws",
    ".azure",
    ".kube",
  ]);
  if (parts.some((part) => excluded.has(part))) return true;
  if (parts.some((part, index) => part === ".github" && parts[index + 1] === "workflows"))
    return true;
  const name = parts.at(-1) || "";
  return (
    /^\.env(?:\.|$)/.test(name) ||
    /^\.(npmrc|pypirc|netrc|git-credentials|yarnrc(?:\.ya?ml)?)$/.test(name) ||
    /\.(pem|key|p12|pfx|keystore)$/.test(name) ||
    /^id_(rsa|dsa|ecdsa|ed25519)(?:\.|$)/.test(name) ||
    /^(credentials|secrets?)(?:\.|$)/.test(name)
  );
}
