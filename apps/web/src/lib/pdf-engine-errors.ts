/** Map PDF engine / bundling failures to a short office-facing message. */
export function friendlyPdfEngineError(error: unknown, fallback = "Could not read this PDF."): string {
  const msg = error instanceof Error ? error.message : String(error || fallback);
  if (
    /Cannot find module/i.test(msg)
    || /ERR_MODULE_NOT_FOUND/i.test(msg)
    || /depth_pdf/i.test(msg)
    || /pdf\.worker/i.test(msg)
    // Turbopack folded req.resolve("pdfjs-dist/…") into a module id → pathToFileURL(1454).
    || /"path" argument must be of type string/i.test(msg)
  ) {
    return "Could not open this PDF (server PDF reader failed to load). Try again, or import Excel/CSV instead.";
  }
  return msg.trim() || fallback;
}
