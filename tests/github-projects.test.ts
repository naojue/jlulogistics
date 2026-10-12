import { expect, it, vi } from "vitest";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { GitHubProjectStore } from "../src/services/github-projects";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const config = { organization: "zhiye-test", appId: "123", installationId: "456", privateKey };
const head = "a".repeat(40);
const noWait = { wait: async () => {}, deferUntil: () => {} };
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function mockGithub() {
  let repositoryExists = false;
  let tokens = 0;
  let commits = 0;
  let blobs = 0;
  let trees = 0;
  let streamBodies = 0;
  const refs = new Map<string, string>([["heads/main", head]]);
  const treeFiles = new Map<
    string,
    { path: string; type: string; mode: string; sha: string; size: number }[]
  >();
  const commitObjects = new Map<string, { message: string; tree: string }>();
  const blobContents = new Map<string, Buffer>();
  const repository = {
    name: "zhiye-project-project1",
    private: true,
    description: "Managed by Zhiye project project1",
    default_branch: "main",
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const url = new URL(String(input));
    const endpoint = url.pathname;
    const method = options.method || "GET";
    if (endpoint === "/app/installations/456/access_tokens") {
      tokens++;
      const authorization = new Headers(options.headers).get("Authorization")!;
      const claims = JSON.parse(Buffer.from(authorization.split(".")[1], "base64url").toString());
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
      expect(claims.iss).toBe("123");
      return json(
        {
          token: "test-installation-token",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
        201,
      );
    }
    expect(new Headers(options.headers).get("Authorization")).toBe(
      "Bearer test-installation-token",
    );
    if (endpoint === "/repos/zhiye-test/zhiye-project-project1")
      return repositoryExists ? json(repository) : json({}, 404);
    if (endpoint === "/orgs/zhiye-test/repos") {
      expect(JSON.parse(options.body as string).private).toBe(true);
      repositoryExists = true;
      return json(repository, 201);
    }
    if (endpoint.includes("/git/ref/")) {
      const ref = endpoint.split("/git/ref/")[1];
      return refs.has(ref) ? json({ object: { sha: refs.get(ref) } }) : json({}, 404);
    }
    if (endpoint.endsWith("/git/blobs")) {
      blobs++;
      expect(options.body).toBeInstanceOf(Readable);
      expect((options as RequestInit & { duplex: string }).duplex).toBe("half");
      const buffers: Buffer[] = [];
      for await (const chunk of options.body as unknown as Readable) buffers.push(chunk as Buffer);
      streamBodies += buffers.length;
      const body = JSON.parse(Buffer.concat(buffers).toString());
      expect(body.encoding).toBe("base64");
      const bytes = Buffer.from(body.content, "base64");
      const sha = createHash("sha1")
        .update(Buffer.from(`blob ${bytes.length}\0`))
        .update(bytes)
        .digest("hex");
      blobContents.set(sha, bytes);
      return json({ sha }, 201);
    }
    if (endpoint.endsWith("/git/trees") && method === "POST") {
      trees++;
      const body = JSON.parse(options.body as string);
      expect(body.base_tree).toBeUndefined();
      const sha = createHash("sha1")
        .update(options.body as string)
        .digest("hex");
      treeFiles.set(
        sha,
        body.tree.map((file: { path: string; sha: string }) => ({
          ...file,
          size: blobContents.get(file.sha)!.length,
        })),
      );
      return json({ sha }, 201);
    }
    if (endpoint.endsWith("/git/commits") && method === "POST") {
      commits++;
      const body = JSON.parse(options.body as string);
      const sha = createHash("sha1")
        .update(options.body as string)
        .digest("hex");
      commitObjects.set(sha, body);
      return json({ sha }, 201);
    }
    if (endpoint.includes("/git/commits/"))
      return json(commitObjects.get(endpoint.split("/git/commits/")[1]));
    if (endpoint.endsWith("/git/refs") && method === "POST") {
      const body = JSON.parse(options.body as string);
      refs.set(body.ref.replace(/^refs\//, ""), body.sha);
      return json({ object: { sha: body.sha } }, 201);
    }
    if (endpoint.includes("/git/refs/heads/") && method === "PATCH") {
      const body = JSON.parse(options.body as string);
      refs.set("heads/main", body.sha);
      expect(body.force).toBe(false);
      return json({ object: { sha: body.sha } });
    }
    if (endpoint.includes("/git/trees/") && method === "GET") {
      const sha = endpoint.split("/git/trees/")[1];
      const tree = commitObjects.get(sha)?.tree || sha;
      return json({ truncated: false, tree: treeFiles.get(tree) });
    }
    if (endpoint.includes("/git/blobs/")) {
      const bytes = blobContents.get(endpoint.split("/git/blobs/")[1]);
      return bytes ? new Response(bytes as unknown as BodyInit) : json({}, 404);
    }
    throw new Error(`Unexpected test endpoint ${endpoint}`);
  });
  return {
    fetcher: fetcher as typeof fetch,
    stats: () => ({ tokens, commits, blobs, trees, streamBodies }),
    repository,
  };
}

it("私有仓库、逐文件流式blob与完整版本发布；重复任务不会再次上传或创建commit", async () => {
  await mkdir("data", { recursive: true });
  const directory = await mkdtemp(path.resolve("data/test-github-project-"));
  try {
    const content = Buffer.alloc(128 * 1024 + 1, 65);
    const localPath = path.join(directory, "source.dat");
    await writeFile(localPath, content);
    const files = [
      {
        path: "src/main.py",
        size: content.length,
        localPath,
        sha256: createHash("sha256").update(content).digest("hex"),
      },
    ];
    const mock = mockGithub();
    const store = new GitHubProjectStore(config, mock.fetcher, Date.now, noWait);
    const published = await store.publishSnapshot("project1", "task1", files);
    expect(published.files[0]).toMatchObject({ path: "src/main.py", size: content.length });
    const repeated = await store.publishSnapshot("project1", "task1", files);
    expect(repeated).toEqual(published);
    expect(mock.stats()).toMatchObject({ tokens: 1, commits: 1, blobs: 1, trees: 1 });
    expect(mock.stats().streamBodies).toBeGreaterThan(2);
    expect(
      Buffer.from(
        await (await store.readFile("project1", published.commitSha, "src/main.py")).arrayBuffer(),
      ),
    ).toEqual(content);
    await expect(store.readFile("project1", published.commitSha, "other.py")).rejects.toThrow(
      "不存在",
    );
    const changed = [{ ...files[0], path: "src/new.py" }];
    await expect(store.publishSnapshot("project1", "task1", changed)).rejects.toThrow("不一致");
    const next = await store.publishSnapshot("project1", "task2", changed);
    expect((await store.listFiles("project1", next.commitSha)).map((file) => file.path)).toEqual([
      "src/new.py",
    ]);
    expect(mock.stats()).toMatchObject({ commits: 2, blobs: 1 });
  } finally {
    expect(path.dirname(directory)).toBe(path.resolve("data"));
    await rm(directory, { recursive: true, force: true });
  }
});
it("配置缺失不会联网，公开或不同归属的仓库不能承接项目", async () => {
  const noFetch = vi.fn();
  await expect(
    new GitHubProjectStore(
      { organization: "", appId: "", installationId: "" },
      noFetch,
      Date.now,
      noWait,
    ).createRepository("project1"),
  ).rejects.toThrow("尚未连接");
  expect(noFetch).not.toHaveBeenCalled();
  const mock = mockGithub();
  const store = new GitHubProjectStore(config, mock.fetcher, Date.now, noWait);
  await store.createRepository("project1");
  mock.repository.private = false;
  await expect(store.createRepository("project1")).rejects.toThrow("权限或归属");
  await expect(store.createRepository("../other-owner")).rejects.toThrow("标识");
  await expect(store.listFiles("project1", "main")).rejects.toThrow("版本");
});
it("凭据及GitHub错误详情不进入返回信息，私有archive重定向只在服务端读取", async () => {
  const calls: { input: string; authorization: string | null }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const url = String(input);
    calls.push({ input: url, authorization: new Headers(options.headers).get("Authorization") });
    if (url.includes("/access_tokens"))
      return json({
        token: "private-token",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    if (url.includes("api.github.com"))
      return new Response(null, {
        status: 302,
        headers: {
          Location:
            "https://codeload.github.com/zhiye-test/zhiye-project-project1/legacy.zip/" +
            head +
            "?token=signed-archive-secret",
        },
      });
    return new Response("zip-bytes");
  });
  const store = new GitHubProjectStore(config, fetcher, Date.now, noWait);
  const response = await store.downloadArchive("project1", head);
  expect(await response.text()).toBe("zip-bytes");
  expect(calls.at(-1)?.authorization).toBeNull();
  expect(response.headers.get("Location")).toBeNull();
  const bad = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes("/access_tokens")
      ? json({ token: "private-token", expires_at: new Date(Date.now() + 3_600_000).toISOString() })
      : new Response(null, {
          status: 302,
          headers: { Location: "https://attacker.example/steal" },
        }),
  );
  await expect(
    new GitHubProjectStore(config, bad, Date.now, noWait).downloadArchive("project1", head),
  ).rejects.toThrow("地址无效");
});
it("GitHub限流按响应Retry-After和重置时间推迟后续写入，不泄漏远端详情", async () => {
  const now = Date.now();
  const pacer = { wait: vi.fn(async () => {}), deferUntil: vi.fn() };
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes("/access_tokens")
      ? json({ token: "private-token", expires_at: new Date(now + 3_600_000).toISOString() })
      : new Response("private remote error details", {
          status: 429,
          headers: {
            "Retry-After": "300",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.floor((now + 180_000) / 1000)),
          },
        }),
  );
  const store = new GitHubProjectStore(config, fetcher, () => now, pacer);
  await expect(store.createRepository("project1")).rejects.toThrow("暂时限流");
  expect(pacer.deferUntil).toHaveBeenCalledWith(now + 300_000);
});
