import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { friendlyPdfEngineError } from "@/lib/pdf-engine-errors";

describe("pdf-engine-errors", () => {
  it("rewrites Cannot find module / depth_pdf bundling errors", () => {
    const msg = friendlyPdfEngineError(
      new Error(
        "Cannot find module '/opt/render/project/src/apps/web/.next/server/chunks/depth_pdf_erp_v3/chunk-UZE4Y.js' imported from '/opt/render/project/src/apps/web/.next/server/chunks/depth_pdf_erp_v3/index.js'",
      ),
    );
    assert.match(msg, /Could not open this PDF/i);
    assert.doesNotMatch(msg, /Cannot find module/i);
  });

  it("passes through ordinary parse errors", () => {
    const msg = friendlyPdfEngineError(new Error("This PDF has no selectable text (likely a scan)."));
    assert.match(msg, /no selectable text/i);
  });
});
