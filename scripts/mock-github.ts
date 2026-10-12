/** Loopback-only GitHub fixture for browser tests. No credentials or production repositories. */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { zipSync } from "fflate";

type TreeEntry = { path: string; mode: string; type: string; sha: string; size: number };
type Commit = { sha: string; message: string; tree: string; parents: string[] };
type Repository = {
  name: string;
  private: boolean;
  description: string;
  default_branch: string;
  blobs: Map<string, Buffer>;
  trees: Map<string, TreeEntry[]>;
  commits: Map<string, Commit>;
  refs: Map<string, string>;
};

export async function startMockGitHub(): Promise<{ url: string; close: () => Promise<void> }> {
  if (process.env.NODE_ENV === "production")
    throw new Error("GitHub fixture cannot run in production");
  const repositories = new Map<string, Repository>();
  const failures: { match: string; count: number; status: number }[] = [];
  let blobUploads = 0;
  function sha(input: string | Buffer) {
    return createHash("sha1").update(input).digest("hex");
  }
  function json(response: ServerResponse, status: number, value: unknown) {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(value));
  }
  async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 2 * 1024 * 1024) throw new Error("Only small fixtures are supported");
      chunks.push(bytes);
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  }
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
      const method = request.method || "GET";
      if (pathname === "/test/fail-next" && method === "POST") {
        const data = await body(request);
        failures.push({
          match: String(data.match || "/git/blobs"),
          count: Math.max(1, Number(data.count) || 1),
          status: Number(data.status) || 503,
        });
        return json(response, 200, { success: true });
      }
      if (pathname === "/test/stats")
        return json(response, 200, { repositories: repositories.size, blobUploads });
      const failure = failures.find((item) => item.count > 0 && pathname.includes(item.match));
      if (failure) {
        failure.count--;
        request.resume();
        return json(response, failure.status, { message: "Injected test failure" });
      }
      if (/^\/app\/installations\/\d+\/access_tokens$/.test(pathname) && method === "POST") {
        if (!request.headers.authorization?.startsWith("Bearer "))
          return json(response, 401, { message: "JWT required" });
        return json(response, 201, {
          token: "isolated-mock-installation-token",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        });
      }
      if (request.headers.authorization !== "Bearer isolated-mock-installation-token")
        return json(response, 401, { message: "Fixture token required" });
      const createMatch = pathname.match(/^\/orgs\/([^/]+)\/repos$/);
      if (createMatch && method === "POST") {
        const data = await body(request);
        const name = String(data.name);
        const key = `${createMatch[1]}/${name}`;
        if (repositories.has(key)) return json(response, 422, { message: "Repository exists" });
        const tree = sha("empty-tree");
        const initial = sha(`initial:${key}`);
        const repo: Repository = {
          name,
          private: data.private === true,
          description: String(data.description || ""),
          default_branch: "main",
          blobs: new Map(),
          trees: new Map([[tree, []]]),
          commits: new Map([
            [initial, { sha: initial, message: "Initial commit", tree, parents: [] }],
          ]),
          refs: new Map([["heads/main", initial]]),
        };
        repositories.set(key, repo);
        return json(response, 201, {
          name: repo.name,
          private: repo.private,
          description: repo.description,
          default_branch: repo.default_branch,
        });
      }
      const match = pathname.match(/^\/repos\/([^/]+)\/([^/]+)(.*)$/);
      if (!match) return json(response, 404, { message: "Unknown fixture endpoint" });
      const repo = repositories.get(`${match[1]}/${match[2]}`);
      const suffix = match[3];
      if (!repo) return json(response, 404, { message: "Repository missing" });
      if (!suffix && method === "GET")
        return json(response, 200, {
          name: repo.name,
          private: repo.private,
          description: repo.description,
          default_branch: repo.default_branch,
        });
      if (suffix.startsWith("/git/ref/") && method === "GET") {
        const ref = suffix.slice("/git/ref/".length);
        const commit = repo.refs.get(ref);
        return commit
          ? json(response, 200, { ref: `refs/${ref}`, object: { type: "commit", sha: commit } })
          : json(response, 404, { message: "Ref missing" });
      }
      if (suffix === "/git/blobs" && method === "POST") {
        const data = await body(request);
        const bytes = Buffer.from(
          String(data.content || ""),
          data.encoding === "base64" ? "base64" : "utf8",
        );
        const digest = createHash("sha1")
          .update(Buffer.from(`blob ${bytes.length}\0`))
          .update(bytes)
          .digest("hex");
        repo.blobs.set(digest, bytes);
        blobUploads++;
        return json(response, 201, { sha: digest });
      }
      if (suffix.startsWith("/git/blobs/") && method === "GET") {
        const digest = suffix.slice("/git/blobs/".length);
        const bytes = repo.blobs.get(digest);
        if (!bytes) return json(response, 404, { message: "Blob missing" });
        if (request.headers.accept?.includes("raw")) {
          response.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Length": bytes.length,
          });
          return response.end(bytes);
        }
        return json(response, 200, {
          sha: digest,
          size: bytes.length,
          encoding: "base64",
          content: bytes.toString("base64"),
        });
      }
      if (suffix === "/git/trees" && method === "POST") {
        const data = await body(request);
        const entries = data.tree as Omit<TreeEntry, "size">[];
        if (!Array.isArray(entries) || entries.some((entry) => !repo.blobs.has(entry.sha)))
          return json(response, 422, { message: "Blob missing" });
        const tree = entries.map((entry) => ({
          ...entry,
          size: repo.blobs.get(entry.sha)!.length,
        }));
        const digest = sha(JSON.stringify(tree));
        repo.trees.set(digest, tree);
        return json(response, 201, { sha: digest });
      }
      if (suffix.startsWith("/git/trees/") && method === "GET") {
        const digest = suffix.slice("/git/trees/".length);
        const tree = repo.trees.get(repo.commits.get(digest)?.tree || digest);
        return tree
          ? json(response, 200, { sha: digest, truncated: false, tree })
          : json(response, 404, { message: "Tree missing" });
      }
      if (suffix === "/git/commits" && method === "POST") {
        const data = await body(request);
        const tree = String(data.tree);
        const parents = (data.parents || []) as string[];
        if (!repo.trees.has(tree) || parents.some((parent) => !repo.commits.has(parent)))
          return json(response, 422, { message: "Commit input missing" });
        const digest = sha(JSON.stringify(data));
        const commit = { sha: digest, message: String(data.message), tree, parents };
        repo.commits.set(digest, commit);
        return json(response, 201, { sha: digest });
      }
      if (suffix.startsWith("/git/commits/") && method === "GET") {
        const commit = repo.commits.get(suffix.slice("/git/commits/".length));
        return commit
          ? json(response, 200, {
              sha: commit.sha,
              message: commit.message,
              tree: { sha: commit.tree },
              parents: commit.parents.map((parent) => ({ sha: parent })),
            })
          : json(response, 404, { message: "Commit missing" });
      }
      if (suffix === "/git/refs" && method === "POST") {
        const data = await body(request);
        const ref = String(data.ref).replace(/^refs\//, "");
        const digest = String(data.sha);
        if (repo.refs.has(ref) || !repo.commits.has(digest))
          return json(response, 422, { message: "Ref already exists or commit missing" });
        repo.refs.set(ref, digest);
        return json(response, 201, { ref: `refs/${ref}`, object: { sha: digest } });
      }
      if (suffix.startsWith("/git/refs/") && method === "PATCH") {
        const data = await body(request);
        const ref = suffix.slice("/git/refs/".length);
        const digest = String(data.sha);
        const commit = repo.commits.get(digest);
        if (!commit || (data.force !== true && !commit.parents.includes(repo.refs.get(ref) || "")))
          return json(response, 422, { message: "Non fast forward" });
        repo.refs.set(ref, digest);
        return json(response, 200, { ref: `refs/${ref}`, object: { sha: digest } });
      }
      if (suffix.startsWith("/zipball/") && method === "GET") {
        const commit = repo.commits.get(suffix.slice("/zipball/".length));
        const tree = commit && repo.trees.get(commit.tree);
        if (!tree) return json(response, 404, { message: "Version missing" });
        const entries: Record<string, Uint8Array> = {};
        for (const file of tree)
          entries[`${repo.name}-${commit!.sha.slice(0, 7)}/${file.path}`] = repo.blobs.get(
            file.sha,
          )!;
        const archive = zipSync(entries);
        response.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Length": archive.length,
        });
        return response.end(archive);
      }
      return json(response, 404, { message: "Unknown fixture endpoint" });
    })().catch(() => {
      if (!response.headersSent) json(response, 500, { message: "Fixture request failed" });
      else response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture listen failed");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
