import { expect, it } from "vitest";
import { readdir } from "node:fs/promises";
import { saveUpload, storage, MAX_FILE_SIZE } from "../src/services/storage";
function request(name: string, size: number, content?: string) {
  const form = new FormData();
  form.append("title", "测试资料");
  form.append("file", new Blob([content || new Uint8Array(size).fill(65)]), name);
  return new Request("http://127.0.0.1:3000/api/resources", { method: "POST", body: form });
}
it("恰好50MB允许保存，超过50MB拒绝并清理临时文件", async () => {
  const saved = await saveUpload(request("limit.txt", MAX_FILE_SIZE));
  expect(saved.file.size).toBe(MAX_FILE_SIZE);
  await storage.remove(saved.file.key);
  const before = await readdir("data/test-files");
  await expect(saveUpload(request("too-large.txt", MAX_FILE_SIZE + 1))).rejects.toThrow("50MB");
  expect(await readdir("data/test-files")).toEqual(before);
});
it("伪造扩展名被拒绝且不留下文件", async () => {
  const before = await readdir("data/test-files").catch(() => []);
  await expect(saveUpload(request("fake.pdf", 0, "<script>malicious</script>"))).rejects.toThrow(
    "扩展名",
  );
  expect(await readdir("data/test-files")).toEqual(before);
});
it("中文文件名在上传解析后保持原样", async () => {
  const saved = await saveUpload(request("学习笔记.txt", 0, "学习内容"));
  expect(saved.file.name).toBe("学习笔记.txt");
  await storage.remove(saved.file.key);
});
function images(sizes: number[], names = sizes.map((_, i) => `${i}.png`)) {
  const form = new FormData();
  sizes.forEach((size, index) => {
    const content = new Uint8Array(size).fill(65);
    content.set([137, 80, 78, 71, 13, 10, 26, 10]);
    form.append("file", new Blob([content]), names[index]);
  });
  return new Request("http://127.0.0.1:3000/api/resources", { method: "POST", body: form });
}
it("多图总量恰好50MB可保存，合计超限全部清理", async () => {
  const saved = await saveUpload(images([MAX_FILE_SIZE / 2, MAX_FILE_SIZE / 2]));
  expect(saved.files).toHaveLength(2);
  expect(saved.files.reduce((total, file) => total + file.size, 0)).toBe(MAX_FILE_SIZE);
  await Promise.all(saved.files.map((file) => storage.remove(file.key)));
  const before = await readdir("data/test-files");
  await expect(saveUpload(images([MAX_FILE_SIZE / 2, MAX_FILE_SIZE / 2 + 1]))).rejects.toThrow(
    "50MB",
  );
  expect(await readdir("data/test-files")).toEqual(before);
});
it("混合文档、多余图片和伪造路径均拒绝并清理所有上传", async () => {
  const before = await readdir("data/test-files");
  const mixed = new FormData();
  mixed.append("file", new Blob(["hello"]), "note.txt");
  mixed.append("file", new Blob(["world"]), "other.txt");
  await expect(
    saveUpload(new Request("http://localhost/api/resources", { method: "POST", body: mixed })),
  ).rejects.toThrow("多文件");
  await expect(saveUpload(images(Array(21).fill(10)))).rejects.toThrow("20");
  await expect(saveUpload(images([10], ["../escape.png"]))).rejects.toThrow("文件名");
  expect(await readdir("data/test-files")).toEqual(before);
});
it("图片专用入口拒绝文档，可选图片为空时允许纯文本", async () => {
  await expect(saveUpload(request("note.txt", 0, "hello"), { imagesOnly: true })).rejects.toThrow(
    "讨论只能",
  );
  const form = new FormData();
  form.append("body", "一条没有图片的留言");
  form.append("file", new Blob([]), "");
  const saved = await saveUpload(
    new Request("http://localhost/api/posts", { method: "POST", body: form }),
    { imagesOnly: true, allowEmpty: true },
  );
  expect(saved.files).toEqual([]);
});
