import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadPdfJsServer } from "@/lib/pdfjs-server";

describe("pdfjs-server", () => {
  it("loads pdfjs without pathToFileURL(moduleId) and can open a document", async () => {
    const pdfjs = await loadPdfJsServer();
    assert.equal(typeof pdfjs.getDocument, "function");
    // Minimal one-page blank PDF
    const minimalPdf = Buffer.from(
      "%PDF-1.1\n1 0 obj<<>>endobj\n2 0 obj<< /Length 0 >>stream\nendstream\nendobj\n3 0 obj<< /Type /Page /Parent 4 0 R /MediaBox [0 0 3 3] /Contents 2 0 R >>endobj\n4 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n5 0 obj<< /Type /Catalog /Pages 4 0 R >>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000024 00000 n \n0000000073 00000 n \n0000000156 00000 n \n0000000221 00000 n \ntrailer<< /Size 6 /Root 5 0 R >>\nstartxref\n288\n%%EOF\n",
    );
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(minimalPdf),
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise;
    assert.equal(doc.numPages, 1);
  });
});
