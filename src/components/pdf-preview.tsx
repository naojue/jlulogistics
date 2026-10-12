"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { PdfQuestions } from "@/components/pdf-questions";
export default function PdfPreview({
  url,
  name,
  resourceId,
  fileId,
}: {
  url: string;
  name: string;
  resourceId: string;
  fileId: string;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(600);
  const [rendered, setRendered] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let task: PDFDocumentLoadingTask | undefined;
    const controller = new AbortController();
    (async () => {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error((await response.json()).error || "无法读取 PDF");
      const bytes = await response.arrayBuffer();
      const pdfjs = await import("pdfjs-dist");
      if (controller.signal.aborted) return;
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
      task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        cMapUrl: "/vendor/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
        wasmUrl: "/vendor/pdfjs/wasm/",
      });
      task.onPassword = () => {
        setError("PDF 已加密，请下载后输入密码查看。");
        void task?.destroy();
      };
      const result = await task.promise;
      if (!controller.signal.aborted) setDocument(result);
    })().catch((error) => {
      if (!controller.signal.aborted)
        setError(
          error.message?.includes("审批") || error.message?.includes("登录")
            ? error.message
            : "PDF 无法预览，请下载后查看（文件可能损坏或已加密）。",
        );
    });
    return () => {
      controller.abort();
      void task?.destroy();
    };
  }, [url]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(100, Math.floor(entry.contentRect.width))),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let cancelled = false;
    let renderTask:
      ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    setRendered(false);
    (async () => {
      const page = await document.getPage(pageNumber);
      if (cancelled || !canvas.current) return;
      const original = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      let scale = (width / original.width) * zoom * ratio;
      scale = Math.min(scale, Math.sqrt(8_000_000 / (original.width * original.height)));
      const viewport = page.getViewport({ scale });
      const target = canvas.current;
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      target.style.width = `${viewport.width / ratio}px`;
      target.style.height = `${viewport.height / ratio}px`;
      renderTask = page.render({ canvas: target, viewport });
      await renderTask.promise;
      const content = await page.getTextContent();
      if (!cancelled) {
        setText(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
        setRendered(true);
      }
    })().catch((error) => {
      if (!cancelled && error.name !== "RenderingCancelledException")
        setError("本页预览失败，请下载后查看。");
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, width, zoom]);
  return (
    <div className="pdf-reader" ref={container}>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : (
        <>
          <div className="pdf-toolbar">
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={!document || pageNumber <= 1}
              onClick={() => setPageNumber((page) => page - 1)}
            >
              上一页
            </Button>
            <span>{document ? `${pageNumber} / ${document.numPages} 页` : "正在读取 PDF…"}</span>
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={!document || pageNumber >= document.numPages}
              onClick={() => setPageNumber((page) => page + 1)}
            >
              下一页
            </Button>
            <label>
              缩放
              <select
                aria-label="PDF 缩放"
                value={zoom}
                onChange={(event) => setZoom(Number(event.currentTarget.value))}
              >
                <option value={1}>适应宽度</option>
                <option value={1.5}>150%</option>
                <option value={2}>200%</option>
              </select>
            </label>
          </div>
          {!rendered && <p role="status">正在绘制页面…</p>}
          <div className="pdf-canvas-wrap">
            <canvas
              ref={canvas}
              role="img"
              aria-label={`${name} 第 ${pageNumber} 页`}
              data-rendered={rendered}
            />
          </div>
          {rendered && (
            <details>
              <summary>本页文字</summary>
              <p className="prose-text">{text || "本页是扫描图片，没有可提取的文字。"}</p>
            </details>
          )}
          {document && (
            <PdfQuestions
              resourceId={resourceId}
              fileId={fileId}
              page={pageNumber}
              onJump={(page) => {
                if (page >= 1 && page <= document.numPages) {
                  setPageNumber(page);
                  container.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
