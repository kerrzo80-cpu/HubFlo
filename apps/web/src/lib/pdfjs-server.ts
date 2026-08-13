/**
 * Load pdfjs-dist for Node / Next server routes.
 *
 * Do not use a plain `import("pdfjs-dist/…")` that Next can bundle: Turbopack /
 * webpack split pdfjs into `depth_pdf_*` server chunks whose relative imports
 * break on Render ("Cannot find module …/depth_pdf_erp_v3/chunk-…").
 *
 * Resolve the real node_modules files and import by file URL so the package
 * stays external (see also `serverExternalPackages` in next.config.ts).
 */

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let cached: Promise<PdfJsModule> | null = null;

function createPdfRequire() {
  const candidates = [
    // Render / monorepo: start from repo root with `next start apps/web`.
    path.join(process.cwd(), "apps/web/package.json"),
    // Local `pnpm --filter @hubflo/web` / cwd already apps/web.
    path.join(process.cwd(), "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      const req = createRequire(candidate);
      req.resolve("pdfjs-dist/legacy/build/pdf.mjs");
      return req;
    } catch {
      // try next
    }
  }
  return createRequire(import.meta.url);
}

export async function loadPdfJsServer(): Promise<PdfJsModule> {
  if (!cached) {
    cached = (async () => {
      const req = createPdfRequire();
      const pdfPath = req.resolve("pdfjs-dist/legacy/build/pdf.mjs");
      const workerPath = req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
      // webpackIgnore / turbopackIgnore: keep this as a real Node ESM import.
      const mod = (await import(
        /* webpackIgnore: true */
        /* turbopackIgnore: true */
        pathToFileURL(pdfPath).href
      )) as PdfJsModule;
      if (mod?.GlobalWorkerOptions) {
        mod.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
      }
      return mod;
    })().catch((error) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}

/** Map engine / bundling failures to a short office-facing message. */
export function friendlyPdfEngineError(error: unknown, fallback = "Could not read this PDF."): string {
  const msg = error instanceof Error ? error.message : String(error || fallback);
  if (
    /Cannot find module/i.test(msg)
    || /ERR_MODULE_NOT_FOUND/i.test(msg)
    || /depth_pdf/i.test(msg)
    || /pdf\.worker/i.test(msg)
  ) {
    return "Could not open this PDF (server PDF reader failed to load). Try again, or import Excel/CSV instead.";
  }
  return msg.trim() || fallback;
}
