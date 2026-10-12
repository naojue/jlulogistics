import { unzipSync, strFromU8 } from "fflate";
export const MAX_PREVIEW_XML = 10 * 1024 * 1024;
export function archivePreview(data: Uint8Array, extension: string) {
  const entries: { name: string; size: number }[] = [];
  let expanded = 0;
  const contents = unzipSync(data, {
    filter(entry) {
      if (entries.length >= 1000) throw new Error("文件条目过多，请下载后查看");
      entries.push({ name: entry.name, size: entry.originalSize });
      const wanted =
        extension === "docx"
          ? entry.name === "word/document.xml"
          : extension === "pptx"
            ? /^ppt\/slides\/slide\d+\.xml$/.test(entry.name)
            : extension === "xlsx"
              ? /^(xl\/sharedStrings\.xml|xl\/workbook\.xml|xl\/worksheets\/sheet\d+\.xml)$/.test(
                  entry.name,
                )
              : false;
      if (wanted) {
        expanded += entry.originalSize;
        if (expanded > MAX_PREVIEW_XML) throw new Error("内容较大，无法在线预览，请下载后查看");
      }
      return wanted;
    },
  });
  return {
    entries,
    xml: Object.fromEntries(
      Object.entries(contents).map(([name, value]) => [name, strFromU8(value)]),
    ),
  };
}
