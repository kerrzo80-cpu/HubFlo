import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, type PDFFont, type PDFImage } from "pdf-lib";

import { readBrandingAsset } from "@/lib/branding-assets";

export function safePdfText(value: unknown) {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E£°]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatPdfMoney(value: number) {
  if (!Number.isFinite(value)) return "TBC";
  return value.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

export function wrapPdfText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = safePdfText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

async function embedDataUrl(pdf: PDFDocument, value?: string): Promise<PDFImage | undefined> {
  if (!value?.startsWith("data:image/")) return undefined;
  try {
    const match = value.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
    if (!match?.[1] || !match[2]) return undefined;
    const bytes = Buffer.from(match[2], "base64");
    return /png/i.test(match[1]) ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
  } catch {
    return undefined;
  }
}

async function embedLogoBytes(pdf: PDFDocument, buffer: Buffer, mimeType: string): Promise<PDFImage | undefined> {
  try {
    if (mimeType.includes("png")) return pdf.embedPng(buffer);
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return pdf.embedJpg(buffer);
    try {
      return await pdf.embedPng(buffer);
    } catch {
      return pdf.embedJpg(buffer);
    }
  } catch {
    return undefined;
  }
}

export async function embedCompanyLogo(pdf: PDFDocument, logoUrl: string): Promise<PDFImage | undefined> {
  if (!logoUrl) return undefined;
  if (logoUrl.startsWith("data:image/")) return embedDataUrl(pdf, logoUrl);

  const clean = (logoUrl.split("?")[0] || logoUrl).trim();
  if (clean.startsWith("/api/branding/assets/")) {
    const kind = clean.includes("/icon") ? "icon" : "logo";
    const asset = readBrandingAsset(kind === "icon" ? "icon" : "logo") || readBrandingAsset("logo");
    if (asset) return embedLogoBytes(pdf, asset.buffer, asset.mimeType);
  }

  if (clean.startsWith("/")) {
    const relative = clean.replace(/^\//, "");
    const candidates = [
      path.join(process.cwd(), "public", relative),
      path.join(process.cwd(), "apps", "web", "public", relative),
    ];
    const file = candidates.find((candidate) => existsSync(candidate));
    if (file) {
      const buffer = readFileSync(file);
      const lower = file.toLowerCase();
      return embedLogoBytes(
        pdf,
        buffer,
        lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : "image/png",
      );
    }
  }

  const uploaded = readBrandingAsset("logo");
  if (uploaded) return embedLogoBytes(pdf, uploaded.buffer, uploaded.mimeType);

  const candidates = [
    path.join(process.cwd(), "public", "ewg-logo.png"),
    path.join(process.cwd(), "apps", "web", "public", "ewg-logo.png"),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) return undefined;
  try {
    return pdf.embedPng(readFileSync(file));
  } catch {
    return undefined;
  }
}
