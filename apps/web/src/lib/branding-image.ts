/** Client-side prepare for Personalising logo / icon uploads — trim empty padding and resize. */

const MAX_BYTES_BEFORE_PROCESS = 350_000;

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

function contentBounds(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  treatNearWhiteAsEmpty: boolean,
) {
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
      // Transparent padding is always empty. Near-white is only empty when we will
      // put the mark back onto a white plate (otherwise logos go black on JPEG/dark UI).
      const nearWhite = alpha > 200 && red > 248 && green > 248 && blue > 248;
      const empty = alpha < 10 || (treatNearWhiteAsEmpty && nearWhite);
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

  const padX = Math.max(2, Math.round((right - left + 1) * 0.04));
  const padY = Math.max(2, Math.round((bottom - top + 1) * 0.04));
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
  /** Longest edge after prepare. */
  maxEdge?: number;
  /** Prefer a square canvas (home-screen icons). */
  square?: boolean;
  /**
   * Plate behind the logo. Header logos must use white — clearing to transparent then
   * saving JPEG fills those pixels black (what turned Core logos black).
   */
  background?: "transparent" | "white";
};

/** Trim empty padding, resize, and compress so logo uploads are fast and fill the preview. */
export async function prepareBrandingImage(file: File, options: PrepareBrandingImageOptions = {}): Promise<File> {
  if (typeof window === "undefined") return file;
  if (!file.type.startsWith("image/")) {
    throw new Error("Upload a PNG, JPG or WEBP image.");
  }
  // Keep SVG as-is — canvas rasterisation would lose vector quality.
  if (file.type.includes("svg")) return file;

  const background = options.background ?? (options.square ? "transparent" : "white");
  const maxEdge = options.maxEdge ?? (options.square ? 512 : 1024);
  const image = await loadImage(file);
  const source = document.createElement("canvas");
  source.width = image.naturalWidth || image.width;
  source.height = image.naturalHeight || image.height;
  if (!source.width || !source.height) throw new Error("Could not read that image.");

  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) return file;
  sourceCtx.drawImage(image, 0, 0);

  const bounds = contentBounds(sourceCtx, source.width, source.height, background === "white");
  let drawW = bounds.width;
  let drawH = bounds.height;
  const scale = Math.min(1, maxEdge / Math.max(drawW, drawH));
  drawW = Math.max(1, Math.round(drawW * scale));
  drawH = Math.max(1, Math.round(drawH * scale));

  const out = document.createElement("canvas");
  if (options.square) {
    const side = Math.max(drawW, drawH);
    out.width = side;
    out.height = side;
  } else {
    out.width = drawW;
    out.height = drawH;
  }

  const outCtx = out.getContext("2d");
  if (!outCtx) return file;
  if (background === "white") {
    outCtx.fillStyle = "#ffffff";
    outCtx.fillRect(0, 0, out.width, out.height);
  } else {
    outCtx.clearRect(0, 0, out.width, out.height);
  }
  const offsetX = options.square ? Math.round((out.width - drawW) / 2) : 0;
  const offsetY = options.square ? Math.round((out.height - drawH) / 2) : 0;
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

  // Prefer PNG so logos never lose a white plate to JPEG's black "transparency".
  let type: string = "image/png";
  let blob = await canvasToBlob(out, type);

  // If still large, switch to JPEG only after the white plate is painted.
  if (blob.size > MAX_BYTES_BEFORE_PROCESS) {
    if (background !== "white") {
      outCtx.fillStyle = "#ffffff";
      outCtx.fillRect(0, 0, out.width, out.height);
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
    }
    blob = await canvasToBlob(out, "image/jpeg", 0.88);
    type = "image/jpeg";
  }

  const ext = type === "image/jpeg" ? "jpg" : "png";
  const base = (file.name || "logo").replace(/\.[^.]+$/, "");
  return new File([blob], `${base}-prepared.${ext}`, { type: blob.type, lastModified: Date.now() });
}
