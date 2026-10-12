import { createHash, createSign } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, lstat } from "node:fs/promises";
import { Readable } from "node:stream";
import { AppError } from "@/lib/policy";
import { githubWritePacer, type GitHubWritePacer } from "@/services/github-pacing";
import {
  PROJECT_MAX_SIZE,
  PROJECT_MAX_FILE_SIZE,
  PROJECT_MAX_ENTRIES,
  validateProjectPath,
  excludedProjectPath,
  type ProjectSourceFile,
  type RemoteProjectFile,
} from "@/lib/project-limits";

export type { ProjectSourceFile, RemoteProjectFile } from "@/lib/project-limits";
export interface ProjectRemoteStore {
  createRepository(projectId: string): Promise<{ name: string; defaultBranch: string }>;
  publishSnapshot(
    projectId: string,
    taskId: string,
    files: ProjectSourceFile[],
  ): Promise<{ commitSha: string; files: RemoteProjectFile[] }>;
  listFiles(projectId: string, commitSha: string): Promise<RemoteProjectFile[]>;
  readFile(projectId: string, commitSha: string, filePath: string): Promise<Response>;
  downloadArchive(projectId: string, commitSha: string): Promise<Response>;
}
type Configuration = {
  organization: string;
  appId: string;
  installationId: string;
  privateKeyPath?: string;
  privateKey?: string;
};
type Repository = { name: string; private: boolean; description: string; default_branch: string };
const API = "https://api.github.com";
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[a-zA-Z0-9_-]{1,80}$/;

function apiBase() {
  // Test-only loopback fixture: production cannot redirect its GitHub credentials to a custom URL.
  if (process.env.E2E_RUN === "true" && process.env.GITHUB_TEST_API_URL) {
    let fixture: URL;
    try {
      fixture = new URL(process.env.GITHUB_TEST_API_URL);
    } catch {
      throw new AppError("GitHub 测试地址无效");
    }
    if (
      fixture.protocol !== "http:" ||
      fixture.hostname !== "127.0.0.1" ||
      fixture.username ||
      fixture.password ||
      fixture.pathname !== "/" ||
      fixture.search ||
      fixture.hash
    )
      throw new AppError("GitHub 测试地址必须使用本机隔离服务");
    return fixture.origin;
  }
  return API;
}

export function githubProjectsConfigured() {
  return Boolean(
    process.env.GITHUB_ORGANIZATION &&
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_INSTALLATION_ID &&
    process.env.GITHUB_PRIVATE_KEY_PATH,
  );
}
function environmentConfiguration(): Configuration {
  return {
    organization: process.env.GITHUB_ORGANIZATION || "",
    appId: process.env.GITHUB_APP_ID || "",
    installationId: process.env.GITHUB_INSTALLATION_ID || "",
    privateKeyPath: process.env.GITHUB_PRIVATE_KEY_PATH,
  };
}
export function githubRepositoryName(projectId: string) {
  if (!ID.test(projectId)) throw new AppError("项目标识无效");
  return `zhiye-project-${projectId.toLowerCase()}`;
}
function assertCommit(commit: string) {
  if (!SHA.test(commit)) throw new AppError("项目版本无效");
}

