import { AppError, type Actor } from "@/lib/policy";
import { privateHeaders } from "@/lib/http";
import { PROJECT_CODE_PREVIEW_SIZE, validateProjectPath } from "@/lib/project-limits";
import { projectVersion } from "@/services/projects";
import { GitHubProjectStore, type ProjectRemoteStore } from "@/services/github-projects";
const remote = new GitHubProjectStore();
export async function projectFileList(
  actor: Actor | null,
  id: string,
  versionId?: string | null,
  store: ProjectRemoteStore = remote,
) {
  const { version } = await projectVersion(actor, id, versionId);
  const files = await store.listFiles(id, version.commitSha);
  await projectVersion(actor, id, version.id);
  return { versionId: version.id, files: files.map(({ path, size }) => ({ path, size })) };
}
export async function projectFileText(
  actor: Actor | null,
  id: string,
  versionId: string | null,
  filePath: string,
  store: ProjectRemoteStore = remote,
) {
  const { version } = await projectVersion(actor, id, versionId);
  try {
    validateProjectPath(filePath);
  } catch {
    throw new AppError("项目文件路径无效");
  }
  const name = filePath.split("/").at(-1)!;
  if (
    !/\.(md|txt|py|pyi|js|jsx|ts|tsx|json|ipynb|java|c|h|cpp|hpp|cs|go|rs|rb|php|html?|css|scss|less|xml|svg|ya?ml|toml|ini|cfg|conf|sql|csv|r|m|sh|bat|ps1|kt|swift|vue|svelte|gradle|properties|gitignore)$/i.test(
      name,
    ) &&
    !/^(readme|license|makefile|dockerfile|\.gitignore|\.editorconfig)$/i.test(name)
  )
    throw new AppError("这个文件暂不支持代码预览，请下载项目后查看");
  const response = await store.readFile(id, version.commitSha, filePath);
  if (!response.body) throw new AppError("项目文件无法读取", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0,
    truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = PROJECT_CODE_PREVIEW_SIZE - size;
      if (value.length > remaining) {
        chunks.push(value.subarray(0, remaining));
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      size += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.includes(0)) throw new AppError("这个文件是二进制内容，请下载项目后查看");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: truncated });
  } catch {
    throw new AppError("文件不是 UTF-8 文本，请下载项目后查看");
  }
  await projectVersion(actor, id, version.id);
  return { path: filePath, text, truncated };
}
export async function projectArchiveResponse(
  actor: Actor | null,
  id: string,
  versionId?: string | null,
  store: ProjectRemoteStore = remote,
) {
  const { version } = await projectVersion(actor, id, versionId);
  const archive = await store.downloadArchive(id, version.commitSha);
  if (!archive.body) throw new AppError("项目下载暂时不可用", 502);
  try {
    await projectVersion(actor, id, version.id);
  } catch (error) {
    await archive.body.cancel().catch(() => {});
    throw error;
  }
  return new Response(archive.body, {
    headers: {
      ...privateHeaders,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="project-v${version.number}.zip"`,
      "Content-Security-Policy": "sandbox; frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
