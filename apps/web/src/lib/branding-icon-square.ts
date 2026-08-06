import sharp from "sharp";

const APP_ICON_SIZE = 512;

export function isAppIconAssetKind(kind: string): boolean {
  return kind === "icon" || kind.startsWith("logo-");
}

/** Build a true 512×512 PNG home-screen icon without stretching the artwork. */
export async function ensureSquareAppIcon(
  input: Buffer,
): Promise<{ buffer: Buffer; mimeType: string; changed: boolean }> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { failOn: "none" }).rotate().metadata();
  } catch {
    return { buffer: input, mimeType: "application/octet-stream", changed: false };
  }

  const width = meta.width || 0;
  const height = meta.height || 0;
  if (width === APP_ICON_SIZE && height === APP_ICON_SIZE && meta.format === "png") {
    return { buffer: input, mimeType: "image/png", changed: false };
  }

  const fitBox = Math.round(APP_ICON_SIZE * 0.86);
  const fitted = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(fitBox, fitBox, {
      fit: "inside",
      withoutEnlargement: false,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
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

  return { buffer, mimeType: "image/png", changed: true };
}
