import { readFile } from "node:fs/promises";
import path from "node:path";

export type ExtractedPdfTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ExtractedPdfPage = {
  pageNumber: number;
  width: number;
  height: number;
  textItems: ExtractedPdfTextItem[];
  fullText: string;
  hasSelectableText: boolean;
};

export type ExtractedPdfDocument = {
  fileName: string;
  pageCount: number;
  pages: ExtractedPdfPage[];
};

async function loadPdfJs() {
  // Prefer legacy build for Node/server routes.
  const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return mod;
}

export async function extractPdfDocument(buffer: Buffer, fileName: string): Promise<ExtractedPdfDocument> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pages: ExtractedPdfPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const textItems: ExtractedPdfTextItem[] = [];
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

  return {
    fileName,
    pageCount: pdf.numPages,
    pages,
  };
}

export async function extractPdfFromPath(filePath: string, fileName: string): Promise<ExtractedPdfDocument | null> {
  try {
    const buffer = await readFile(filePath);
    return await extractPdfDocument(buffer, fileName);
  } catch {
    return null;
  }
}

export function countTextTagMatches(
  pages: ExtractedPdfPage[],
  patterns: RegExp[],
): {
  count: number;
  matches: Array<{ pageNumber: number; text: string; x: number; y: number }>;
} {
  const matches: Array<{ pageNumber: number; text: string; x: number; y: number }> = [];
  for (const page of pages) {
    for (const item of page.textItems) {
      if (patterns.some((pattern) => pattern.test(item.text))) {
        matches.push({
          pageNumber: page.pageNumber,
          text: item.text,
          x: item.x,
          y: item.y,
        });
      }
    }
  }
  return { count: matches.length, matches };
}

export function inferDisciplineFromText(fileName: string, sampleText: string): string {
  const hay = `${fileName} ${sampleText}`.toLowerCase();
  if (/elec|lighting|socket|db-|cable tray|containment/.test(hay)) return "Electrical";
  if (/plumb|sanitary|hot water|cold water|soil|waste|basin|wc/.test(hay)) return "Plumbing";
  if (/heat|radiator|boiler|ufh|mechanical|hvac|flue/.test(hay)) return "Mechanical";
  if (/struct|footing|slab|rebar|concrete|steel/.test(hay)) return "Structural";
  if (/arch|general arrangement|ga |floor plan|room schedule/.test(hay)) return "Architectural";
  if (/drain|manhole|paving|civil/.test(hay)) return "Civil";
  return "General";
}

export function patternsForAssemblyCode(code: string, description: string): RegExp[] {
  const patterns: RegExp[] = [];
  const lower = `${code} ${description}`.toLowerCase();
  if (/rad|emitter/.test(lower)) patterns.push(/\bR\d+\b/i, /\brad(iator)?\b/i, /\bTRV\b/i);
  if (/sanit|basin|wc|bath|shower/.test(lower)) patterns.push(/\bWC\b/i, /\bWHB\b/i, /\bbasin\b/i, /\bbath\b/i, /\bSHR\b/i);
  if (/outlet|socket|power/.test(lower)) patterns.push(/\bSSO\b/i, /\bGPO\b/i, /\bsocket\b/i, /\b13A\b/i);
  if (/light|fitting|luminaire/.test(lower)) patterns.push(/\bL\d+\b/i, /\bLED\b/i, /\bluminaire\b/i);
  if (/footing|pad|pile/.test(lower)) patterns.push(/\bF\d+\b/i, /\bPAD\b/i, /\bFTG\b/i, /\bfooting\b/i);
  if (/boiler|plant/.test(lower)) patterns.push(/\bboiler\b/i, /\bASHP\b/i, /\bplant\b/i);
  if (/stack|soil/.test(lower)) patterns.push(/\bSVP\b/i, /\bstack\b/i, /\bsoil\b/i);
  if (/manhole|ic\b|chamber/.test(lower)) patterns.push(/\bMH\d*\b/i, /\bIC\d*\b/i, /\bmanhole\b/i);
  if (!patterns.length) {
    const tokens = description
      .split(/[^a-zA-Z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .slice(0, 3);
    for (const token of tokens) {
      patterns.push(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
    }
  }
  return patterns;
}

export function resolveStoredFilePath(storeDir: string, storageKey?: string) {
  if (!storageKey) return null;
  return path.join(storeDir, storageKey);
}
