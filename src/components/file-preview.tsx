"use client";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { isImage, fileExtension } from "@/lib/files";
import { fileSize } from "@/lib/utils";
import dynamic from "next/dynamic";
const PdfPreview = dynamic(() => import("@/components/pdf-preview"), {
  ssr: false,
  loading: () => <p role="status">正在加载 PDF 阅读器…</p>,
});
type FileInfo = { id: string; name: string; mime: string; size: number };
type Preview = {
  text?: string;
  sections?: { title: string; lines?: string[]; rows?: string[][] }[];
  entries?: { name: string; size: number }[];
};
function xmlDocument(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("文件内容无效，请下载后查看");
  const result = new DOMParser().parseFromString(xml, "application/xml");
  if (result.getElementsByTagName("parsererror").length)
    throw new Error("文档格式无效，请下载后查看");
  return result;
}
function nodes(element: Document | Element, tag: string) {
  return Array.from(element.getElementsByTagNameNS("*", tag));
}
function text(element: Document | Element) {
  return nodes(element, "t")
    .map((node) => node.textContent || "")
    .join("");
}
async function contentPreview(buffer: ArrayBuffer, extension: string): Promise<Preview> {
  if (["txt", "md"].includes(extension)) {
    const bytes = new Uint8Array(buffer).subarray(0, 1024 * 1024);
    let value: string;
    try {
      value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      value = new TextDecoder("gb18030").decode(bytes);
    }
    return {
      text: value + (buffer.byteLength > bytes.length ? "\n\n仅预览前 1MB，完整内容请下载。" : ""),
    };
  }
  const { archivePreview } = await import("@/lib/archive-preview");
  const { entries, xml } = archivePreview(new Uint8Array(buffer), extension);
  if (extension === "zip") return { entries };
  if (extension === "docx") {
    if (!xml["word/document.xml"]) throw new Error("未找到 Word 正文，请下载后查看");
    const doc = xmlDocument(xml["word/document.xml"]);
    const body = nodes(doc, "body")[0];
    if (!body) throw new Error("未找到 Word 正文");
    return {
      sections: Array.from(body.children)
        .slice(0, 1000)
        .flatMap<NonNullable<Preview["sections"]>[number]>((element) =>
          element.localName === "tbl"
            ? [
                {
                  title: "表格",
                  rows: nodes(element, "tr")
                    .slice(0, 200)
                    .map((row) =>
                      Array.from(row.children)
                        .filter((cell) => cell.localName === "tc")
                        .slice(0, 100)
                        .map(text),
                    ),
                },
              ]
            : element.localName === "p"
              ? [{ title: "", lines: [text(element)] }]
              : [],
        ),
    };
  }
  if (extension === "pptx") {
    const slides = Object.keys(xml).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    if (!slides.length) throw new Error("未找到幻灯片，请下载后查看");
    return {
      sections: slides.slice(0, 200).map((name, index) => ({
        title: `第 ${index + 1} 页`,
        lines: nodes(xmlDocument(xml[name]), "p").map(text).filter(Boolean),
      })),
    };
  }
  const shared = xml["xl/sharedStrings.xml"]
    ? nodes(xmlDocument(xml["xl/sharedStrings.xml"]), "si").map(text)
    : [];
  const names = xml["xl/workbook.xml"]
    ? nodes(xmlDocument(xml["xl/workbook.xml"]), "sheet").map(
        (sheet) => sheet.getAttribute("name") || "工作表",
      )
    : [];
  const sheets = Object.keys(xml)
    .filter((name) => name.startsWith("xl/worksheets/"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!sheets.length) throw new Error("未找到工作表，请下载后查看");
  return {
    sections: sheets.slice(0, 20).map((name, index) => ({
      title: names[index] || `工作表 ${index + 1}`,
      rows: nodes(xmlDocument(xml[name]), "row")
        .slice(0, 200)
        .map((row) => {
          const cells: string[] = [];
          for (const cell of nodes(row, "c")) {
            const ref = cell.getAttribute("r")?.match(/^[A-Z]+/)?.[0] || "";
            const column = ref
              ? Array.from(ref).reduce(
                  (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
                  0,
                ) - 1
              : cells.length;
            if (column >= 100) continue;
            while (cells.length <= column) cells.push("");
            const value = nodes(cell, "v")[0]?.textContent || "";
            cells[column] =
              cell.getAttribute("t") === "s"
                ? shared[Number(value)] || ""
                : cell.getAttribute("t") === "inlineStr"
                  ? text(cell)
                  : value;
          }
          return cells;
        }),
    })),
  };
}
function Content({ file, url, resourceId }: { file: FileInfo; url: string; resourceId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const extension = fileExtension(file.name);
  const direct = isImage(file.mime) || extension === "pdf";
  const supported = ["txt", "md", "docx", "xlsx", "pptx", "zip"].includes(extension);
  useEffect(() => {
    if (direct || !supported) return;
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error || "无法读取文件");
        return contentPreview(await response.arrayBuffer(), extension);
      })
      .then((result) => {
        if (!controller.signal.aborted) setPreview(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message || "预览失败，请下载后查看");
      });
    return () => controller.abort();
  }, [url, extension, direct, supported]);
  if (error)
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );
  if (isImage(file.mime))
    return (
      <img
        className="resource-image"
        src={url}
        alt={file.name}
        onError={() => setError("图片无法读取，请刷新或联系管理员")}
      />
    );
  if (extension === "pdf")
    return <PdfPreview url={url} name={file.name} resourceId={resourceId} fileId={file.id} />;
  if (!supported)
    return (
      <p className="muted">
        旧版 {extension.toUpperCase()} 暂不支持在线内容预览。可下载查看，或转换成 PDF / DOCX / XLSX
        / PPTX 后重新发布。
      </p>
    );
  if (error)
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );
  if (!preview) return <p role="status">正在读取预览…</p>;
  return (
    <div className="content-preview">
      {preview.text !== undefined && <pre>{preview.text}</pre>}
      {preview.sections && (
        <>
          <p className="muted">
            内容预览：保留文字和表格；图表、图片、排版及公式格式以原文件为准。最多显示 200
            页幻灯片、20 个工作表、每表 200 行和 100 列，Word 最多 1000 段。
          </p>
          {preview.sections.map((section, index) => (
            <section key={index}>
              {section.title && <h3>{section.title}</h3>}
              {section.lines?.map((line, i) => (
                <p className="prose-text" key={i}>
                  {line}
                </p>
              ))}
              {section.rows && (
                <div className="preview-table">
                  <table>
                    <tbody>
                      {section.rows.map((row, r) => (
                        <tr key={r}>
                          {row.map((cell, c) => (
                            <td key={c}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </>
      )}
      {preview.entries && (
        <>
          <p className="muted">ZIP 文件目录（仅展示目录，不展开其中的文件）</p>
          <ul>
            {preview.entries.map((entry, index) => (
              <li key={index}>
                {entry.name} · {fileSize(entry.size)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
export function FilePreview({ resourceId, files }: { resourceId: string; files: FileInfo[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="file-list">
      {files.map((file, index) => {
        const query = index ? `?fileId=${encodeURIComponent(file.id)}` : "";
        return (
          <section className="file-card" key={file.id}>
            <div className="file-card-heading">
              <div className="file-info">
                <strong>{file.name}</strong>
                <small>{fileSize(file.size)}</small>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelected(selected === file.id ? null : file.id)}
              >
                {selected === file.id ? "收起预览" : "预览"}
              </Button>
              <Button asChild size="sm">
                <a href={`/api/resources/${resourceId}/download${query}`}>
                  {files.length === 1 ? "下载资料" : "下载图片"}
                </a>
              </Button>
            </div>
            {selected === file.id && (
              <Content
                key={file.id}
                file={file}
                resourceId={resourceId}
                url={`/api/resources/${resourceId}/preview${query}`}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
