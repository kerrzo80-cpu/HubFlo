import sharp from "sharp";

/** Bump when home-screen compose rules change so cached icons rebuild. */
export const APP_ICON_COMPOSE_VERSION = 3;
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
  /** Brand fill behind the logo plate (Personalising primary). */
  background?: string;
};

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
  // Prefer the last solid stroke that still sits inside a roughly-square mark
  // (left border → droplet fills → right border). Later strokes are wordmark letters.
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
    // Fallback: walk back while the column is only sparse anti-alias / text bleed.
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
  // Reject if flood-fill swallowed the wordmark or produced a strip.
  if (aspect < 0.65 || aspect > 1.35) return null;
  if (markW > width * 0.72) return null;

  const pad = Math.max(2, Math.round(Math.min(markW, markH) * 0.03));
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  // Bias pad left/top; keep the right edge tight so wordmark glyphs cannot bleed in.
  const extractW = Math.min(width - left, markW + pad);
  const extractH = Math.min(height - top, markH + pad * 2);

  // Extract the full rectangle (keeps the droplet inside the frame) then trim padding.
  return sharp(trimmedPng, { failOn: "none" })
    .extract({ left, top, width: extractW, height: extractH })
    .trim({ threshold: 12 })
    .png()
    .toBuffer();
}

/**
 * Build a proper iOS/Android home-screen icon:
 * full-bleed brand colour + square white plate + centred mark (never stretched).
 * Wide wordmarks use the left mark when it can be isolated.
 */
export async function ensureSquareAppIcon(
  input: Buffer,
  options: SquareAppIconOptions = {},
): Promise<{ buffer: Buffer; mimeType: string; composeVersion: number }> {
  const background = parseHexColor(options.background);

  let trimmed: Buffer;
  try {
    trimmed = await sharp(input, { failOn: "none" }).rotate().trim({ threshold: 18 }).png().toBuffer();
  } catch {
    trimmed = await sharp(input, { failOn: "none" }).rotate().png().toBuffer();
  }

  const mark = await extractLeftMark(trimmed).catch(() => null);
  const artwork = mark || trimmed;

  // Square white plate with a brand-coloured ring (reads as a native app icon).
  const margin = Math.round(APP_ICON_SIZE * 0.07);
  const plateSize = APP_ICON_SIZE - margin * 2;
  const plateLeft = margin;
  const plateTop = margin;
  const plateRadius = Math.round(plateSize * 0.21);
  const plateSvg = Buffer.from(
    `<svg width="${plateSize}" height="${plateSize}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${plateSize}" height="${plateSize}" rx="${plateRadius}" ry="${plateRadius}" fill="white"/>
    </svg>`,
  );

  const fitBox = Math.round(plateSize * (mark ? 0.78 : 0.84));
  const fitted = await sharp(artwork, { failOn: "none" })
    .resize(fitBox, fitBox, {
      fit: "inside",
      withoutEnlargement: false,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  const left = plateLeft + Math.max(0, Math.floor((plateSize - (fitted.info.width || fitBox)) / 2));
  const top = plateTop + Math.max(0, Math.floor((plateSize - (fitted.info.height || fitBox)) / 2));

  const buffer = await sharp({
    create: {
      width: APP_ICON_SIZE,
      height: APP_ICON_SIZE,
      channels: 3,
      background,
    },
  })
    .composite([
      { input: plateSvg, left: plateLeft, top: plateTop },
      { input: fitted.data, left, top },
    ])
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
