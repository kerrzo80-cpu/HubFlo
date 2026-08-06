import sharp from "sharp";

/** Bump when home-screen compose rules change so cached icons rebuild. */
export const APP_ICON_COMPOSE_VERSION = 4;
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
  /** Kept for API compatibility; v4 uses a full-bleed white canvas. */
  background?: string;
};

/**
 * Force artwork content into a true 1:1 square.
 * Tall crops are centre-clipped (not padded) so the mark does not look narrow.
 */
async function forceSquareContent(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png, { failOn: "none" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width || 0;
  const height = info.height || 0;
  if (!width || !height) return png;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (r > 245 && g > 245 && b > 245) continue;
      if (minX > x) minX = x;
      if (minY > y) minY = y;
      if (maxX < x) maxX = x;
      if (maxY < y) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return png;

  const contentW = maxX - minX + 1;
  const contentH = maxY - minY + 1;

  // Near-square / tall marks: centre-crop to 1:1 so they do not look narrow.
  // Very wide wordmarks: pad instead so text is not clipped.
  if (contentW / contentH > 1.25) {
    const side = Math.max(contentW, contentH);
    const padX = Math.floor((side - contentW) / 2);
    const padY = Math.floor((side - contentH) / 2);
    return sharp(png, { failOn: "none" })
      .extract({ left: minX, top: minY, width: contentW, height: contentH })
      .extend({
        top: padY,
        bottom: side - contentH - padY,
        left: padX,
        right: side - contentW - padX,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();
  }

  const side = Math.min(contentW, contentH);
  const left = minX + Math.floor((contentW - side) / 2);
  const top = minY + Math.floor((contentH - side) / 2);

  return sharp(png, { failOn: "none" })
    .extract({
      left: Math.max(0, left),
      top: Math.max(0, top),
      width: Math.min(side, width - left),
      height: Math.min(side, height - top),
    })
    .png()
    .toBuffer();
}

/**
 * Prefer the left-hand mark from a wide wordmark (droplet / monogram).
 * Falls back to null when the artwork is already square or has no clear mark.
 */
async function extractLeftMark(trimmedPng: Buffer): Promise<Buffer | null> {
  const { data, info } = await sharp(trimmedPng, { failOn: "none" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width || 0;
  const height = info.height || 0;
  if (width < 32 || height < 32) return null;

  // Only attempt mark extraction on clearly wide wordmarks.
  if (width / height < 1.35) return null;

  const mask = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      mask[y * width + x] = r > 245 && g > 245 && b > 245 ? 0 : 1;
    }
  }

  // Flood-fill from the left edge to isolate the mark (usually disconnected from text).
  const seen = Buffer.alloc(width * height);
  const queue: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < Math.min(12, width); x++) {
      const p = y * width + x;
      if (mask[p] && !seen[p]) {
        seen[p] = 1;
        queue.push(p);
      }
    }
  }

  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  let count = 0;
  while (queue.length) {
    const p = queue.pop()!;
    count += 1;
    const x = p % width;
    const y = (p - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const pp = yy * width + xx;
      if (!mask[pp] || seen[pp]) continue;
      seen[pp] = 1;
      queue.push(pp);
    }
  }

  if (count < 200) return null;

  // Cut at the mark frame's right stroke. Solid cyan columns form the left border,
  // then a hollow gap, then the right border — stop before later cyan wordmark letters.
  const spanH = maxY - minY + 1;
  const searchRight = Math.min(width - 1, minX + Math.round(height * 1.15));
  const solidCols: number[] = [];
  for (let x = minX; x <= searchRight; x++) {
    let colour = 0;
    for (let y = minY; y <= maxY; y++) {
      const i = (y * width + x) * 4;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (r > 245 && g > 245 && b > 245) continue;
      if (b > 160 && g > 120 && r < 200 && b >= r) colour += 1;
    }
    if (colour > spanH * 0.65) solidCols.push(x);
  }
  const solidRuns: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < solidCols.length; i++) {
    const start = solidCols[i]!;
    let end = start;
    while (i + 1 < solidCols.length && solidCols[i + 1]! - solidCols[i]! <= 3) {
      i += 1;
      end = solidCols[i]!;
    }
    solidRuns.push({ start, end });
  }
  // Prefer the last solid stroke that still sits inside a roughly-square mark.
  const markLimit = minX + Math.round(height * 1.05);
  let frameRight = -1;
  for (const run of solidRuns) {
    if (run.end <= markLimit) frameRight = run.end;
    else break;
  }
  if (frameRight >= 0 && frameRight - minX + 1 >= Math.round(height * 0.55)) {
    maxX = frameRight;
  } else if (solidRuns.length === 1 && solidRuns[0]!.end - minX + 1 >= Math.round(height * 0.55)) {
    maxX = solidRuns[0]!.end;
  } else {
    const minMarkWidth = Math.round(height * 0.55);
    while (maxX - minX + 1 > minMarkWidth) {
      let colCount = 0;
      for (let y = minY; y <= maxY; y++) {
        if (mask[y * width + maxX]) colCount += 1;
      }
      if (colCount > spanH * 0.2) break;
      maxX -= 1;
    }
  }

  const markW = maxX - minX + 1;
  const markH = maxY - minY + 1;
  const aspect = markW / markH;
  if (aspect < 0.65 || aspect > 1.35) return null;
  if (markW > width * 0.72) return null;

  // Crop to a square centred on the mark so the pipe frame stays 1:1.
  const side = Math.max(markW, markH);
  const centerX = minX + Math.floor(markW / 2);
  const centerY = minY + Math.floor(markH / 2);
  let left = Math.max(0, centerX - Math.floor(side / 2));
  let top = Math.max(0, centerY - Math.floor(side / 2));
  if (left + side > width) left = Math.max(0, width - side);
  if (top + side > height) top = Math.max(0, height - side);
  const extractSide = Math.min(side, width - left, height - top);

  return sharp(trimmedPng, { failOn: "none" })
    .extract({ left, top, width: extractSide, height: extractSide })
    .trim({ threshold: 12 })
    .png()
    .toBuffer();
}

/**
 * Build a proper iOS/Android home-screen icon:
 * full-bleed white + large centred mark (never stretched, no nested plate).
 * Wide wordmarks use the left mark when it can be isolated.
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

  const mark = await extractLeftMark(trimmed).catch(() => null);
  const artwork = await forceSquareContent(mark || trimmed);

  // Fill nearly the whole icon — the mark already has its own frame.
  const fitBox = Math.round(APP_ICON_SIZE * (mark ? 0.92 : 0.88));
  const fitted = await sharp(artwork, { failOn: "none" })
    .resize(fitBox, fitBox, {
      fit: "fill",
      withoutEnlargement: false,
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
