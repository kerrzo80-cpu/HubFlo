import type { ExtractedPdfDocument, ExtractedPdfPage } from "@/lib/takeoff-pdf-extract";

const MAX_PAGES = 25;

/** Browser-side PDF text extract — same bytes Studio already opens for drawing. */
export async function extractTakeoffPdfInBrowser(
  projectId: string,
  documentId: string,
  fileName: string,
): Promise<ExtractedPdfDocument> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const response = await fetch(
    `/api/takeoff-projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/file`,
    { credentials: "include", cache: "no-store" },
  );
  if (response.status === 404) {
    throw new Error("PDF file is missing from storage. Re-upload the drawing, then try Ask Blake again.");
  }
  if (!response.ok) {
    throw new Error(`Unable to open drawing for Blake (${response.status}).`);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength < 8) {
    throw new Error("Uploaded drawing file is empty. Re-upload the PDF.");
  }

  const pdf = await pdfjs.getDocument({ data, isOffscreenCanvasSupported: false }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);
  const pages: ExtractedPdfPage[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const textItems = [];
    for (const item of textContent.items) {
      if (!item || typeof item !== "object" || !("str" in item)) continue;
      const row = item as {
        str?: string;
        transform?: number[];
        width?: number;
        height?: number;
      };
      const text = String(row.str || "").trim();
      if (!text) continue;
      const transform = row.transform || [1, 0, 0, 1, 0, 0];
      textItems.push({
        text,
        x: Number(transform[4]) || 0,
        y: Number(transform[5]) || 0,
        width: Number(row.width) || Math.max(6, text.length * 4),
        height: Number(row.height) || 10,
      });
    }
    const fullText = textItems.map((item) => item.text).join(" ");
    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      textItems,
      fullText,
      hasSelectableText: textItems.length >= 8,
    });
  }

  return { fileName, pageCount: pdf.numPages, pages };
}
