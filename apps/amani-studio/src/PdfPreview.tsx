import { useEffect, useRef, useState } from "react";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
export function PdfPreview({ base64 }: { base64: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  useEffect(() => {
    let disposed = false;
    let destroy: (() => void) | undefined;
    setReady(false);
    setError("");
    (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const task = pdfjs.getDocument({
        data: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
        isEvalSupported: false,
        useSystemFonts: true,
      });
      destroy = () => {
        void task.destroy().catch(() => {});
      };
      const doc = await task.promise;
      if (disposed) return;
      setPages(doc.numPages);
      const p = await doc.getPage(Math.min(page, doc.numPages));
      if (disposed || !canvas.current) return;
      const size = p.getViewport({ scale: 1 });
      const width = Math.max(300, (container.current?.clientWidth ?? 600) - 36);
      const scale = width / size.width;
      const viewport = p.getViewport({
        scale: scale * Math.min(devicePixelRatio, 2),
      });
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      canvas.current.style.width = `${width}px`;
      canvas.current.style.height = `${size.height * scale}px`;
      await p.render({ canvas: canvas.current, viewport }).promise;
      if (!disposed) setReady(true);
    })().catch((e) => {
      if (!disposed)
        setError("PDF preview unavailable: " + String(e.message ?? e));
    });
    return () => {
      disposed = true;
      destroy?.();
    };
  }, [base64, page]);
  return (
    <div className="pdf-renderer" ref={container}>
      <div className="pdf-controls">
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Previous page
        </button>
        <span>
          Page {page} / {pages}
        </span>
        <button disabled={page === pages} onClick={() => setPage((p) => p + 1)}>
          Next page
        </button>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          <canvas
            ref={canvas}
            role="img"
            aria-label={`Rendered paper PDF, page ${page}`}
            data-rendered={ready}
          />
          {!ready && <p role="status">Rendering PDF…</p>}
        </>
      )}
    </div>
  );
}
