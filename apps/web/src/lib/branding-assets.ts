import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getServerStoreDirectory } from "@/lib/server-store";
import type { BrandAppLogoField } from "@/lib/branding";

export type BrandingAssetKind =
  | "logo"
  | "icon"
  | "logo-core"
  | "logo-field"
  | "logo-survey"
  | "logo-takeoffs"
  | "logo-heat-design";

export const BRANDING_ASSET_KINDS: BrandingAssetKind[] = [
  "logo",
  "icon",
  "logo-core",
  "logo-field",
  "logo-survey",
  "logo-takeoffs",
  "logo-heat-design",
];

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
};

function brandingDir() {
  const dir = path.join(getServerStoreDirectory(), "branding");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function extensionFor(fileName: string, mimeType: string) {
  const fromName = path.extname(fileName || "").toLowerCase();
  if (fromName && MIME_BY_EXT[fromName]) return fromName;
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("svg")) return ".svg";
  if (mimeType.includes("gif")) return ".gif";
  return ".png";
}

function metaPath(kind: BrandingAssetKind) {
  return path.join(brandingDir(), `${kind}.meta.json`);
}

export function asBrandingAssetKind(value: string): BrandingAssetKind | null {
  return (BRANDING_ASSET_KINDS as string[]).includes(value) ? (value as BrandingAssetKind) : null;
}

export function brandingAssetSettingsField(kind: BrandingAssetKind): "logoUrl" | "appIconUrl" | BrandAppLogoField {
  switch (kind) {
    case "logo":
      return "logoUrl";
    case "icon":
      return "appIconUrl";
    case "logo-core":
      return "coreLogoUrl";
    case "logo-field":
      return "fieldLogoUrl";
    case "logo-survey":
      return "surveyLogoUrl";
    case "logo-takeoffs":
      return "takeoffsLogoUrl";
    case "logo-heat-design":
      return "heatDesignLogoUrl";
    default:
      return "logoUrl";
  }
}

export function brandingAssetPublicPath(kind: BrandingAssetKind) {
  return `/api/branding/assets/${kind}`;
}

export function saveBrandingAsset(kind: BrandingAssetKind, file: { name: string; type: string; buffer: Buffer }) {
  const ext = extensionFor(file.name, file.type || "");
  const filePath = path.join(brandingDir(), `${kind}${ext}`);
  for (const candidate of Object.keys(MIME_BY_EXT)) {
    const previous = path.join(brandingDir(), `${kind}${candidate}`);
    if (previous !== filePath && existsSync(previous)) {
      try {
        unlinkSync(previous);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
  writeFileSync(filePath, file.buffer);
  writeFileSync(
    metaPath(kind),
    JSON.stringify({
      kind,
      fileName: `${kind}${ext}`,
      mimeType: MIME_BY_EXT[ext] || file.type || "application/octet-stream",
      updatedAt: new Date().toISOString(),
    }),
  );
  return {
    url: `${brandingAssetPublicPath(kind)}?v=${Date.now()}`,
    mimeType: MIME_BY_EXT[ext] || file.type || "application/octet-stream",
  };
}

export function readBrandingAsset(kind: BrandingAssetKind): { buffer: Buffer; mimeType: string } | null {
  const metaFile = metaPath(kind);
  if (existsSync(metaFile)) {
    try {
      const meta = JSON.parse(readFileSync(metaFile, "utf8")) as { fileName?: string; mimeType?: string };
      if (meta.fileName) {
        const filePath = path.join(brandingDir(), meta.fileName);
        if (existsSync(filePath)) {
          return {
            buffer: readFileSync(filePath),
            mimeType: meta.mimeType || MIME_BY_EXT[path.extname(meta.fileName).toLowerCase()] || "application/octet-stream",
          };
        }
      }
    } catch {
      // Fall through to extension scan.
    }
  }

  for (const ext of Object.keys(MIME_BY_EXT)) {
    const filePath = path.join(brandingDir(), `${kind}${ext}`);
    if (!existsSync(filePath)) continue;
    const buffer = readFileSync(filePath);
    if (!buffer.length) continue;
    return { buffer, mimeType: MIME_BY_EXT[ext] || "application/octet-stream" };
  }
  return null;
}
