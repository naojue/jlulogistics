import { beforeEach, afterEach, expect, it } from "vitest";
import path from "node:path";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { zipSync, strToU8, Zip, ZipDeflate } from "fflate";
import { Readable } from "node:stream";
import {
  saveProjectUpload,
  prepareProjectUpload,
  cleanupProjectUpload,
  cleanupOrphanProjectUploads,
} from "../src/services/project-storage";
import { PROJECT_MAX_SIZE } from "../src/lib/project-limits";

let temporaryRoot: string;
let previousRoot: string | undefined;
beforeEach(async () => {
  await mkdir("data", { recursive: true });
  temporaryRoot = await mkdtemp(path.resolve("data/test-project-storage-"));
  previousRoot = process.env.PROJECT_TEMP_DIR;
  process.env.PROJECT_TEMP_DIR = temporaryRoot;
});
afterEach(async () => {
  if (previousRoot === undefined) delete process.env.PROJECT_TEMP_DIR;
  else process.env.PROJECT_TEMP_DIR = previousRoot;
  expect(path.dirname(temporaryRoot)).toBe(path.resolve("data"));
  await rm(temporaryRoot, { recursive: true, force: true });
});
function upload(content: Uint8Array, name = "project.zip") {
  const form = new FormData();
  form.append("title", "路径规划项目");
  form.append("file", new Blob([content as BlobPart]), name);
  return new Request("http://localhost/api/projects", { method: "POST", body: form });
}
function centralOffsets(bytes: Uint8Array) {
  const positions: number[] = [];
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < buffer.length - 4; i++)
    if (buffer.readUInt32LE(i) === 0x02014b50) positions.push(i);
  return positions;
}
it("逐文件导入源码，排除密钥和工作流，排除内容仍计入总量，准备结果可以重用", async () => {
  const zip = zipSync({
    "项目/README.md": strToU8("项目说明"),
    "项目/main.py": strToU8("print('hello')"),
    "项目/.env.local": strToU8("secret=password"),
    "项目/node_modules/pkg/index.js": strToU8("dependency"),
    "项目/.github/workflows/run.yml": strToU8("run: malicious"),
  });
  const saved = await saveProjectUpload(upload(zip));
  expect(saved.fields.title).toBe("路径规划项目");
  const prepared = await prepareProjectUpload(saved.key);
  expect(prepared.files.map((file) => file.path)).toEqual(["项目/main.py", "项目/README.md"]);
  expect(prepared.excludedCount).toBe(3);
  expect(prepared.totalSize).toBe(
    Object.values({
      a: "项目说明",
      b: "print('hello')",
      c: "secret=password",
      d: "dependency",
      e: "run: malicious",
    }).reduce((sum, text) => sum + strToU8(text).length, 0),
  );
  for (const file of prepared.files)
    expect((await readFile(file.localPath)).length).toBe(file.size);
  expect(await prepareProjectUpload(saved.key)).toEqual(prepared);
  await cleanupProjectUpload(saved.key);
  expect(await readdir(temporaryRoot)).toEqual([]);
});
it("常见包管理器、Git及云服务凭据文件不会导入，但仍计入展开体积", async () => {
  const paths = [
    ".npmrc",
    "nested/.pypirc",
    ".netrc",
    ".git-credentials",
    ".yarnrc.yml",
    ".aws/config",
    ".ssh/config",
    ".kube/config",
  ];
  const contents = Object.fromEntries(
    paths.map((name) => [name, strToU8("credential-placeholder")]),
  );
  const saved = await saveProjectUpload(
    upload(zipSync({ ...contents, "main.py": strToU8("print(1)") })),
  );
  const prepared = await prepareProjectUpload(saved.key);
  expect(prepared.files.map((file) => file.path)).toEqual(["main.py"]);
  expect(prepared.excludedCount).toBe(paths.length);
  expect(prepared.totalSize).toBe(
    paths.length * strToU8("credential-placeholder").length + strToU8("print(1)").length,
  );
  await cleanupProjectUpload(saved.key);
});
it("跨进程目录预留限制两个待处理包，第三个请求不能挤占临时空间", async () => {
  const content = zipSync({ "main.py": strToU8("print(1)") });
  const [first, second] = await Promise.all([
    saveProjectUpload(upload(content)),
    saveProjectUpload(upload(content)),
  ]);
  await expect(saveProjectUpload(upload(content))).rejects.toThrow("待处理项目已满");
  await cleanupProjectUpload(first.key);
  const third = await saveProjectUpload(upload(content));
  await cleanupProjectUpload(second.key);
  await cleanupProjectUpload(third.key);
});
it("崩溃留下的过期孤儿暂存会清理，数据库仍引用的任务保留", async () => {
  const content = zipSync({ "main.py": strToU8("print(1)") });
  const registered = await saveProjectUpload(upload(content));
  const orphan = await saveProjectUpload(upload(content));
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
  await utimes(path.join(temporaryRoot, registered.key), old, old);
  await utimes(path.join(temporaryRoot, orphan.key), old, old);
  await cleanupOrphanProjectUploads([registered.key]);
  expect(await readdir(temporaryRoot)).toEqual([registered.key]);
  await cleanupProjectUpload(registered.key);
});
it("重启后的部分解包目录和未完成manifest会安全重建", async () => {
  const saved = await saveProjectUpload(
    upload(zipSync({ "src/main.py": strToU8("print('complete')") })),
  );
  const directory = path.join(temporaryRoot, saved.key);
  await mkdir(path.join(directory, "files"));
  await writeFile(path.join(directory, "files", "0001.dat"), "partial");
  await writeFile(path.join(directory, "prepared.json.tmp"), '{"files":');
  const recovered = await prepareProjectUpload(saved.key);
  expect(await readFile(recovered.files[0].localPath, "utf8")).toBe("print('complete')");
  expect(JSON.parse(await readFile(path.join(directory, "prepared.json"), "utf8"))).toEqual(
    recovered,
  );
  expect(await readdir(directory)).not.toContain("prepared.json.tmp");
  await cleanupProjectUpload(saved.key);
});
it("损坏manifest、越界缓存路径及同大小内容篡改均从原ZIP重新校验恢复", async () => {
  const original = "print('correct')";
  const saved = await saveProjectUpload(upload(zipSync({ "src/main.py": strToU8(original) })));
  const manifest = path.join(temporaryRoot, saved.key, "prepared.json");
  const first = await prepareProjectUpload(saved.key);
  await writeFile(manifest, '{"files":');
  expect(await prepareProjectUpload(saved.key)).toEqual(first);
  await writeFile(
    manifest,
    JSON.stringify({
      ...first,
      files: [{ ...first.files[0], localPath: path.resolve("package.json") }],
    }),
  );
  expect(await prepareProjectUpload(saved.key)).toEqual(first);
  await writeFile(first.files[0].localPath, "x".repeat(Buffer.byteLength(original)));
  const repaired = await prepareProjectUpload(saved.key);
  expect(await readFile(repaired.files[0].localPath, "utf8")).toBe(original);
  expect(repaired).toEqual(first);
  await cleanupProjectUpload(saved.key);
});
it("路径穿越、反斜杠、大小写重复路径及符号链接均拒绝并清理", async () => {
  const archives = [
    zipSync({ "../escape.py": strToU8("bad") }),
    zipSync({ "dir\\file.py": strToU8("bad") }),
    zipSync({ "README.md": strToU8("a"), "readme.md": strToU8("b") }),
    zipSync({ link: strToU8("/etc/passwd") }),
  ];
  const link = Buffer.from(archives[3]);
  link.writeUInt32LE((0xa1ff << 16) >>> 0, centralOffsets(link)[0] + 38);
  archives[3] = link;
  for (const archive of archives) {
    const saved = await saveProjectUpload(upload(archive));
    await expect(prepareProjectUpload(saved.key)).rejects.toThrow(/路径|符号链接|安全/);
    expect(await readdir(temporaryRoot)).toEqual([]);
  }
});
it("损坏CRC、加密标记、声明超限与超过1000条目拒绝且清理", async () => {
  const original = zipSync({ "main.py": strToU8("print(1)") });
  const badCrc = Buffer.from(original);
  badCrc.writeUInt32LE(0, centralOffsets(badCrc)[0] + 16);
  const encrypted = Buffer.from(original);
  encrypted.writeUInt16LE(
    encrypted.readUInt16LE(centralOffsets(encrypted)[0] + 8) | 1,
    centralOffsets(encrypted)[0] + 8,
  );
  const oversized = Buffer.from(original);
  oversized.writeUInt32LE(100 * 1024 * 1024 + 1, centralOffsets(oversized)[0] + 24);
  const many = zipSync(
    Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`${i}.txt`, strToU8("a")])),
  );
  for (const archive of [badCrc, encrypted, oversized, many]) {
    const saved = await saveProjectUpload(upload(archive));
    await expect(prepareProjectUpload(saved.key)).rejects.toThrow();
    expect(await readdir(temporaryRoot)).toEqual([]);
  }
});
function streamedUpload(size: number) {
  const source = Readable.from(
    (async function* () {
      yield Buffer.from(
        '--boundary\r\nContent-Disposition: form-data; name="file"; filename="large.zip"\r\nContent-Type: application/zip\r\n\r\n',
      );
      const chunk = Buffer.alloc(64 * 1024, 65);
      chunk.writeUInt32LE(0x04034b50, 0);
      yield chunk.subarray(0, Math.min(size, chunk.length));
      const payload = Buffer.alloc(64 * 1024, 65);
      for (let sent = chunk.length; sent < size; sent += payload.length)
        yield payload.subarray(0, Math.min(payload.length, size - sent));
      yield Buffer.from("\r\n--boundary--\r\n");
    })(),
  );
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=boundary" },
    body: Readable.toWeb(source) as ReadableStream<Uint8Array>,
    duplex: "half",
  } as RequestInit);
}
it("压缩包按实际接收字节限制200MB，恰好允许，多一字节拒绝并清理", async () => {
  const saved = await saveProjectUpload(streamedUpload(PROJECT_MAX_SIZE));
  expect(saved.size).toBe(PROJECT_MAX_SIZE);
  await cleanupProjectUpload(saved.key);
  await expect(saveProjectUpload(streamedUpload(PROJECT_MAX_SIZE + 1))).rejects.toThrow("200MB");
  expect(await readdir(temporaryRoot)).toEqual([]);
}, 40_000);
it("逐文件解压实际总量恰好200MB允许，额外排除的密钥内容也不能绕过总量", async () => {
  function archive(extra: boolean) {
    const output: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => {
      if (error) throw error;
      output.push(chunk);
    });
    const payload = new Uint8Array(64 * 1024).fill(65);
    for (const name of ["one.dat", "two.dat"]) {
      const file = new ZipDeflate(name, { level: 1 });
      zip.add(file);
      for (let sent = 0; sent < PROJECT_MAX_SIZE / 2; sent += payload.length)
        file.push(payload, false);
      file.push(new Uint8Array(), true);
    }
    if (extra) {
      const file = new ZipDeflate(".env");
      zip.add(file);
      file.push(strToU8("x"), true);
    }
    zip.end();
    return Buffer.concat(output);
  }
  const good = await saveProjectUpload(upload(archive(false)));
  const prepared = await prepareProjectUpload(good.key);
  expect(prepared.totalSize).toBe(PROJECT_MAX_SIZE);
  expect(prepared.files).toHaveLength(2);
  await cleanupProjectUpload(good.key);
  const bad = await saveProjectUpload(upload(archive(true)));
  await expect(prepareProjectUpload(bad.key)).rejects.toThrow("200MB");
  expect(await readdir(temporaryRoot)).toEqual([]);
}, 40_000);
it("不能用公开文件目录、伪造暂存key或多个ZIP绕过限制", async () => {
  await expect(cleanupProjectUpload("../private")).rejects.toThrow("地址");
  const form = new FormData();
  const content = zipSync({ "file.py": strToU8("print(1)") });
  form.append("file", new Blob([content]), "one.zip");
  form.append("file", new Blob([content]), "two.zip");
  await expect(
    saveProjectUpload(new Request("http://localhost", { method: "POST", body: form })),
  ).rejects.toThrow("一个");
  expect(await readdir(temporaryRoot)).toEqual([]);
});
