/**
 * Server-only PDF stroke extraction (Blake).
 * Kept separate so takeoff-pdf-strokes pure helpers can ship to the browser
 * without pulling Node createRequire / pdfjs-server into the client bundle.
 */

import { loadPdfJsServer } from "@/lib/pdfjs-server";
import {
  extractPdfStrokeRunsWithEngine,
  type PdfStrokeExtractResult,
} from "@/lib/takeoff-pdf-strokes";

export async function extractPdfStrokeRuns(
  buffer: Buffer | Uint8Array,
  fileName: string,
  options?: { maxPages?: number },
): Promise<PdfStrokeExtractResult> {
  const pdfjs = await loadPdfJsServer();
  return extractPdfStrokeRunsWithEngine(pdfjs, buffer, fileName, options);
}
