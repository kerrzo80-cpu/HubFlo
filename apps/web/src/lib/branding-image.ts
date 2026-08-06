/** Client-side prepare for Personalising logo / icon uploads — trim padding and build square app icons. */

const APP_ICON_SIZE = 512;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image. Try PNG or JPG."));
    };
    image.src = url;
  });
}

function contentBounds(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const { data } = ctx.getImageData(0, 0, width, height);
  let top = height;
  let left = width;
  let right = 0;
  let bottom = 0;
  let found = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3] ?? 0;
      const red = data[i] ?? 0;
      const green = data[i + 1] ?? 0;
      const blue = data[i + 2] ?? 0;
      // Transparent or near-white = empty padding.
      const empty = alpha < 10 || (alpha > 200 && red > 248 && green > 248 && blue > 248);
      if (empty) continue;
      found = true;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (!found || right < left || bottom < top) {
    return { x: 0, y: 0, width, height };
  }

  const padX = Math.max(2, Math.round((right - left + 1) * 0.03));
  const padY = Math.max(2, Math.round((bottom - top + 1) * 0.03));
  const x = Math.max(0, left - padX);
  const y = Math.max(0, top - padY);
  const w = Math.min(width - x, right - left + 1 + padX * 2);
  const h = Math.min(height - y, bottom - top + 1 + padY * 2);
  return { x, y, width: w, height: h };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Could not prepare image for upload."));
        else resolve(blob);
      },
      type,
      quality,
    );
  });
}

export type PrepareBrandingImageOptions = {
  /** Longest edge after prepare (company logos). */
  maxEdge?: number;
  /** Build a true square home-screen icon (never stretched). */
  square?: boolean;
  /** Canvas fill under the artwork. JPEG always needs a solid fill. */
  background?: "transparent" | "white";
};

/** Trim empty padding, resize, and for app icons emit a true 512×512 PNG. */
export async function prepareBrandingImage(file: File, options: PrepareBrandingImageOptions = {}): Promise<File> {
  if (typeof window === "undefined") return file;
  if (!file.type.startsWith("image/")) {
    throw new Error("Upload a PNG, JPG or WEBP image.");
  }
  if (file.type.includes("svg")) return file;

  const image = await loadImage(file);
  const source = document.createElement("canvas");
  source.width = image.naturalWidth || image.width;
  source.height = image.naturalHeight || image.height;
  if (!source.width || !source.height) throw new Error("Could not read that image.");

  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) return file;
  sourceCtx.drawImage(image, 0, 0);

  const bounds = contentBounds(sourceCtx, source.width, source.height);
  const out = document.createElement("canvas");
  const outCtx = out.getContext("2d");
  if (!outCtx) return file;

  if (options.square) {
    // True square icon for iOS / Android home screen — never stretch.
    const size = APP_ICON_SIZE;
    out.width = size;
    out.height = size;
    outCtx.fillStyle = "#ffffff";
    outCtx.fillRect(0, 0, size, size);

    const fit = Math.round(size * 0.86);
    const scale = Math.min(fit / bounds.width, fit / bounds.height);
    const drawW = Math.max(1, Math.round(bounds.width * scale));
    const drawH = Math.max(1, Math.round(bounds.height * scale));
    const offsetX = Math.round((size - drawW) / 2);
    const offsetY = Math.round((size - drawH) / 2);
    outCtx.drawImage(
      source,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      offsetX,
      offsetY,
      drawW,
      drawH,
    );

    const blob = await canvasToBlob(out, "image/png");
    const base = (file.name || "logo").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}-icon-512.png`, { type: "image/png", lastModified: Date.now() });
  }

  const maxEdge = options.maxEdge ?? 1024;
  const scale = Math.min(1, maxEdge / Math.max(bounds.width, bounds.height));
  const drawW = Math.max(1, Math.round(bounds.width * scale));
  const drawH = Math.max(1, Math.round(bounds.height * scale));
  out.width = drawW;
  out.height = drawH;

  const hasAlpha = file.type.includes("png") || file.type.includes("webp") || file.type.includes("gif");
  // JPEG cannot keep transparency — always paint a white plate under the art.
  const useWhitePlate = options.background === "white" || (!hasAlpha && options.background !== "transparent");
  if (useWhitePlate) {
    outCtx.fillStyle = "#ffffff";
    outCtx.fillRect(0, 0, drawW, drawH);
  } else {
    outCtx.clearRect(0, 0, drawW, drawH);
  }
  outCtx.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, drawW, drawH);

  const type = hasAlpha && !useWhitePlate ? "image/png" : hasAlpha ? "image/png" : "image/jpeg";
  const blob = await canvasToBlob(out, type, type === "image/jpeg" ? 0.88 : undefined);
  const ext = blob.type === "image/jpeg" ? "jpg" : "png";
  const base = (file.name || "logo").replace(/\.[^.]+$/, "");
  return new File([blob], `${base}-prepared.${ext}`, { type: blob.type, lastModified: Date.now() });
}