export class GitHubProjectStore implements ProjectRemoteStore {
  private readonly api = apiBase();
  private token: { value: string; expiresAt: number } | undefined;
  private tokenPromise: Promise<string> | undefined;
  constructor(
    private readonly configuration = environmentConfiguration(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly writePacer: GitHubWritePacer = githubWritePacer,
  ) {}
  private configurationCheck() {
    const config = this.configuration;
    if (
      !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(config.organization) ||
      !/^(\d+|Iv[a-z\d]+)$/i.test(config.appId) ||
      !/^\d+$/.test(config.installationId) ||
      !(config.privateKeyPath || config.privateKey)
    )
      throw new AppError("项目库尚未连接 GitHub，请联系管理员完成配置", 503);
  }
  private async installationToken(): Promise<string> {
    this.configurationCheck();
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      const config = this.configuration;
      let jwt: string;
      try {
        const pem =
          config.privateKey ||
          (await readFile(/* turbopackIgnore: true */ config.privateKeyPath!, "utf8"));
        const seconds = Math.floor(this.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
          "base64url",
        );
        const payload = Buffer.from(
          JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: config.appId }),
        ).toString("base64url");
        const signature = createSign("RSA-SHA256")
          .update(`${header}.${payload}`)
          .sign(pem)
          .toString("base64url");
        jwt = `${header}.${payload}.${signature}`;
      } catch {
        throw new AppError("GitHub 应用私钥配置无效，请联系管理员", 503);
      }
      const response = await this.fetcher(
        `${this.api}/app/installations/${config.installationId}/access_tokens`,
        {
          method: "POST",
          headers: this.headers(jwt),
          cache: "no-store",
          signal: AbortSignal.timeout(60_000),
        },
      ).catch(() => {
        throw new AppError("暂时无法连接 GitHub，请稍后重试", 503);
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError("GitHub 应用授权失败，请联系管理员", 503);
      }
      const result = await this.json<{ token: string; expires_at: string }>(response);
      const expiresAt = Date.parse(result.expires_at);
      if (!result.token || !Number.isFinite(expiresAt) || expiresAt <= this.now())
        throw new AppError("GitHub 应用授权失败，请联系管理员", 503);
      this.token = { value: result.token, expiresAt };
      return result.token;
    })();
    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = undefined;
    }
  }
  private headers(token: string, accept = "application/vnd.github+json") {
    return {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "Zhiye-Project-Library",
    };
  }
  private async json<T>(response: Response): Promise<T> {
    // Git trees contain at most 1000 files here; never parse a raw blob into a giant JSON string.
    if (!response.body) throw new AppError("GitHub 返回了无效结果", 502);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new AppError("GitHub 返回结果过大", 502);
        }
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("GitHub 返回了无效结果", 502);
    } finally {
      reader.releaseLock();
    }
  }
  private async request(
    endpoint: string,
    options: RequestInit & { duplex?: "half" } = {},
    allowMissing = false,
  ) {
    if (this.api === API && /^(POST|PATCH|PUT|DELETE)$/i.test(options.method || "GET"))
      await this.writePacer.wait();
    const token = await this.installationToken();
    const response = await this.fetcher(`${this.api}${endpoint}`, {
      ...options,
      headers: { ...this.headers(token), ...options.headers },
      cache: "no-store",
      redirect: "manual",
      signal: options.signal || AbortSignal.timeout(60_000),
    }).catch(() => {
      throw new AppError("暂时无法连接 GitHub，请稍后重试", 503);
    });
    if (allowMissing && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok && !(response.status >= 300 && response.status < 400)) {
      if (this.api === API && [403, 429].includes(response.status)) {
        const retrySeconds = Number(response.headers.get("retry-after"));
        const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
        const exhausted = response.headers.get("x-ratelimit-remaining") === "0";
        this.writePacer.deferUntil(
          Math.max(
            this.now() + 60_000,
            Number.isFinite(retrySeconds) && retrySeconds > 0
              ? this.now() + retrySeconds * 1000
              : 0,
            exhausted && Number.isFinite(reset) ? reset + 1000 : 0,
          ),
        );
      }
      await response.body?.cancel();
      if (response.status === 401) this.token = undefined;
      throw new AppError(
        response.status === 429 || response.status === 403
          ? "GitHub 暂时限流或授权不足，请稍后重试或联系管理员"
          : "GitHub 项目同步失败，请稍后重试",
        503,
      );
    }
    return response;
  }
  private repoEndpoint(projectId: string) {
    this.configurationCheck();
    return `/repos/${this.configuration.organization}/${githubRepositoryName(projectId)}`;
  }
  async createRepository(projectId: string) {
    const endpoint = this.repoEndpoint(projectId);
    const existing = await this.request(endpoint, {}, true);
    let repository: Repository;
    if (existing) repository = await this.json<Repository>(existing);
    else {
      const created = await this.request(`/orgs/${this.configuration.organization}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: githubRepositoryName(projectId),
          private: true,
          auto_init: true,
          description: `Managed by Zhiye project ${projectId}`,
          has_issues: false,
          has_projects: false,
          has_wiki: false,
        }),
      });
      repository = await this.json<Repository>(created!);
    }
    if (
      !repository.private ||
      repository.name !== githubRepositoryName(projectId) ||
      repository.description !== `Managed by Zhiye project ${projectId}` ||
      !/^[a-zA-Z0-9_./-]{1,200}$/.test(repository.default_branch)
    )
      throw new AppError("项目仓库权限或归属异常，请联系管理员", 503);
    return { name: repository.name, defaultBranch: repository.default_branch };
  }
  async publishSnapshot(projectId: string, taskId: string, sourceFiles: ProjectSourceFile[]) {
    if (!ID.test(taskId)) throw new AppError("同步任务标识无效");
    if (!sourceFiles.length || sourceFiles.length > PROJECT_MAX_ENTRIES)
      throw new AppError("项目文件数量无效");
    const files = [...sourceFiles].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const paths = new Set<string>();
    let total = 0;
    for (const file of files) {
      try {
        validateProjectPath(file.path);
      } catch {
        throw new AppError("项目路径无效");
      }
      if (
        excludedProjectPath(file.path) ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        paths.has(file.path.toLowerCase()) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        file.size > PROJECT_MAX_FILE_SIZE
      )
        throw new AppError("项目文件校验失败");
      paths.add(file.path.toLowerCase());
      total += file.size;
    }
    if (total > PROJECT_MAX_SIZE) throw new AppError("项目总量不能超过 200MB");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(files.map(({ path, size, sha256 }) => ({ path, size, sha256 }))))
      .digest("hex");
    const message = `Zhiye project upload ${taskId}\nSnapshot ${fingerprint}`;
    const repository = await this.createRepository(projectId);
    const endpoint = this.repoEndpoint(projectId);
    const taskRef = `heads/zhiye-task-${taskId}`;
    const already = await this.request(`${endpoint}/git/ref/${taskRef}`, {}, true);
    if (already) {
      const ref = await this.json<{ object: { sha: string } }>(already);
      assertCommit(ref.object.sha);
      const commit = await this.json<{ message: string }>(
        (await this.request(`${endpoint}/git/commits/${ref.object.sha}`))!,
      );
      if (commit.message !== message)
        throw new AppError("同步任务与远端版本不一致，请联系管理员", 503);
      return { commitSha: ref.object.sha, files: await this.listFiles(projectId, ref.object.sha) };
    }
    const head = await this.json<{ object: { sha: string } }>(
      (await this.request(`${endpoint}/git/ref/heads/${repository.defaultBranch}`))!,
    );
    assertCommit(head.object.sha);
    const remoteFiles: RemoteProjectFile[] = [];
    for (const file of files) {
      const info = await lstat(/* turbopackIgnore: true */ file.localPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size)
        throw new AppError("项目暂存文件校验失败");
      // Git objects are content-addressed. Reuse an already uploaded blob after a failed tree/
      // commit request, or when the next project version contains an unchanged source file.
      const expectedGitHash = createHash("sha1").update(Buffer.from(`blob ${file.size}\0`));
      const expectedSourceHash = createHash("sha256");
      let checkedSize = 0;
      for await (const chunk of createReadStream(/* turbopackIgnore: true */ file.localPath, {
        highWaterMark: 48 * 1024,
      })) {
        checkedSize += chunk.length;
        if (checkedSize > file.size) throw new AppError("项目暂存文件已变化");
        expectedGitHash.update(chunk);
        expectedSourceHash.update(chunk);
      }
      if (checkedSize !== file.size || expectedSourceHash.digest("hex") !== file.sha256)
        throw new AppError("项目暂存文件已变化");
      const expectedBlobSha = expectedGitHash.digest("hex");
      const reusable = await this.request(
        `${endpoint}/git/blobs/${expectedBlobSha}`,
        {
          headers: { Accept: "application/vnd.github.raw+json" },
        },
        true,
      );
      if (reusable) {
        await reusable.body?.cancel();
        if (reusable.status !== 200) throw new AppError("GitHub 文件校验失败", 502);
        remoteFiles.push({ path: file.path, size: file.size, sha: expectedBlobSha });
        continue;
      }
      let blobSha = "";
      const body = Readable.from(
        (async function* () {
          yield Buffer.from('{"encoding":"base64","content":"');
          const sha256 = createHash("sha256");
          const sha1 = createHash("sha1").update(Buffer.from(`blob ${file.size}\0`));
          let carry = Buffer.alloc(0);
          let actualSize = 0;
          // Only this one file's current chunk and two trailing bytes are in memory.
          for await (const chunk of createReadStream(/* turbopackIgnore: true */ file.localPath, {
            highWaterMark: 48 * 1024,
          })) {
            const buffer = chunk as Buffer;
            actualSize += buffer.length;
            sha256.update(buffer);
            sha1.update(buffer);
            if (actualSize > file.size) throw new AppError("项目暂存文件已变化");
            const combined = carry.length ? Buffer.concat([carry, buffer]) : buffer;
            const length = combined.length - (combined.length % 3);
            if (length) yield Buffer.from(combined.subarray(0, length).toString("base64"));
            carry = Buffer.from(combined.subarray(length));
          }
          if (actualSize !== file.size || sha256.digest("hex") !== file.sha256)
            throw new AppError("项目暂存文件已变化");
          if (carry.length) yield Buffer.from(carry.toString("base64"));
          blobSha = sha1.digest("hex");
          yield Buffer.from('"}');
        })(),
      );
      const response = await this.request(`${endpoint}/git/blobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(
            Buffer.byteLength('{"encoding":"base64","content":"') +
              4 * Math.ceil(file.size / 3) +
              2,
          ),
        },
        body: body as unknown as BodyInit,
        duplex: "half",
        signal: AbortSignal.timeout(600_000),
      });
      const blob = await this.json<{ sha: string }>(response!);
      if (!SHA.test(blob.sha) || blob.sha !== blobSha || blob.sha !== expectedBlobSha)
        throw new AppError("GitHub 文件校验失败", 502);
      remoteFiles.push({ path: file.path, size: file.size, sha: blob.sha });
    }
    const tree = await this.json<{ sha: string }>(
      (await this.request(`${endpoint}/git/trees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No base_tree: each uploaded version is a complete snapshot, including deletions.
        body: JSON.stringify({
          tree: remoteFiles.map((file) => ({
            path: file.path,
            mode: "100644",
            type: "blob",
            sha: file.sha,
          })),
        }),
      }))!,
    );
    assertCommit(tree.sha);
    const commit = await this.json<{ sha: string }>(
      (await this.request(`${endpoint}/git/commits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, tree: tree.sha, parents: [head.object.sha] }),
      }))!,
    );
    assertCommit(commit.sha);
    const taskReference = await this.request(`${endpoint}/git/refs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/${taskRef}`, sha: commit.sha }),
    });
    await taskReference?.body?.cancel();
    // Main is a convenience for organization owners; immutable task refs identify website versions.
    // The worker serializes updates, and a non-fast-forward rejection protects manual remote edits.
    const mainReference = await this.request(
      `${endpoint}/git/refs/heads/${repository.defaultBranch}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: commit.sha, force: false }),
      },
    );
    await mainReference?.body?.cancel();
    return { commitSha: commit.sha, files: remoteFiles };
  }
  async listFiles(projectId: string, commitSha: string): Promise<RemoteProjectFile[]> {
    assertCommit(commitSha);
    const result = await this.json<{
      truncated: boolean;
      tree: { path: string; type: string; mode: string; sha: string; size?: number }[];
    }>((await this.request(`${this.repoEndpoint(projectId)}/git/trees/${commitSha}?recursive=1`))!);
    if (
      result.truncated ||
      !Array.isArray(result.tree) ||
      result.tree.length > PROJECT_MAX_ENTRIES * 20
    )
      throw new AppError("项目文件目录过大或不完整", 502);
    const files: RemoteProjectFile[] = [];
    let total = 0;
    for (const file of result.tree) {
      if (file.type !== "blob") continue;
      try {
        validateProjectPath(file.path);
      } catch {
        throw new AppError("项目远端路径无效", 502);
      }
      if (
        file.mode !== "100644" ||
        excludedProjectPath(file.path) ||
        !SHA.test(file.sha) ||
        !Number.isSafeInteger(file.size) ||
        file.size! < 0 ||
        file.size! > PROJECT_MAX_FILE_SIZE
      )
        throw new AppError("项目远端文件无效", 502);
      total += file.size!;
      files.push({ path: file.path, size: file.size!, sha: file.sha });
    }
    if (total > PROJECT_MAX_SIZE || files.length > PROJECT_MAX_ENTRIES)
      throw new AppError("项目远端文件大小超过限制", 502);
    return files;
  }
  async readFile(projectId: string, commitSha: string, filePath: string) {
    try {
      validateProjectPath(filePath);
    } catch {
      throw new AppError("项目文件路径无效");
    }
    const file = (await this.listFiles(projectId, commitSha)).find(
      (item) => item.path === filePath,
    );
    if (!file) throw new AppError("项目文件不存在", 404);
    const response = await this.request(`${this.repoEndpoint(projectId)}/git/blobs/${file.sha}`, {
      headers: { Accept: "application/vnd.github.raw+json" },
      signal: AbortSignal.timeout(600_000),
    });
    if (!response?.body || response.status !== 200) throw new AppError("项目文件读取失败", 502);
    return response;
  }
  async downloadArchive(projectId: string, commitSha: string) {
    assertCommit(commitSha);
    const response = await this.request(`${this.repoEndpoint(projectId)}/zipball/${commitSha}`, {
      signal: AbortSignal.timeout(600_000),
    });
    if (response?.status === 200 && response.body) return response;
    const location = response?.headers.get("location");
    await response?.body?.cancel();
    if (!location) throw new AppError("项目下载暂时不可用", 502);
    let target: URL;
    try {
      target = new URL(location);
    } catch {
      throw new AppError("项目下载地址无效", 502);
    }
    const expectedPrefix = `/${this.configuration.organization}/${githubRepositoryName(projectId)}/`;
    if (
      target.protocol !== "https:" ||
      target.hostname !== "codeload.github.com" ||
      !target.pathname.toLowerCase().startsWith(expectedPrefix.toLowerCase()) ||
      !target.pathname.toLowerCase().endsWith(`/${commitSha}`) ||
      target.username ||
      target.password
    )
      throw new AppError("项目下载地址无效", 502);
    // A private archive's signed redirect is consumed only on the server, never returned to members.
    const archive = await this.fetcher(target, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(600_000),
    }).catch(() => {
      throw new AppError("项目下载暂时不可用", 503);
    });
    if (!archive.ok || !archive.body) {
      await archive.body?.cancel();
      throw new AppError("项目下载暂时不可用", 503);
    }
    return archive;
  }
}
