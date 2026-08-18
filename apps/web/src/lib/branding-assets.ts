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
  | "logo-heat-design"
  | "logo-trainer";

export const BRANDING_ASSET_KINDS: BrandingAssetKind[] = [
  "logo",
  "icon",
  "logo-core",
  "logo-field",
  "logo-survey",
  "logo-takeoffs",
  "logo-heat-design",
  "logo-trainer",
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

function homeIconPath(kind: BrandingAssetKind) {
  return path.join(brandingDir(), `${kind}.home.png`);
}

function homeMetaPath(kind: BrandingAssetKind) {
  return path.join(brandingDir(), `${kind}.home.meta.json`);
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
    case "logo-trainer":
      return "trainerLogoUrl";
    default:
      return "logoUrl";
  }
}

export function brandingAssetPublicPath(kind: BrandingAssetKind) {
  return `/api/branding/assets/${kind}`;
}

export type BrandingAssetMeta = {
  kind: BrandingAssetKind;
  fileName: string;
  mimeType: string;
  updatedAt: string;
  composeVersion?: number;
};

export type HomeIconMeta = {
  composeVersion: number;
  updatedAt: string;
  sourceUpdatedAt?: string;
};

export function readBrandingAssetMeta(kind: BrandingAssetKind): BrandingAssetMeta | null {
  const metaFile = metaPath(kind);
  if (!existsSync(metaFile)) return null;
  try {
    return JSON.parse(readFileSync(metaFile, "utf8")) as BrandingAssetMeta;
  } catch {
    return null;
  }
}

export function saveBrandingAsset(
  kind: BrandingAssetKind,
  file: { name: string; type: string; buffer: Buffer },
  extraMeta?: { composeVersion?: number },
) {
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
  const meta: BrandingAssetMeta = {
    kind,
    fileName: `${kind}${ext}`,
    mimeType: MIME_BY_EXT[ext] || file.type || "application/octet-stream",
    updatedAt: new Date().toISOString(),
    ...(typeof extraMeta?.composeVersion === "number" ? { composeVersion: extraMeta.composeVersion } : {}),
  };
  writeFileSync(metaPath(kind), JSON.stringify(meta));

  // Source changed — drop any cached home-screen derivative.
  try {
    if (existsSync(homeIconPath(kind))) unlinkSync(homeIconPath(kind));
    if (existsSync(homeMetaPath(kind))) unlinkSync(homeMetaPath(kind));
  } catch {
    // Best-effort.
  }

  return {
    url: `${brandingAssetPublicPath(kind)}?v=${Date.now()}`,
    mimeType: meta.mimeType,
  };
}

export function readBrandingAsset(kind: BrandingAssetKind): { buffer: Buffer; mimeType: string } | null {
  const meta = readBrandingAssetMeta(kind);
  if (meta?.fileName) {
    const filePath = path.join(brandingDir(), meta.fileName);
    if (existsSync(filePath)) {
      return {
        buffer: readFileSync(filePath),
        mimeType: meta.mimeType || MIME_BY_EXT[path.extname(meta.fileName).toLowerCase()] || "application/octet-stream",
      };
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

export function readHomeIconAsset(
  kind: BrandingAssetKind,
  expectedComposeVersion: number,
): { buffer: Buffer; mimeType: string } | null {
  const filePath = homeIconPath(kind);
  const metaFile = homeMetaPath(kind);
  if (!existsSync(filePath) || !existsSync(metaFile)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaFile, "utf8")) as HomeIconMeta;
    if (meta.composeVersion !== expectedComposeVersion) return null;
    const sourceMeta = readBrandingAssetMeta(kind);
    if (sourceMeta?.updatedAt && meta.sourceUpdatedAt && meta.sourceUpdatedAt !== sourceMeta.updatedAt) {
      return null;
    }
    return { buffer: readFileSync(filePath), mimeType: "image/png" };
  } catch {
    return null;
  }
}

export function saveHomeIconAsset(
  kind: BrandingAssetKind,
  buffer: Buffer,
  composeVersion: number,
) {
  const sourceMeta = readBrandingAssetMeta(kind);
  writeFileSync(homeIconPath(kind), buffer);
  const meta: HomeIconMeta = {
    composeVersion,
    updatedAt: new Date().toISOString(),
    sourceUpdatedAt: sourceMeta?.updatedAt,
  };
  writeFileSync(homeMetaPath(kind), JSON.stringify(meta));
}
