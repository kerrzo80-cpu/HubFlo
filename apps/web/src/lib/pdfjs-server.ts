/**
 * Load pdfjs-dist for Node / Next server routes.
 *
 * Do not use a plain `import("pdfjs-dist/…")` that Next can bundle: Turbopack /
 * webpack split pdfjs into `depth_pdf_*` server chunks whose relative imports
 * break on Render ("Cannot find module …/depth_pdf_erp_v3/chunk-…").
 *
 * Resolve the real node_modules files and import by file URL so the package
 * stays external (see also `serverExternalPackages` in next.config.ts).
 *
 * Never import this module from client components — it uses Node createRequire.
 *
 * Important: do not write `pathToFileURL(req.resolve("pdfjs-dist/…"))` with a
 * string-literal specifier. Turbopack constant-folds that resolve into a numeric
 * module id, producing `pathToFileURL(1454)` and:
 *   The "path" argument must be of type string. Received type number (1454)
 */

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export { friendlyPdfEngineError } from "@/lib/pdf-engine-errors";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type NodeRequire = ReturnType<typeof createRequire>;

let cached: Promise<PdfJsModule> | null = null;

function createPdfRequire() {
  // Prefer resolving from this module (avoids Turbopack NFT-tracing the whole repo
  // via path.join(process.cwd(), …)). Walks up to apps/web/node_modules on Render.
  try {
    const req = createRequire(import.meta.url);
    // Existence check only — keep the literal here; do not feed this result to pathToFileURL.
    req.resolve("pdfjs-dist/package.json");
    return req;
  } catch {
    // Fallback when the compiled chunk lives somewhere unexpected.
  }
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), "apps/web/package.json"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      const req = createRequire(candidate);
      req.resolve("pdfjs-dist/package.json");
      return req;
    } catch {
      // try next
    }
  }
  return createRequire(import.meta.url);
}

/** Runtime-only path resolve — argument must not be a static string literal. */
function resolvePdfJsFile(req: NodeRequire, ...parts: string[]): string {
  const pkgJson = req.resolve(["pdfjs-dist", "package.json"].join("/"));
  if (typeof pkgJson !== "string") {
    throw new Error(`pdfjs-dist package.json resolve returned ${typeof pkgJson}, expected a filesystem path`);
  }
  const absolute = path.join(path.dirname(pkgJson), ...parts);
  if (typeof absolute !== "string" || !absolute) {
    throw new Error("pdfjs-dist path join failed");
  }
  return absolute;
}

export async function loadPdfJsServer(): Promise<PdfJsModule> {
  if (!cached) {
    cached = (async () => {
      const req = createPdfRequire();
      const pdfPath = resolvePdfJsFile(req, "legacy", "build", "pdf.mjs");
      // webpackIgnore / turbopackIgnore: keep this as a real Node ESM import.
      const mod = (await import(
        /* webpackIgnore: true */
        /* turbopackIgnore: true */
        pathToFileURL(pdfPath).href
      )) as PdfJsModule;
      // Node disables real PDF workers (#isWorkerDisabled). Do not set workerSrc to a
      // resolved path — Turbopack previously rewrote that into pathToFileURL(<moduleId>).
      return mod;
    })().catch((error) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}
