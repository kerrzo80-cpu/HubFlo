import sharp from "sharp";

/** Bump when home-screen compose rules change so cached icons rebuild. */
export const APP_ICON_COMPOSE_VERSION = 5;
const APP_ICON_SIZE = 512;

export function isAppIconAssetKind(kind: string): boolean {
  return kind === "icon" || kind.startsWith("logo-");
}

function parseHexColor(value: string | undefined): { r: number; g: number; b: number } {
  const cleaned = String(value || "#157fa8").replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return { r: 21, g: 127, b: 168 };
  return {
    r: Number.parseInt(cleaned.slice(0, 2), 16),
    g: Number.parseInt(cleaned.slice(2, 4), 16),
    b: Number.parseInt(cleaned.slice(4, 6), 16),
  };
}

export type SquareAppIconOptions = {
  /** Kept for API compatibility; canvas is always full-bleed white. */
  background?: string;
};

/**
 * Pad trimmed artwork into a true 1:1 square on white.
 * Keeps the full wordmark — never crops to the left-hand droplet mark
 * (that mark reads as the old NeXa icon next to an "EWG Core" title).
 */
async function padToSquare(png: Buffer): Promise<Buffer> {
  const meta = await sharp(png, { failOn: "none" }).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) return png;
  if (width === height) return png;

  const side = Math.max(width, height);
  const padX = Math.floor((side - width) / 2);
  const padY = Math.floor((side - height) / 2);
  return sharp(png, { failOn: "none" })
    .extend({
      top: padY,
      bottom: side - height - padY,
      left: padX,
      right: side - width - padX,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();
}

/**
 * Build a proper iOS/Android home-screen icon:
 * full-bleed white + large centred owner wordmark (never stretched, no droplet crop).
 */
export async function ensureSquareAppIcon(
  input: Buffer,
  _options: SquareAppIconOptions = {},
): Promise<{ buffer: Buffer; mimeType: string; composeVersion: number }> {
  void parseHexColor(_options.background);

  let trimmed: Buffer;
  try {
    trimmed = await sharp(input, { failOn: "none" }).rotate().trim({ threshold: 18 }).png().toBuffer();
  } catch {
    trimmed = await sharp(input, { failOn: "none" }).rotate().png().toBuffer();
  }

  const artwork = await padToSquare(trimmed);

  // Fit inside so wide wordmarks stay readable and undistorted.
  const fitBox = Math.round(APP_ICON_SIZE * 0.9);
  const fitted = await sharp(artwork, { failOn: "none" })
    .resize(fitBox, fitBox, {
      fit: "inside",
      withoutEnlargement: false,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  const left = Math.max(0, Math.floor((APP_ICON_SIZE - (fitted.info.width || fitBox)) / 2));
  const top = Math.max(0, Math.floor((APP_ICON_SIZE - (fitted.info.height || fitBox)) / 2));

  const buffer = await sharp({
    create: {
      width: APP_ICON_SIZE,
      height: APP_ICON_SIZE,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: fitted.data, left, top }])
    .png()
    .toBuffer();

  return {
    buffer,
    mimeType: "image/png",
    composeVersion: APP_ICON_COMPOSE_VERSION,
  };
}

/** 180×180 apple-touch derivative from a square icon. */
export async function toAppleTouchIcon(squarePng: Buffer): Promise<Buffer> {
  return sharp(squarePng, { failOn: "none" }).resize(180, 180, { fit: "fill" }).png().toBuffer();
}
