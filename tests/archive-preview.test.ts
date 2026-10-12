import { it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { archivePreview, MAX_PREVIEW_XML } from "../src/lib/archive-preview";
it("ZIP 只列目录，Office 只读取所需 XML，不加载脚本和嵌入文件", () => {
  const archive = zipSync({
    "word/document.xml": strToU8("<document>测试正文</document>"),
    "word/media/huge.png": new Uint8Array(1024),
    "../script.html": strToU8("<script>alert(1)</script>"),
  });
  expect(archivePreview(archive, "zip").entries).toHaveLength(3);
  expect(archivePreview(archive, "zip").xml).toEqual({});
  expect(Object.keys(archivePreview(archive, "docx").xml)).toEqual(["word/document.xml"]);
});
it("压缩包解压后的 XML 超限也拒绝，损坏文件不产生伪预览", () => {
  const archive = zipSync({ "word/document.xml": new Uint8Array(MAX_PREVIEW_XML + 1) });
  expect(() => archivePreview(archive, "docx")).toThrow("较大");
  expect(() => archivePreview(strToU8("broken"), "docx")).toThrow();
});
